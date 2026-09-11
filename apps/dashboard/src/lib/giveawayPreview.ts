/**
 * Rendu d'aperçu d'une annonce de concours.
 *
 * Les gabarits s'écrivaient à l'aveugle : on ne voyait le résultat qu'en
 * lançant un vrai concours dans un vrai salon. Ce module remplace les variables
 * par des valeurs d'exemple et traduit le balisage de Discord en HTML, pour
 * montrer l'annonce telle qu'elle sortira.
 *
 * Il double volontairement la logique du bot, qui reste seul juge à l'envoi :
 * l'aperçu ne sert qu'à montrer, jamais à décider.
 */

export interface PreviewSample {
  prize: string;
  description: string;
  winnerCount: number;
  participants: number;
  winners: string[];
  host: string;
  serverName: string;
  /** Rôles avantagés, du plus au moins favorisé. */
  bonusRoles: { name: string; weight: number }[];
  coins: number;
  xp: number;
  item: string;
  needValidation: boolean;
  /** Fin du concours, pour les variables de date. */
  endsAt: Date;
}

export interface PreviewLabels {
  rewardsTitle: string;
  coins: string;
  xp: string;
  item: string;
  validation: string;
  bonusRolesTitle: string;
  endsIn: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Un gabarit est saisi librement : rien n'en sort sans être neutralisé. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Bornes posées autour d'une mention pendant le remplissage.
 *
 * La pastille se devinait ensuite du texte, par une expression qui lisait le
 * nom après l'arobase. Elle butait sur tout ce qui n'est ni lettre ni chiffre :
 * un rôle nommé « Ancien » avec un emoji devant ne recevait aucune pastille, et
 * un nom en deux mots n'en voyait que le premier. Le remplissage sait, lui, où
 * commence et où finit chaque mention, alors il le dit.
 *
 * Deux caractères de la zone à usage privé, absents de tout nom de rôle comme
 * de tout gabarit, et qui traversent la neutralisation HTML sans être touchés.
 */
const MENTION_OPEN = '\uE000';
const MENTION_CLOSE = '\uE001';

function mention(name: string): string {
  return `${MENTION_OPEN}@${name}${MENTION_CLOSE}`;
}

/** Durée lisible entre maintenant et la fin, pour remplacer un horodatage Discord. */
function relativeLabel(endsAt: Date, endsIn: string): string {
  const minutes = Math.max(1, Math.round((endsAt.getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${endsIn} ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${endsIn} ${hours} h`;
  return `${endsIn} ${Math.round(hours / 24)} j`;
}

function rewardsBlock(sample: PreviewSample, labels: PreviewLabels): string {
  let info = '';
  if (sample.coins > 0) info += `\n**${labels.coins}** +${sample.coins}`;
  if (sample.xp > 0) info += `\n**${labels.xp}** +${sample.xp}`;
  if (sample.item) info += `\n**${labels.item}** ${sample.item}`;
  if (sample.needValidation) info += `\n*${labels.validation}*`;
  return info ? `\n**${labels.rewardsTitle}**${info}\n` : '';
}

function bonusRolesBlock(sample: PreviewSample, labels: PreviewLabels): string {
  if (sample.bonusRoles.length === 0) return '';
  const lines = [...sample.bonusRoles]
    .sort((a, b) => b.weight - a.weight)
    .map((role) => `${mention(role.name)} ×${role.weight}`);
  return `\n**${labels.bonusRolesTitle}**\n${lines.join('\n')}\n`;
}

/** Remplace les variables d'un gabarit par les valeurs de l'exemple. */
export function fillTemplate(template: string, sample: PreviewSample, labels: PreviewLabels): string {
  const values: Record<string, string> = {
    '{id}': 'apercu',
    '{prize}': sample.prize,
    '{lot}': sample.prize,
    '{winnerCount}': String(sample.winnerCount),
    '{gagnants}': String(sample.winnerCount),
    '{participants}': String(sample.participants),
    '{winners}': sample.winners.map(mention).join(', '),
    '{host}': mention(sample.host),
    '{organisateur}': mention(sample.host),
    '{server}': sample.serverName,
    '{serveur}': sample.serverName,
    '{endsAt}': sample.endsAt.toLocaleString(),
    '{endsRelative}': relativeLabel(sample.endsAt, labels.endsIn),
    '{description}': sample.description ? `${sample.description}\n\n` : '',
    '{bonus}': rewardsBlock(sample, labels),
    '{bonusRoles}': bonusRolesBlock(sample, labels),
    '{minAccountAgeDays}': '7',
    '{minMemberAgeDays}': '3',
    '{minLevel}': '5',
  };

  // Les bornes de mention sont les nôtres : un gabarit qui en porterait se
  // dessinerait ses propres pastilles.
  let result = template.replaceAll(MENTION_OPEN, '').replaceAll(MENTION_CLOSE, '');
  for (const [token, value] of Object.entries(values)) {
    if (result.includes(token)) result = result.replaceAll(token, value);
  }
  return result;
}

/**
 * Traduit le balisage de Discord en HTML.
 *
 * Seules les marques que le bot peut réellement produire sont gérées. Le texte
 * est neutralisé d'abord : les balises rendues ici sont les nôtres, jamais
 * celles d'un gabarit.
 */
export function toDiscordHtml(text: string): string {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, '<code class="block">$1</code>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    // Mentions : en pastille comme Discord, et jamais cliquables. Une arobase
    // simplement tapée dans un gabarit n'en reçoit pas, Discord non plus : seul
    // un vrai identifiant y donne droit.
    .replace(
      new RegExp(`${MENTION_OPEN}([^${MENTION_CLOSE}]*)${MENTION_CLOSE}`, 'g'),
      '<span class="mention">$1</span>',
    )
    .replace(/\n/g, '<br />');
}

/** Gabarit rempli puis mis en forme, prêt à être inséré dans l'aperçu. */
export function renderPreview(template: string, sample: PreviewSample, labels: PreviewLabels): string {
  return toDiscordHtml(fillTemplate(template, sample, labels));
}
