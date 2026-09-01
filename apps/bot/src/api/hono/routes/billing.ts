/**
 * Routes de facturation.
 *
 * Deux publics très différents cohabitent ici, et c'est voulu :
 *
 *   - `/api/billing/webhook` est appelé par **Stripe**. Pas de session, pas de
 *     CORS : l'authentification est la signature cryptographique du corps de la
 *     requête. C'est la seule route de tout le projet dont l'appelant n'est pas
 *     un navigateur.
 *   - `/api/dashboard/guilds/:guildId/billing/*` est appelé par le **dashboard**,
 *     avec la session et le contrôle de rôle habituels. Ces routes ne débitent
 *     jamais rien : elles ouvrent une page hébergée par Stripe et renvoient son
 *     URL. Aucun numéro de carte ne traverse notre infrastructure, ce qui nous
 *     tient à l'écart du périmètre PCI.
 *
 * Toute l'attribution repose sur `metadata.guildId`, posé par `stripeService` au
 * moment d'ouvrir la session de paiement.
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import type { Client } from 'discord.js';
import {
  PLAN_KEYS,
  PLAN_REGISTRY,
  getPlanDefinition,
  modulesForPlan,
  normalizePlanKey,
  type PlanKey,
} from '@kotbo/contracts';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { requireGuildAccess } from '../middleware/guildAccess.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { dashboardSensitiveRateLimiter } from '../../limiters.js';
import {
  createCheckoutSession,
  createPortalSession,
  ensureCustomer,
  getStripe,
  isBillingEnabled,
  sellablePlans,
  type Stripe,
} from '../../../services/billing/stripeService.js';
import { syncSubscription, guildIdForSubscription } from '../../../services/billing/subscriptionSync.js';
import {
  TRIAL_DAYS,
  attachTrialSession,
  checkTrialEligibility,
  releaseTrialReservation,
  reserveTrial,
} from '../../../services/billing/trialService.js';

const BASE = '/api/dashboard/guilds/{guildId}/billing';

/** Offres achetables en ligne. `CUSTOM` se négocie, il n'est pas proposé ici. */
const PurchasablePlan = z.enum(['PRO', 'ULTIMATE']);
const Interval = z.enum(['month', 'year']);

