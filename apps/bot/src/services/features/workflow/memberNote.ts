/**
 * Marque des lignes écrites par une automatisation dans la note d'un membre.
 * Elle doit rester alignée sur `formatAutomaticNoteLine` : une ligne qu'elle ne
 * reconnaîtrait plus serait traitée comme écrite par le staff, donc jamais
 * retirée, et la note finirait pleine.
 */
const AUTO_NOTE_LINE = /^\[Auto \d{4}-\d{2}-\d{2}\] /;

export function formatAutomaticNoteLine(text: string, date: Date): string {
  return `[Auto ${date.toISOString().slice(0, 10)}] ${text}`;
}

/**
 * Plafond de la note de modération : c'est aussi la limite du champ de la
 * fenêtre `/note`, qui refuse de s'ouvrir sur une valeur plus longue.
 */
export const MEMBER_NOTE_MAX_LENGTH = 1000;

/**
 * Ajoute une ligne en fin de note. Pour tenir dans le plafond, seules les
 * lignes automatiques les plus anciennes sont retirées : une note écrite par
 * le staff n'est jamais effacée par une automatisation. Retourne `null` quand
 * la place manque malgré tout.
 */
export function appendAutomaticNoteLine(current: string | null, line: string): string | null {
  const lines = current ? current.split('\n') : [];
  lines.push(line);

  let length = lines.join('\n').length;
  while (length > MEMBER_NOTE_MAX_LENGTH) {
    // La ligne qu'on ajoute est automatique mais ne se sacrifie pas elle-même.
    const index = lines.findIndex((entry, i) => i < lines.length - 1 && AUTO_NOTE_LINE.test(entry));
    if (index === -1) return null;
    lines.splice(index, 1);
    length = lines.join('\n').length;
  }

  return lines.join('\n');
}
