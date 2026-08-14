
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
}

/** Bulles affichables en meme temps : au-dela, la plus ancienne cede la place. */
const MAX_VISIBLE = 4;

class ToastStore {
  toasts = $state<Toast[]>([]);

  /** Minuteries de disparition, pour pouvoir en relancer une sans doublon. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  add(
    message: string,
    type: ToastType = 'info',
    duration = 5000,
    action?: { label: string; onClick: () => void | Promise<void> }
  ) {
    // Un meme message deja a l'ecran ne se rejoue pas : une action qui echoue
    // deux fois, ou une page qui double le message du socle, empilait des
    // bulles identiques que l'utilisateur devait fermer une par une.
    const existing = this.toasts.find((entry) => entry.message === message && entry.type === type);
    if (existing) {
      this.scheduleRemoval(existing.id, duration);
      return;
    }

    const id = crypto.randomUUID();
    this.toasts.push({ id, message, type, duration, action });

    // Une avalanche (module eteint, coupure reseau) ne doit pas recouvrir la
    // page : seules les dernieres bulles restent.
    while (this.toasts.length > MAX_VISIBLE) {
      this.remove(this.toasts[0].id);
    }

    this.scheduleRemoval(id, duration);
  }

  private scheduleRemoval(id: string, duration: number) {
    const previous = this.timers.get(id);
    if (previous) {
      clearTimeout(previous);
      this.timers.delete(id);
    }
    if (duration > 0) {
      this.timers.set(id, setTimeout(() => this.remove(id), duration));
    }
  }

  success(message: string, duration?: number, action?: { label: string; onClick: () => void | Promise<void> }) {
    this.add(message, 'success', duration, action);
  }

  error(message: string, duration?: number, action?: { label: string; onClick: () => void | Promise<void> }) {
    this.add(message, 'error', duration, action);
  }

  info(message: string, duration?: number, action?: { label: string; onClick: () => void | Promise<void> }) {
    this.add(message, 'info', duration, action);
  }

  warning(message: string, duration?: number, action?: { label: string; onClick: () => void | Promise<void> }) {
    this.add(message, 'warning', duration, action);
  }

  remove(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const toast = new ToastStore();
