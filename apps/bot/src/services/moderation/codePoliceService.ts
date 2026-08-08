import prisma from '../../utils/db.js';

export type CodePoliceRuleCategory = 'SIGNAL' | 'DANGER' | 'LANGUAGE_FEEDBACK';
export type CodePoliceMatchType = 'EXACT' | 'REGEX';
export type CodePoliceSeverity = 'INFO' | 'WARNING' | 'DANGER';
export type CodeLanguage = 'javascript' | 'python' | 'sql' | 'shell' | 'html' | 'java' | 'cpp' | 'generic';

export interface CodePoliceRule {
  key: string;
  category: CodePoliceRuleCategory;
  matchType: CodePoliceMatchType;
  language: string | null;
  pattern: string;
  label: string;
  feedback: string;
  severity: CodePoliceSeverity;
  enabled: boolean;
}

export interface CodeRisk {
  level: CodePoliceSeverity;
  title: string;
  feedback: string;
}

export interface CodeAnalysis {
  shouldFormat: boolean;
  shouldBlock: boolean;
  language: CodeLanguage;
  signals: string[];
  risks: CodeRisk[];
}

type CachedRules = {
  rules: CodePoliceRule[];
  expiresAt: number;
};

const RULE_CACHE_TTL_MS = 5 * 60_000;
const codePoliceRulesCache = new Map<string, CachedRules>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesRule(content: string, rule: CodePoliceRule): boolean {
  if (rule.matchType === 'REGEX') {
    try {
      return new RegExp(rule.pattern, 'i').test(content);
    } catch {
      return false;
    }
  }

  if (/^[A-Za-z0-9_.-]+$/.test(rule.pattern)) {
    return new RegExp(`\\b${escapeRegex(rule.pattern)}\\b`, 'i').test(content);
  }

  return content.toLowerCase().includes(rule.pattern.toLowerCase());
}

function summarizeSignalHits(content: string, rules: CodePoliceRule[]): string[] {
  return rules
    .filter((rule) => rule.category === 'SIGNAL' && matchesRule(content, rule))
    .map((rule) => rule.label);
}

function hasDiscordMentions(content: string): boolean {
  return /<@!?\d+>|<@&\d+>|<#\d+>|@everyone|@here/.test(content);
}

function detectDangerousPatterns(content: string, rules: CodePoliceRule[]): CodeRisk[] {
  return rules
    .filter((rule) => rule.category === 'DANGER' && matchesRule(content, rule))
    .map((rule) => ({
      level: rule.severity,
      title: `Pattern dangereux détecté : ${rule.label}`,
      feedback: rule.feedback,
    }));
}

function detectLanguage(content: string, rules: CodePoliceRule[]): CodeLanguage {
  const signalRules = rules.filter((rule) => rule.category === 'SIGNAL');
  const candidates = new Set<CodeLanguage>();

  for (const rule of signalRules) {
    if (rule.language && rule.language !== 'generic') {
      candidates.add(rule.language as CodeLanguage);
    }
  }

  let bestLanguage: CodeLanguage = 'generic';
  let bestScore = 0;

  for (const language of candidates) {
    const score = signalRules.filter((rule) => rule.language === language && matchesRule(content, rule)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLanguage = language;
    }
  }

  if (bestScore > 0) {
    return bestLanguage;
  }

  const genericScore = signalRules.filter((rule) => rule.language === 'generic' && matchesRule(content, rule)).length;
  return genericScore > 0 ? 'generic' : 'generic';
}

