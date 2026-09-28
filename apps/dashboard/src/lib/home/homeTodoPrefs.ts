/**
 * Ce que le lecteur a ecarte du bloc « A traiter », applique aux donnees de
 * l'API. Le calcul reste cote dashboard : l'API sert la meme liste a tout le
 * monde et la met en cache par serveur.
 */
import {
  HOME_TODO_SNOOZE_MAX_MS,
  type HomeSetupGap,
  type HomeTask,
  type HomeTaskKey,
  type HomeTodoPrefs,
} from '@kotbo/contracts';

export type AppliedHomeTodo = {
  tasks: HomeTask[];
  /** Sujets presents dans les donnees mais retires par le lecteur. */
  hiddenTaskCount: number;
  /** `null` quand le bloc est masque ou qu'il ne reste rien a y montrer. */
  setupMissing: HomeSetupGap[] | null;
  hiddenSetupCount: number;
};

function isSnoozed(task: HomeTask, prefs: HomeTodoPrefs, now: number): boolean {
  const snooze = prefs.snoozedTasks[task.key];
  if (!snooze) return false;
  return task.count <= snooze.count && now - Date.parse(snooze.at) < HOME_TODO_SNOOZE_MAX_MS;
}

export function applyHomeTodoPrefs(
  tasks: HomeTask[],
  setupMissing: HomeSetupGap[] | null,
  prefs: HomeTodoPrefs,
  now = Date.now(),
): AppliedHomeTodo {
  const visibleTasks = tasks.filter((task) => !prefs.hiddenTasks.includes(task.key) && !isSnoozed(task, prefs, now));

  let visibleSetup: HomeSetupGap[] | null = null;
  let hiddenSetupCount = 0;
  if (setupMissing && setupMissing.length > 0) {
    if (prefs.setupHidden) {
      hiddenSetupCount = setupMissing.length;
    } else {
      visibleSetup = setupMissing.filter((gap) => !prefs.hiddenSetup.includes(gap.key));
      hiddenSetupCount = setupMissing.length - visibleSetup.length;
      if (visibleSetup.length === 0) visibleSetup = null;
    }
  }

  return {
    tasks: visibleTasks,
    hiddenTaskCount: tasks.length - visibleTasks.length,
    setupMissing: visibleSetup,
    hiddenSetupCount,
  };
}

/**
 * Oublie les mises en attente devenues sans objet : le sujet a disparu, il a
 * grossi depuis, ou le delai est passe. Sans ce menage, un sujet vide puis
 * revenu avec moins d'elements qu'au moment du masquage resterait cache.
 * Rend `null` quand rien ne change, pour ne pas reecrire les reglages a vide.
 */
export function pruneSnoozes(prefs: HomeTodoPrefs, tasks: HomeTask[], now = Date.now()): HomeTodoPrefs | null {
  const counts = new Map(tasks.map((task) => [task.key, task.count]));
  const kept: HomeTodoPrefs['snoozedTasks'] = {};
  let changed = false;
  for (const [key, snooze] of Object.entries(prefs.snoozedTasks) as Array<[HomeTaskKey, { count: number; at: string }]>) {
    const count = counts.get(key);
    const stale = count === undefined || count > snooze.count || now - Date.parse(snooze.at) >= HOME_TODO_SNOOZE_MAX_MS;
    if (stale) changed = true;
    else kept[key] = snooze;
  }
  return changed ? { ...prefs, snoozedTasks: kept } : null;
}

export function snoozeTask(prefs: HomeTodoPrefs, task: HomeTask, now = Date.now()): HomeTodoPrefs {
  return {
    ...prefs,
    snoozedTasks: { ...prefs.snoozedTasks, [task.key]: { count: task.count, at: new Date(now).toISOString() } },
  };
}

export function hideTask(prefs: HomeTodoPrefs, key: HomeTaskKey): HomeTodoPrefs {
  const { [key]: _dropped, ...snoozedTasks } = prefs.snoozedTasks;
  return {
    ...prefs,
    hiddenTasks: prefs.hiddenTasks.includes(key) ? prefs.hiddenTasks : [...prefs.hiddenTasks, key],
    snoozedTasks,
  };
}

export function hideSetupStep(prefs: HomeTodoPrefs, key: string): HomeTodoPrefs {
  return prefs.hiddenSetup.includes(key) ? prefs : { ...prefs, hiddenSetup: [...prefs.hiddenSetup, key] };
}