export function createBillingRouter(client: Client): OpenAPIHono {
  const router = new OpenAPIHono();

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhook Stripe
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Déclaré hors d'`openapi()` : la vérification de signature exige le corps
   * **brut**, or le validateur zod-openapi le consomme et le reformate. Un
   * simple `.post()` nous laisse lire le texte tel qu'il est arrivé.
   *
   * Ni `requireAuth` ni rate-limit : Stripe n'a pas de session, et brider le
   * débit reviendrait à jeter des événements de paiement en cas de rafale.
   */
  router.post('/api/billing/webhook', async (c) => {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (!stripe || !webhookSecret) {
      logger.warn('Billing', 'Webhook reçu alors que la facturation n\'est pas configurée.');
      return c.json({ error: 'Facturation non configurée' }, 503);
    }

    const signature = c.req.header('stripe-signature');
    if (!signature) return c.json({ error: 'Signature Stripe absente' }, 400);

    const rawBody = await c.req.text();

    let event: Stripe.Event;
    try {
      // Variante asynchrone : elle s'appuie sur la Web Crypto API, disponible
      // sous Bun, là où la variante synchrone attend le `crypto` de Node.
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
    } catch (err) {
      // Un 400 est la bonne réponse : Stripe ne réessaiera pas un corps qu'il
      // n'a pas signé, et un attaquant n'apprend rien.
      logger.warn('Billing', 'Signature de webhook invalide :', err);
      return c.json({ error: 'Signature invalide' }, 400);
    }

    // Idempotence. Stripe garantit *au moins* une livraison : le même événement
    // peut revenir après un timeout ou un rejeu manuel. La clé primaire fait le
    // verrou, sans transaction ni cache.
    try {
      await prisma.billingEvent.create({
        data: { id: event.id, type: event.type, payload: event as unknown as object },
      });
    } catch {
      logger.debug('Billing', `Événement ${event.id} déjà traité, ignoré.`);
      return c.json({ received: true, duplicate: true }, 200);
    }

    try {
      const guildId = await handleEvent(event);
      if (guildId) await prisma.billingEvent.update({ where: { id: event.id }, data: { guildId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.billingEvent.update({ where: { id: event.id }, data: { error: message } }).catch(() => null);
      logger.error('Billing', `Traitement de l'événement ${event.id} (${event.type}) en échec :`, err);

      // 500 : Stripe rejouera l'événement pendant 3 jours. La ligne
      // `BillingEvent` est déjà posée, donc le rejeu serait rejeté comme
      // doublon — on la supprime pour que la nouvelle tentative aboutisse.
      await prisma.billingEvent.delete({ where: { id: event.id } }).catch(() => null);
      return c.json({ error: 'Traitement en échec' }, 500);
    }

    return c.json({ received: true }, 200);
  });

  /**
   * Aiguillage des événements. Renvoie le serveur concerné, pour la trace.
   *
   * La liste est volontairement courte : tous les changements d'abonnement
   * (souscription, changement d'offre, renouvellement, résiliation, impayé)
   * finissent par produire un `customer.subscription.*`, et `syncSubscription`
   * recalcule l'état complet à partir de l'abonnement. Écouter plus
   * d'événements multiplierait les chemins sans rien apporter.
   */
  async function handleEvent(event: Stripe.Event): Promise<string | null> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const guildId = session.metadata?.guildId ?? session.client_reference_id ?? null;

        // Le paiement est encaissé mais l'abonnement n'est pas encore forcément
        // dans l'état final. On le relit plutôt que de déduire quoi que ce soit
        // de la session : `customer.subscription.created` arrivera de toute
        // façon, et les deux chemins convergent vers le même `syncSubscription`.
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!subscriptionId) return guildId;

        const stripe = getStripe();
        const subscription = await stripe!.subscriptions.retrieve(subscriptionId);
        await syncSubscription(subscription);
        return guildId ?? (await guildIdForSubscription(subscription));
      }

      case 'checkout.session.expired': {
        // Session ouverte puis abandonnée. Si elle portait un essai, la
        // réservation est libérée : regarder la page de paiement ne consomme
        // pas les 15 jours.
        const session = event.data.object as Stripe.Checkout.Session;
        await releaseTrialReservation({ checkoutSessionId: session.id });
        return session.metadata?.guildId ?? session.client_reference_id ?? null;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(subscription);
        return guildIdForSubscription(subscription);
      }

      default:
        logger.debug('Billing', `Événement ${event.type} ignoré.`);
        return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Routes dashboard
  // ═══════════════════════════════════════════════════════════════════════════

  const PlanCard = z.object({
    key: z.enum(PLAN_KEYS),
    name: z.string(),
    tagline: z.string(),
    description: z.string(),
    modules: z.array(z.string()),
    priceCents: z.object({ month: z.number(), year: z.number() }).nullable(),
    purchasable: z.boolean(),
  });

  /**
   * Essai gratuit, tel que le dashboard doit le présenter. `days` est renvoyé
   * même quand l'essai n'est plus disponible : la page l'affiche dans son texte
   * d'explication, et la durée ne doit pas être écrite en dur côté client.
   */
  const TrialInfo = z.object({
    available: z.boolean(),
    days: z.number(),
    reason: z
      .enum(['already_used_by_user', 'already_used_by_guild', 'guild_has_subscription', 'plan_not_eligible'])
      .nullable(),
  });

  const BillingStatus = z.object({
    enabled: z.boolean(),
    plan: z.enum(PLAN_KEYS),
    planName: z.string(),
    status: z.string().nullable(),
    currentPeriodEnd: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    hasSubscription: z.boolean(),
    trial: TrialInfo,
    plans: z.array(PlanCard),
  });

  const statusRoute = createRoute({
    method: 'get',
    path: BASE,
    summary: "Offre du serveur et grille tarifaire",
    tags: ['Billing'],
    request: { params: z.object({ guildId: z.string() }) },
    responses: {
      200: { description: 'État de facturation', content: { 'application/json': { schema: BillingStatus } } },
    },
  });

  // Deux enregistrements et non un seul : `use()` avec un chemin exact ne
  // couvre pas les sous-routes, et `/*` ne couvre pas le chemin nu. Les oublier
  // laisserait `/billing/checkout` et `/billing/portal` ouverts sans session —
  // n'importe qui pourrait ouvrir une session de paiement au nom d'un serveur.
  //
  // Niveau `admin` : engager une dépense pour un serveur n'est pas un acte de
  // modération, c'est une décision de celui qui le dirige.
  const GUARDED = BASE.replace('{guildId}', ':guildId');
  router.use(GUARDED, requireAuth, requireGuildAccess(client, 'admin'));
  router.use(`${GUARDED}/*`, requireAuth, requireGuildAccess(client, 'admin'));

  router.openapi(statusRoute, async (c) => {
    const { guildId } = c.req.valid('param');

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: {
        plan: true,
        stripeSubscriptionId: true,
        stripeSubscriptionStatus: true,
        stripeCurrentPeriodEnd: true,
        stripeCancelAtPeriodEnd: true,
      },
    });

    const sellable = new Set(sellablePlans());
    const plan = normalizePlanKey(guild?.plan);

    // Éligibilité évaluée sur PRO : les deux offres vendues en ligne partagent
    // la même règle, et l'essai se consomme une fois quelle que soit celle qui
    // le déclenche. Elle dépend de l'utilisateur connecté, pas seulement du
    // serveur — deux administrateurs du même serveur peuvent voir un bouton
    // différent, et c'est exactement ce que la règle « une fois par compte
    // Discord » implique.
    const trial = await checkTrialEligibility(guildId, c.var.auth.userId, 'PRO');

    return c.json({
      enabled: isBillingEnabled(),
      plan,
      planName: getPlanDefinition(plan).name,
      status: guild?.stripeSubscriptionStatus ?? null,
      currentPeriodEnd: guild?.stripeCurrentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: guild?.stripeCancelAtPeriodEnd ?? false,
      hasSubscription: Boolean(guild?.stripeSubscriptionId),
      trial: { available: trial.eligible, days: trial.days, reason: trial.reason ?? null },
      plans: PLAN_REGISTRY.map((definition) => ({
        key: definition.key,
        name: definition.name,
        tagline: definition.tagline,
        description: definition.description,
        modules: modulesForPlan(definition.key),
        priceCents: definition.displayPriceCents,
        purchasable: sellable.has(definition.key),
      })),
    }, 200);
  });

  // ─── Ouverture d'une session de paiement ───────────────────────────────────

  const checkoutRoute = createRoute({
    method: 'post',
    path: `${BASE}/checkout`,
    summary: "Ouvre une session de paiement Stripe",
    tags: ['Billing'],
    request: {
      params: z.object({ guildId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({ plan: PurchasablePlan, interval: Interval }),
          },
        },
      },
    },
    responses: {
      200: { description: 'URL de paiement', content: { 'application/json': { schema: z.object({ url: z.string() }) } } },
      503: { description: 'Facturation non configurée', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
    },
  });

  // Ces deux routes ouvrent des sessions côté Stripe : on les bride comme les
  // autres actions sensibles, un clic répété ne devant pas créer dix sessions.
  router.use(`${GUARDED}/checkout`, rateLimit(dashboardSensitiveRateLimiter, 10, 60 * 1000));
  router.use(`${GUARDED}/portal`, rateLimit(dashboardSensitiveRateLimiter, 10, 60 * 1000));

  router.openapi(checkoutRoute, async (c) => {
    if (!isBillingEnabled()) return c.json({ error: 'Facturation non configurée sur cette instance.' }, 503);

    const { guildId } = c.req.valid('param');
    const { plan, interval } = c.req.valid('json');
    const auth = c.var.auth;

    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { stripeCustomerId: true },
    });

    const discordGuild = client.guilds.cache.get(guildId) ?? null;

    try {
      const customerId = await ensureCustomer(guildId, guild?.stripeCustomerId ?? null, {
        guildName: discordGuild?.name,
        ownerId: discordGuild?.ownerId,
      });

      // Écrit avant la redirection : si l'utilisateur abandonne le paiement, le
      // client Stripe existe déjà et sera réutilisé au lieu d'en créer un second.
      await prisma.guild.upsert({
        where: { id: guildId },
        update: { stripeCustomerId: customerId },
        create: { id: guildId, stripeCustomerId: customerId },
      });

      // L'essai est réservé *avant* d'appeler Stripe : l'insertion en base est
      // le verrou qui garantit « une fois par compte Discord », et un
      // aller-retour réseau laisserait passer un second clic. En échec de
      // réservation, on ouvre simplement un parcours d'achat sans essai plutôt
      // que de renvoyer une erreur.
      const eligibility = await checkTrialEligibility(guildId, auth.userId, plan as PlanKey);
      const trialReserved =
        eligibility.eligible && (await reserveTrial(guildId, auth.userId, plan as PlanKey, interval));

      let session: { id: string; url: string };
      try {
        session = await createCheckoutSession({
          guildId,
          customerId,
          plan: plan as PlanKey,
          interval,
          initiatedBy: auth.userId,
          trialDays: trialReserved ? TRIAL_DAYS : 0,
        });
      } catch (err) {
        // Stripe n'a pas ouvert la page : l'essai n'a jamais démarré, la
        // réservation ne doit pas rester posée.
        if (trialReserved) await releaseTrialReservation({ discordUserId: auth.userId });
        throw err;
      }

      if (trialReserved) await attachTrialSession(auth.userId, session.id);

      return c.json({ url: session.url }, 200);
    } catch (err) {
      logger.error('Billing', `Ouverture du paiement impossible pour ${guildId}:`, err);
      throw new HTTPException(502, { message: "Stripe n'a pas pu ouvrir la page de paiement." });
    }
  });

  // ─── Portail client (factures, moyen de paiement, résiliation) ─────────────

  const portalRoute = createRoute({
    method: 'post',
    path: `${BASE}/portal`,
    summary: 'Ouvre le portail client Stripe',
    tags: ['Billing'],
    request: { params: z.object({ guildId: z.string() }) },
    responses: {
      200: { description: 'URL du portail', content: { 'application/json': { schema: z.object({ url: z.string() }) } } },
      404: { description: 'Aucun client Stripe', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
      503: { description: 'Facturation non configurée', content: { 'application/json': { schema: z.object({ error: z.string() }) } } },
    },
  });

  router.openapi(portalRoute, async (c) => {
    if (!isBillingEnabled()) return c.json({ error: 'Facturation non configurée sur cette instance.' }, 503);

    const { guildId } = c.req.valid('param');
    const guild = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { stripeCustomerId: true },
    });

    if (!guild?.stripeCustomerId) {
      return c.json({ error: "Ce serveur n'a jamais souscrit d'abonnement." }, 404);
    }

    try {
      const url = await createPortalSession(guildId, guild.stripeCustomerId);
      return c.json({ url }, 200);
    } catch (err) {
      logger.error('Billing', `Ouverture du portail impossible pour ${guildId}:`, err);
      throw new HTTPException(502, { message: "Stripe n'a pas pu ouvrir le portail client." });
    }
  });

  return router;
}
