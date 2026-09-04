/**
 * Le relais entre le tunnel et Stripe.
 *
 * Stripe ramene tout le monde au meme endroit - `/billing?checkout=success` -
 * qu'on vienne d'activer un serveur tout juste monte ou qu'on ait change
 * d'offre sur un serveur qui tourne depuis un an. Les deux ne demandent pas la
 * meme suite : le premier vient de voir cent reglages s'ouvrir d'un coup et ne
 * sait pas par ou commencer, le second voulait juste sa facture.
 *
 * On ne peut pas deviner lequel des deux revient. « Le serveur n'etait pas
 * active » ne se verifie plus apres coup, precisement parce qu'il l'est
 * desormais ; et se fier a une formation jamais vue enverrait vers la page de
 * formation quelqu'un qui a simplement change d'offre.
 *
 * Le tunnel pose donc lui-meme le drapeau avant de partir vers Stripe. Il est
 * le seul a le poser, il ne se pose qu'en partant, et il se retire a la
 * lecture : rien ne le survit a une redirection ratee. `sessionStorage` parce
 * que le trajet tient dans un onglet - un drapeau oublie en `localStorage`
 * renverrait vers la formation trois semaines plus tard.
 */
const key = (guildId: string) => `kotbo-onboarding-checkout-${guildId}`;

/** Appele juste avant de partir sur Stripe, depuis le tunnel uniquement. */
export function markOnboardingCheckout(guildId: string | null | undefined): void {
  if (!guildId) return;
  try {
    sessionStorage.setItem(key(guildId), '1');
  } catch {
    // Stockage refuse : le retour se fera sur la facturation, comme avant.
    // Une redirection manquee vaut mieux qu'un paiement qui n'ouvre pas.
  }
}

/** Lit le drapeau et le retire. Vrai une seule fois par passage en caisse. */
export function consumeOnboardingCheckout(guildId: string | null | undefined): boolean {
  if (!guildId) return false;
  try {
    const found = sessionStorage.getItem(key(guildId)) === '1';
    if (found) sessionStorage.removeItem(key(guildId));
    return found;
  } catch {
    return false;
  }
}
