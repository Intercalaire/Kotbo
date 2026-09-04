/**
 * Ce que la mise en place aurait coute a la main.
 *
 * Le recapitulatif chiffre ce qui a ete pose ; ce chiffre-la dit ce qu'il
 * represente. « 14 salons » ne parle qu'a quelqu'un qui a deja monte un
 * serveur Discord - « environ 40 minutes » parle a tout le monde, et c'est
 * cette traduction qui fait sentir le travail epargne.
 *
 * Les durees viennent de ce que coute reellement chaque geste : creer un salon
 * et poser ses permissions ne prend pas dix secondes des lors qu'on reflechit a
 * qui doit le voir, et brancher un reglage suppose d'avoir d'abord trouve la
 * page qui le porte.
 *
 * Volontairement basses, et annoncees comme une estimation. Un chiffre qu'on
 * soupconne d'etre gonfle ne convainc personne, et emporte avec lui la
 * credibilite du reste du recapitulatif.
 *
 * Le calcul vit cote dashboard parce qu'il ne decrit rien du serveur : c'est
 * une facon de presenter des compteurs que le bot rend deja.
 */
export type AutopilotCounts = {
  categories: number;
  channels: number;
  roles: number;
  modules: number;
  settings: number;
};

export const EMPTY_COUNTS: AutopilotCounts = {
  categories: 0,
  channels: 0,
  roles: 0,
  modules: 0,
  settings: 0,
};

const MANUAL_MINUTES: AutopilotCounts = {
  categories: 1,
  channels: 2,
  roles: 3,
  modules: 1,
  settings: 2,
};

export function addCounts(a: AutopilotCounts, b: Partial<AutopilotCounts>): AutopilotCounts {
  return {
    categories: a.categories + (b.categories ?? 0),
    channels: a.channels + (b.channels ?? 0),
    roles: a.roles + (b.roles ?? 0),
    modules: a.modules + (b.modules ?? 0),
    settings: a.settings + (b.settings ?? 0),
  };
}

export function estimateManualMinutes(counts: AutopilotCounts): number {
  return (
    counts.categories * MANUAL_MINUTES.categories
    + counts.channels * MANUAL_MINUTES.channels
    + counts.roles * MANUAL_MINUTES.roles
    + counts.modules * MANUAL_MINUTES.modules
    + counts.settings * MANUAL_MINUTES.settings
  );
}

/** « 40 minutes », « 1 h 20 » - arrondi, parce qu'une estimation à la minute ment. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 15) * 15;
  if (rest === 0 || rest === 60) return `${rest === 60 ? hours + 1 : hours} h`;
  return `${hours} h ${rest}`;
}