function detectLoopRisks(content: string): CodeRisk[] {
  const risks: CodeRisk[] = [];

  if (/\bwhile\s*\(\s*true\s*\)/i.test(content) || /\bfor\s*\(\s*;\s*;\s*\)/i.test(content)) {
    risks.push({
      level: 'WARNING',
      title: 'Boucle potentiellement infinie',
      feedback: "Ajoute une condition d'arrêt claire ou une limite d'itérations pour éviter un blocage.",
    });
  }

  const functionNames = new Set<string>();
  const functionPatterns = [
    /\bdef\s+([A-Za-z_][\w]*)\s*\(/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
    /\b([A-Za-z_$][\w$]*)\s*:\s*function\s*\(/g,
  ];

  for (const pattern of functionPatterns) {
    for (const match of content.matchAll(pattern)) {
      const name = match[1];
      if (name) functionNames.add(name);
    }
  }

  for (const name of functionNames) {
    const callCount = (content.match(new RegExp(`\\b${escapeRegex(name)}\\s*\\(`, 'g')) ?? []).length;
    const hasSelfCall = callCount >= 2;
    const hasBaseCase = /\b(?:if|switch|case|elif|else\s+if|throw|break|continue)\b/i.test(content);
    if (hasSelfCall && !hasBaseCase) {
      risks.push({
        level: 'WARNING',
        title: `Récursion potentiellement sans cas de sortie : ${name}`,
        feedback: "La fonction semble s'appeler elle-même sans garde visible. Ajoute un cas de base explicite pour stopper la récursion.",
      });
      break;
    }
  }

  return risks;
}

function buildLanguageAdvice(language: CodeLanguage, rules: CodePoliceRule[]): string {
  const adviceRule = rules.find((rule) => rule.category === 'LANGUAGE_FEEDBACK' && rule.language === language);
  const genericRule = rules.find((rule) => rule.category === 'LANGUAGE_FEEDBACK' && rule.language === 'generic');
  return adviceRule?.feedback ?? genericRule?.feedback ?? 'Bonne pratique : ajoute un cas de sortie clair, borne les itérations et valide toutes les entrées.';
}

function buildFeedbackLines(analysis: CodeAnalysis, rules: CodePoliceRule[]): string[] {
  const lines: string[] = [];

  if (analysis.signals.length > 0) {
    lines.push(`Indices détectés : ${analysis.signals.join(', ')}.`);
  }

  for (const risk of analysis.risks) {
    lines.push(`${risk.title} - ${risk.feedback}`);
  }

  lines.push(buildLanguageAdvice(analysis.language, rules));
  return lines;
}

function getLongestFence(content: string): number {
  const matches = content.match(/`+/g) ?? [];
  return matches.reduce((max, sequence) => Math.max(max, sequence.length), 0);
}

function wrapInCodeFence(content: string): string {
  const fenceLength = Math.max(3, getLongestFence(content) + 1);
  const fence = '`'.repeat(fenceLength);
  return `${fence}\n${content}\n${fence}`;
}

export async function loadCodePoliceRules(guildId: string): Promise<CodePoliceRule[]> {
  const cached = codePoliceRulesCache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.rules;
  }

  const rules = await prisma.codePoliceRule.findMany({
    where: {
      enabled: true,
      OR: [{ guildId: null }, { guildId }],
    },
    select: {
      key: true,
      category: true,
      matchType: true,
      language: true,
      pattern: true,
      label: true,
      feedback: true,
      severity: true,
      enabled: true,
    },
    orderBy: [
      { category: 'asc' },
      { key: 'asc' },
    ],
  });

  codePoliceRulesCache.set(guildId, { rules, expiresAt: now + RULE_CACHE_TTL_MS });
  return rules;
}

export function analyzeCodeContent(content: string, rules: CodePoliceRule[]): CodeAnalysis {
  const trimmed = content.trim();
  const signals = summarizeSignalHits(trimmed, rules);
  const risks = [...detectDangerousPatterns(trimmed, rules), ...detectLoopRisks(trimmed)];
  const language = detectLanguage(trimmed, rules);

  const keywordHits = signals.length;
  const dangerHits = risks.some((risk) => risk.level === 'DANGER');
  const shouldFormat = (keywordHits >= 1 && trimmed.length >= 8) || risks.length > 0;
  const shouldBlock = dangerHits;

  return {
    shouldFormat: shouldFormat || shouldBlock,
    shouldBlock,
    language,
    signals,
    risks,
  };
}

export function hasRawCodeIndicators(content: string, rules: CodePoliceRule[]): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 8) return false;

  const signalHits = summarizeSignalHits(trimmed, rules);
  const dangerHits = detectDangerousPatterns(trimmed, rules);
  const hasMentions = hasDiscordMentions(trimmed);
  const hasSpecificSignalHits = rules.some(
    (rule) => rule.category === 'SIGNAL' && rule.language !== 'generic' && matchesRule(trimmed, rule)
  );

  if (hasMentions && !hasSpecificSignalHits && dangerHits.length === 0) {
    return false;
  }

  return signalHits.length >= 1 || dangerHits.length > 0;
}

export function isAlreadyFormatted(content: string): boolean {
  return /```[\s\S]*?```/.test(content) || /`[^`]*`/.test(content);
}

export function buildCorrectedMessage(authorTag: string, content: string, analysis: CodeAnalysis, rules: CodePoliceRule[]): string {
  const adviceByLanguage: Record<CodeLanguage, string> = {
    javascript: 'Sur Discord, utilise les blocs de code (```js) et ajoute un garde explicite avant toute boucle ou récursion.',
    python: "Sur Discord, utilise les blocs de code (```python) et pense à ajouter un cas de base si la fonction s'appelle elle-même.",
    sql: 'Sur Discord, utilise les blocs de code (```sql) et évite la concaténation directe: préfère des requêtes paramétrées.',
    shell: "Sur Discord, utilise les blocs de code (```bash) et vérifie chaque commande avant de l'exécuter.",
    html: "Sur Discord, utilise les blocs de code (```html) et vérifie l'échappement des données injectées.",
    java: "Sur Discord, utilise les blocs de code (```java) et ajoute une condition d'arrêt claire pour les boucles/récursions.",
    cpp: 'Sur Discord, utilise les blocs de code (```cpp) et vérifie les bornes des boucles ainsi que les accès sensibles.',
    generic: 'Sur Discord, utilise les blocs de code (```) pour une meilleure lisibilité. Ajoute aussi le langage si possible, par exemple ```js ou ```python.',
  };

  const header = `${authorTag}, voici ton message avec une meilleure mise en forme :`;
  const maxContentLength = 1500;
  const shortenedContent = content.length > maxContentLength
    ? `${content.slice(0, maxContentLength)}\n…(message tronqué pour rester lisible)`
    : content;
  const feedbackLines = buildFeedbackLines(analysis, rules);
  const advice = adviceByLanguage[analysis.language] ?? adviceByLanguage.generic;

  return [
    header,
    wrapInCodeFence(shortenedContent),
    feedbackLines.length > 0 ? `🧩 **Feedback sécurité / qualité :**\n- ${feedbackLines.join('\n- ')}` : null,
    `💡 **Conseil :** ${advice}`,
  ].filter(Boolean).join('\n\n');
}

export function buildSafetyWarning(authorTag: string, analysis: CodeAnalysis, rules: CodePoliceRule[]): string {
  const lines = buildFeedbackLines(analysis, rules);
  const languageTag = analysis.language === 'generic' ? 'ce code' : analysis.language;

  return [
    `${authorTag}, je n'ai pas reformatté ${languageTag} car il contient des motifs de sécurité sensibles.`,
    lines.length > 0 ? `🛑 **Motifs détectés :**\n- ${lines.join('\n- ')}` : null,
    "Si tu veux, je peux t'aider à le transformer en version sûre et bornée.",
  ].filter(Boolean).join('\n\n');
}
