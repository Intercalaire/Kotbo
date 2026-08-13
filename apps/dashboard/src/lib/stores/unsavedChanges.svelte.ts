/**
 * Global store for tracking unsaved changes across dashboard pages.
 * Works like Discord's settings save bar - pages register their save/reset
 * callbacks, and the UnsavedChangesBar overlay handles displaying the prompt.
 */

type SaveCallback = () => Promise<boolean | void>;
type ResetCallback = () => void;

class UnsavedChangesStore {
  /** Whether there are currently unsaved changes */
  isDirty = $state(false);

  /** Human-readable label shown in the bar (e.g. "Accueil & Départ") */
  pageLabel = $state('');

  /** Whether the save is currently in progress */
  saving = $state(false);

  private _onSave: SaveCallback | null = null;
  private _onReset: ResetCallback | null = null;

  /**
   * Called by a page when it has unsaved changes to register.
   * Pass null to clear (page unmounted / saved).
   */
  register(opts: {
    label: string;
    onSave: SaveCallback;
    onReset: ResetCallback;
  }) {
    this.pageLabel = opts.label;
    this._onSave = opts.onSave;
    this._onReset = opts.onReset;
    this.isDirty = true;
  }

  /**
   * Clear the unsaved changes state (called after save or reset).
   */
  clear() {
    this.isDirty = false;
    this.saving = false;
    this.pageLabel = '';
    this._onSave = null;
    this._onReset = null;
  }

  /**
   * Trigger the registered save callback.
   * Returns true if save was successful.
   */
  async save(): Promise<boolean> {
    if (!this._onSave) return false;
    this.saving = true;
    try {
      const result = await this._onSave();
      // If the page callback returns false explicitly, keep dirty
      if (result === false) return false;
      this.clear();
      return true;
    } catch {
      this.saving = false;
      return false;
    }
  }

  /**
   * Trigger the registered reset callback and clear state.
   */
  reset() {
    this._onReset?.();
    this.clear();
  }

  /**
   * Check if navigation is safe or ask confirmation.
   * Returns true if navigation can proceed.
   */
  canNavigate(): boolean {
    return !this.isDirty;
  }
}

export const unsavedChanges = new UnsavedChangesStore();
