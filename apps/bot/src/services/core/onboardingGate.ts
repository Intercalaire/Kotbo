/**
 * Le serveur est-il encore dans son parcours de configuration ?
 *
 * Meme regle que celle rendue au dashboard (`guildState.ts`), lue ici pour une
 * autre raison : decider si une route de configuration doit s'ouvrir alors que
 * son module est eteint par l'offre.
 *
 * Le parcours demande a l'administrateur de regler sa moderation et son accueil
 * avant de payer - c'est tout l'interet, il voit ce qu'il achete. Or `automod`
 * et `welcome_goodbye` ne figurent pas dans l'offre FREE : la garde des modules
 * refusait ces ecritures, et le parcours butait a l'etape 5 sur un serveur qui
 * n'avait, par construction, encore rien pris.
 *
 * Ouvrir l'ecriture n'ouvre pas le service. `moduleGate` continue d'eteindre
 * ces modules au runtime tant que l'offre ne les comprend pas : la ligne est
 * ecrite, elle ne s'applique pas, et le paiement la revele sans qu'aucun
 * traitement n'ait a repasser derriere. C'est deja ce que fait la mise en place
 * pour l'etat des modules (`recordIntentWhenLocked`) ; ceci l'etend a leur
 * configuration.
 */
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { isBillingEnabled } from '../billing/stripeService.js';

/**
 * Segments que le parcours ecrit avant tout paiement.
 *
 * Liste fermee et courte : chaque ajout ouvre une surface d'ecriture a un
 * serveur qui n'a rien pris. N'y mettre qu'un segment qu'un ecran du parcours
 * touche reellement.
 */
export const WIZARD_CONFIG_SEGMENTS = new Set([
  // Ecran « modération » : les filtres de message.
  'automod',
  // Ecran « modération » : les seuils anti-raid.
  'raid-protection',
  // Ecran « accueil » : le message de bienvenue.
  'announcement',
]);

/** Court : l'etat change une fois, au paiement, et doit se voir aussitot. */
const CACHE_TTL_SECONDS = 30;

const cacheKeyFor = (guildId: string) => `guild:${guildId}:onboarding_required`;

export async function isGuildInOnboarding(guildId: string): Promise<boolean> {
  const cached = await cache.get<boolean>(cacheKeyFor(guildId));
  if (typeof cached === 'boolean') return cached;

  try {
    // Sans facturation sur l'instance en production (sauf si ENABLE_ONBOARDING
    // est actif), il n'y a pas de parcours a proteger : une installation auto-hebergee
    // garde tous ses serveurs en FREE, et les traiter comme « en cours de configuration »
    // ouvrirait ces ecritures pour toujours.
    if (!isBillingEnabled() && process.env.NODE_ENV === 'production' && process.env.ENABLE_ONBOARDING !== 'true') {
      await cache.set(cacheKeyFor(guildId), false, CACHE_TTL_SECONDS);
      return false;
    }

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: {
        plan: true,
        stripeSubscriptionId: true,
        accessType: true,
        activationCode: true,
      },
    });

    const inOnboarding = !!guild
      && (guild.plan ?? 'FREE') === 'FREE'
      && !guild.stripeSubscriptionId
      && guild.accessType === 'PERMANENT'
      && !guild.activationCode;

    await cache.set(cacheKeyFor(guildId), inOnboarding, CACHE_TTL_SECONDS);
    return inOnboarding;
  } catch (err) {
    // Une base injoignable ne doit pas ouvrir des ecritures : on refuse, la
    // garde des modules reprend la main comme avant.
    logger.error('Onboarding', `Lecture de l'etat de parcours impossible pour ${guildId}:`, err);
    return false;
  }
}
