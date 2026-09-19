/**
 * Etat de sante du backend, tel que les appels reels le revelent.
 *
 * Le dashboard n'a pas de sonde dediee : c'est le trafic ordinaire qui
 * renseigne l'etat. Une panne se voit a une suite d'echecs d'infrastructure
 * (hors ligne, delai depasse, 502/503/504) ; un seul suffit rarement a
 * conclure, un reseau mobile en perd un de temps en temps.
 *
 * Ce que ca change a l'ecran : une banniere explique la coupure, et les
 * ecritures sont refusees avant d'etre tentees. Sans ca, une page affichait
 * des listes vides comme si le serveur avait repondu « rien », et un
 * formulaire enregistre pendant la coupure donnait l'illusion d'avoir ete
 * pris en compte.
 */
import type { ApiErrorKind } from '../api/errors';

export type BackendStatus =
  /** Le backend repond. */
  | 'ok'
  /** Un echec d'infrastructure isole : on n'alarme pas encore. */
  | 'degraded'
  /** Assez d'echecs consecutifs pour conclure a une coupure. */
  | 'down';

/** Echecs consecutifs a partir desquels on declare la coupure. */
const DOWN_AFTER_FAILURES = 2;

class BackendHealthStore {
  status = $state<BackendStatus>('ok');

  /** Nature du dernier echec d'infrastructure, pour nommer la panne. */
  lastFailureKind = $state<ApiErrorKind | null>(null);

  /** Horodatage du dernier echec, affiche dans la banniere. */
  lastFailureAt = $state<number | null>(null);

  private consecutiveFailures = 0;

  /** Le backend est-il declare injoignable ? */
  get isDown(): boolean {
    return this.status === 'down';
  }

  /**
   * Les ecritures sont-elles autorisees ?
   *
   * On bloque des la coupure declaree, pas au premier echec : un utilisateur
   * qui enregistre pendant un creux reseau doit pouvoir retenter.
   */
  get canWrite(): boolean {
    return this.status !== 'down';
  }

  /** Un appel a abouti : la coupure, s'il y en avait une, est terminee. */
  reportSuccess() {
    this.consecutiveFailures = 0;
    if (this.status !== 'ok') {
      this.status = 'ok';
      this.lastFailureKind = null;
    }
  }

  /**
   * Un appel a echoue.
   *
   * Seules les pannes d'infrastructure comptent. Un 403 ou un 404 signifie que
   * le backend va bien et refuse la demande : le compter ferait basculer en
   * mode degrade un dashboard parfaitement sain dont l'utilisateur n'a pas les
   * droits.
   */
  reportFailure(kind: ApiErrorKind, isInfraFailure: boolean) {
    if (!isInfraFailure) {
      // Une reponse, meme negative, prouve que le serveur repond.
      this.reportSuccess();
      return;
    }

    this.consecutiveFailures += 1;
    this.lastFailureKind = kind;
    this.lastFailureAt = Date.now();
    this.status = this.consecutiveFailures >= DOWN_AFTER_FAILURES ? 'down' : 'degraded';
  }

  /** Remise a zero, au changement de session ou apres une reconnexion manuelle. */
  reset() {
    this.consecutiveFailures = 0;
    this.status = 'ok';
    this.lastFailureKind = null;
    this.lastFailureAt = null;
  }
}

export const backendHealth = new BackendHealthStore();
