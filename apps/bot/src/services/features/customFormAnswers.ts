interface FieldLabel {
  id: string;
  label: string;
}

/** Réponses dans l'ordre du formulaire, sous le libellé de chaque question, les champs vides en moins. */
export function labelFormAnswers(structure: unknown, data: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rawFields = (structure as { fields?: unknown } | null)?.fields;
  const fields = Array.isArray(rawFields) ? (rawFields as FieldLabel[]) : [];
  // `default_response` est le champ que `buildFormModal` ajoute à un formulaire sans champ texte.
  const labels = new Map<string, string>([
    ['default_response', 'Votre message'],
    ...fields.map((field) => [field.id, field.label] as const),
  ]);
  const order = new Set([...fields.map((field) => field.id), ...Object.keys(data)]);

  const answers: Array<{ label: string; value: string }> = [];
  for (const key of order) {
    const raw = data[key];
    const value = (Array.isArray(raw) ? raw.map(String).join(', ') : raw == null ? '' : String(raw)).trim();
    if (value) answers.push({ label: labels.get(key) ?? key, value });
  }
  return answers;
}
