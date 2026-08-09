import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { COLORS_RAW } from '../../utils/embeds.js';
import { runSecurityAudit, type AuditCategory, type AuditFinding } from '../../services/moderation/securityAuditService.js';
import { getEffectiveLocale, getCommandMetadata } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const meta = getCommandMetadata('c1_audit');

const data = new SlashCommandBuilder()
  .setName(meta.name)
  .setNameLocalizations(meta.nameLocalizations)
  .setDescription(meta.description)
  .setDescriptionLocalizations(meta.descriptionLocalizations)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

const SEVERITY_ICONS: Record<string, string> = {
  CRITICAL: '🔴',
  WARNING: '🟠',
  INFO: '🔵',
  OK: '🟢',
};

function scoreColor(score: number): number {
  if (score >= 80) return COLORS_RAW.success;
  if (score >= 50) return COLORS_RAW.warning;
  return COLORS_RAW.danger;
}

function scoreLabel(score: number, locale: 'fr' | 'en'): string {
  if (score >= 90) return m.c1_audit_score_excellent({}, { locale });
  if (score >= 80) return m.c1_audit_score_good({}, { locale });
  if (score >= 60) return m.c1_audit_score_average({}, { locale });
  if (score >= 40) return m.c1_audit_score_weak({}, { locale });
  return m.c1_audit_score_critical({}, { locale });
}

function formatFinding(finding: AuditFinding): string {
  const icon = SEVERITY_ICONS[finding.severity] ?? '•';
  let line = `${icon} **${finding.title}** \`-${finding.weight}\`\n${finding.detail}`;
  if (finding.recommendation) line += `\n> 💡 ${finding.recommendation}`;
  return line;
}

function categoryLabel(category: AuditCategory, locale: 'fr' | 'en'): string {
  const key = `c1_audit_cat_${category}` as keyof typeof m;
  const fn = m[key] as ((inputs: Record<string, never>, opts: { locale: 'fr' | 'en' }) => string) | undefined;
  return typeof fn === 'function' ? fn({}, { locale }) : category;
}

/** Barre de progression compacte pour le sous-score d'une catégorie. */
function scoreBar(value: number): string {
  const filled = Math.round(value / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

/** Discord plafonne un embed à 6000 caractères : on garde de la marge. */
const EMBED_BUDGET = 5200;

async function execute(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  if (!guild) return;
  const locale = await getEffectiveLocale(interaction);

  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const { score, grade, findings, categories, degraded } = await runSecurityAudit(guild);

  const problems = findings.filter((f) => f.severity !== 'OK');
  const oks = findings.filter((f) => f.severity === 'OK');

  const embed = new EmbedBuilder()
    .setColor(scoreColor(score))
    .setTitle(`🔍 ${m.c1_audit_title({}, { locale })}`)
    .setDescription(
      `## ${m.c1_audit_score_heading({ score }, { locale })} · ${m.c1_audit_grade({ grade }, { locale })} - ${scoreLabel(score, locale)}\n` +
        `${score >= 80 ? m.c1_audit_protected({}, { locale }) : m.c1_audit_improvements({}, { locale })}`
    )
    .setTimestamp();

  // Sous-scores : la catégorie la plus faible en premier, pour cadrer l'effort.
  const ranked = [...categories].sort((a, b) => a.score - b.score);
  embed.addFields({
    name: `📊 ${m.c1_audit_categories({}, { locale })}`,
    value: ranked
      .map((cat) => `\`${scoreBar(cat.score)}\` **${cat.score}%** ${categoryLabel(cat.category, locale)}`)
      .join('\n')
      .slice(0, 1024),
  });

  if (problems.length > 0) {
    // Discord limite un field à 1024 caractères et l'embed entier à 6000 :
    // on empile par blocs et on tronque proprement quand le budget est atteint.
    let used = embed.data.description?.length ?? 0;
    let block = '';
    let blockIndex = 0;
    let rendered = 0;

    const flush = () => {
      if (!block) return;
      embed.addFields({ name: blockIndex === 0 ? `⚠️ ${m.c1_audit_fix_points({}, { locale })}` : '​', value: block });
      used += block.length;
      block = '';
      blockIndex++;
    };

    for (const finding of problems) {
      const entry = formatFinding(finding);
      if (used + block.length + entry.length > EMBED_BUDGET) break;
      if (block.length + entry.length + 2 > 1024) flush();
      block += (block ? '\n\n' : '') + entry;
      rendered++;
    }
    flush();

    if (rendered < problems.length) {
      embed.addFields({ name: '​', value: m.c1_audit_truncated({ count: problems.length - rendered }, { locale }) });
    }
  }

  if (oks.length > 0) {
    embed.addFields({
      name: `✅ ${m.c1_audit_compliant_points({}, { locale })}`,
      value: oks.map((f) => `🟢 ${f.title}`).join(' · ').slice(0, 1024),
    });
  }

  if (degraded.length > 0) {
    embed.addFields({
      name: `⚙️ ${m.c1_audit_degraded({}, { locale })}`,
      value: degraded.map((d) => `• ${d}`).join('\n').slice(0, 1024),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

export const auditCommand: SlashCommandDefinition = { data, execute };
