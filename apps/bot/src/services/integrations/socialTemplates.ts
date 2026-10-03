/**
 * Rendu des messages personnalisables des suivis sociaux (YouTube, Twitch,
 * GitHub, Hugging Face).
 *
 * Le dashboard documente les variables avec des crochets (`[title]`, `[channel]`)
 * alors que d'anciennes configurations utilisent des accolades : les deux
 * syntaxes sont acceptees pour ne casser aucun message deja enregistre.
 */

export interface FollowTemplateVars {
  title?: string | null;
  channel?: string | null;
  game?: string | null;
  viewers?: number | null;
  url?: string | null;
  author?: string | null;
}

const VARIABLE_PATTERN = /[[{](title|channel|game|viewers|url|author)[\]}]/gi;

/** Remplace toutes les occurrences des variables connues dans un modele. */
export function renderFollowTemplate(template: string, vars: FollowTemplateVars): string {
  return template.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = vars[name.toLowerCase() as keyof FollowTemplateVars];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/** Vrai si le modele reference au moins une variable connue. */
export function templateHasVariable(template: string | null | undefined, name: keyof FollowTemplateVars): boolean {
  if (!template) return false;
  return new RegExp(`[[{]${name}[\\]}]`, 'i').test(template);
}

/**
 * Applique le modele personnalise s'il existe, sinon le message par defaut.
 * Un modele vide (ou uniquement des espaces) est traite comme absent.
 */
export function resolveFollowMessage(
  template: string | null | undefined,
  fallback: string,
  vars: FollowTemplateVars,
): string {
  if (!template || !template.trim()) return fallback;
  const rendered = renderFollowTemplate(template, vars).trim();
  return rendered || fallback;
}
