import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import {
  ACTIONS_PANNEAU,
  boutonDemanderAccesVisible,
  CHANNEL_PATCHES,
  cleMembreSalon,
  decisionEntreeVocal,
  decisionRetraitAutorisation,
  decisionSortieVocal,
  enregistrerRenommage,
  estModeEcriture,
  EXPIRATION_DEMANDE_MS,
  FENETRE_RENOMMAGE_MS,
  historiqueRenommageElague,
  libelleActionMembre,
  libelleRenommer,
  LIBELLES_MODES_ECRITURE,
  MODES_ECRITURE,
  modeEcritureDepuisTextChat,
  normaliserModeEcriture,
  normaliserReglagesAdmin,
  peutAgir,
  peutAgirSurCible,
  quotaRenommage,
  raisonAdminsSeulement,
  reglagesAdminParDefaut,
  reglagesVerrouilles,
  RegistreDemandesAcces,
  RegistreOriginesSurcharge,
  RENOMMAGES_PAR_FENETRE,
  SILENCE_APRES_REFUS_MS,
  surchargesModeEcriture,
  textChatDepuisModeEcriture,
  transitionModeEcriture,
  type CibleMembre,
  type ModeEcriture,
  type OrigineSurcharge,
  type ReglagesAdmin,
} from '../../services/features/tempVoiceService.js';

/**
 * Refonte du panneau vocal — partie pure. Aucune de ces fonctions ne parle à
 * Discord ni ne lit l'horloge : l'instant est toujours un paramètre, sans quoi
 * vérifier « dix minutes de silence » demanderait dix minutes.
 *
 * Les cas retenus sont ceux où une erreur ne se voit pas : une autorisation
 * explicite effacée par une sortie de vocal, un quota qui libère le mauvais
 * créneau, un refus sans motif, un silence qui survit au salon.
 */

const GUILD = '100000000000000000';
const SALON = '200000000000000000';
const AUTRE_SALON = '200000000000000001';
const ALICE = '300000000000000000';
const BOB = '300000000000000001';

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

function cible(partiel: Partial<CibleMembre> = {}): CibleMembre {
  return {
    estStaff: false,
    estProprietaire: false,
    estSoiMeme: false,
    dansLeSalon: true,
    autorise: false,
    ...partiel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Les quatre modes d'écriture
// ─────────────────────────────────────────────────────────────────────────────

describe('modes d’écriture — CHANNEL_PATCHES', () => {
  test('nommer les deux modes existants ne change pas un bit', () => {
    // `everyone` et `ownerOnly` sont l'ancien `openChat` et l'ancien `closeChat` :
    // si la refonte les avait redéfinis, des salons en place changeraient d'état
    // sans que personne n'ait cliqué.
    expect(CHANNEL_PATCHES.everyone).toEqual(CHANNEL_PATCHES.openChat);
    expect(CHANNEL_PATCHES.ownerOnly).toEqual(CHANNEL_PATCHES.closeChat);
  });

  test('les quatre modes existent et aucun n’autorise explicitement @everyone', () => {
    for (const mode of MODES_ECRITURE) {
      const patch = CHANNEL_PATCHES[mode] as Record<string, boolean | null>;
      expect(patch).toBeDefined();
      // Rien de ce qui rouvre un salon n'accorde : on rend le droit à la catégorie.
      expect(patch.SendMessages).not.toBe(true);
    }
  });

  test('chaque mode porte le libellé de la maquette', () => {
    expect(LIBELLES_MODES_ECRITURE.everyone.libelle).toBe('Tout le monde');
    expect(LIBELLES_MODES_ECRITURE.inVoice.libelle).toBe('Ceux qui sont en vocal');
    expect(LIBELLES_MODES_ECRITURE.ownerOnly.libelle).toBe('Moi seul');
    expect(LIBELLES_MODES_ECRITURE.nobody.libelle).toBe('Personne');
    // L'ordre du menu est celui de la maquette, pas l'ordre alphabétique.
    expect([...MODES_ECRITURE]).toEqual(['everyone', 'inVoice', 'ownerOnly', 'nobody']);
  });
});

describe('surchargesModeEcriture', () => {
  test('« Tout le monde » rend le droit à la catégorie des deux côtés', () => {
    const surcharges = surchargesModeEcriture('everyone');
    expect(surcharges.everyone).toEqual({ SendMessages: null });
    expect(surcharges.proprietaire).toEqual({ SendMessages: null });
    expect(surcharges.suitLaPresence).toBe(false);
  });

  test('« Tout le monde » n’écrase pas un refus nommé de la catégorie', () => {
    // Sinon le bouton d'un propriétaire rouvrirait un salon que la catégorie ferme.
    const surcharges = surchargesModeEcriture('everyone', {
      allow: 0n,
      deny: PermissionFlagsBits.SendMessages,
    });
    expect(surcharges.everyone).toEqual({ SendMessages: false });
  });

  test('« Moi seul » coupe @everyone et rend l’écriture au propriétaire', () => {
    const surcharges = surchargesModeEcriture('ownerOnly');
    expect(surcharges.everyone).toEqual({ SendMessages: false });
    // Sans cette autorisation nommée, fermer le chat rendrait le propriétaire
    // muet chez lui — la règle que `ownerChatPatch` porte déjà.
    expect(surcharges.proprietaire).toEqual({ SendMessages: true });
  });

  test('« Moi seul » cède devant un refus nommé de la catégorie sur le propriétaire', () => {
    const surcharges = surchargesModeEcriture('ownerOnly', null, {
      allow: 0n,
      deny: PermissionFlagsBits.SendMessages,
    });
    expect(surcharges.proprietaire).toEqual({ SendMessages: false });
  });

  test('« Personne » coupe aussi le propriétaire — c’est tout ce qui le sépare de « Moi seul »', () => {
    const nobody = surchargesModeEcriture('nobody');
    const ownerOnly = surchargesModeEcriture('ownerOnly');

    expect(nobody.everyone).toEqual(ownerOnly.everyone);
    expect(nobody.proprietaire).toEqual({ SendMessages: false });
    expect(nobody.proprietaire).not.toEqual(ownerOnly.proprietaire);
  });

  test('« Ceux qui sont en vocal » ne donne aucun allow nommé au propriétaire', () => {
    const surcharges = surchargesModeEcriture('inVoice');
    expect(surcharges.everyone).toEqual({ SendMessages: false });
    // Un `allow` nommé sur le propriétaire ferait de `inVoice` un `ownerOnly`
    // déguisé : il écrirait même hors du vocal.
    expect(surcharges.proprietaire).toEqual({ SendMessages: null });
    expect(surcharges.suitLaPresence).toBe(true);
  });

  test('un seul mode suit la présence', () => {
    const suiveurs = MODES_ECRITURE.filter((mode) => surchargesModeEcriture(mode).suitLaPresence);
    expect(suiveurs).toEqual(['inVoice']);
  });
});

describe('normalisation et pont vers l’ancien réglage', () => {
  test('une valeur inconnue retombe sur le comportement historique', () => {
    expect(normaliserModeEcriture('nawak')).toBe('everyone');
    expect(normaliserModeEcriture(undefined)).toBe('everyone');
    expect(normaliserModeEcriture('nobody')).toBe('nobody');
    expect(estModeEcriture('inVoice')).toBe(true);
    expect(estModeEcriture('locked')).toBe(false);
  });

  test('le repli vers trois valeurs ne rouvre jamais un salon fermé', () => {
    // `inVoice` et `nobody` refusent @everyone : ils se rangent sous `locked`.
    // Les ranger sous `open` ouvrirait le chat d'une base pas encore migrée.
    expect(textChatDepuisModeEcriture('everyone')).toBe('open');
    expect(textChatDepuisModeEcriture('inVoice')).toBe('locked');
    expect(textChatDepuisModeEcriture('ownerOnly')).toBe('locked');
    expect(textChatDepuisModeEcriture('nobody')).toBe('locked');

    expect(modeEcritureDepuisTextChat('open')).toBe('everyone');
    expect(modeEcritureDepuisTextChat('locked')).toBe('ownerOnly');
    expect(modeEcritureDepuisTextChat('inherit')).toBe('everyone');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Le quota de renommage
// ─────────────────────────────────────────────────────────────────────────────

describe('quotaRenommage', () => {
  test('un salon jamais renommé a ses deux jetons', () => {
    expect(quotaRenommage([], T0)).toEqual({ restants: 2, libereA: null });
    expect(RENOMMAGES_PAR_FENETRE).toBe(2);
  });

  test('le deuxième renommage épuise le quota et annonce la libération', () => {
    const historique = [T0 - 4 * MINUTE, T0 - MINUTE];
    expect(quotaRenommage(historique, T0)).toEqual({
      restants: 0,
      libereA: T0 - 4 * MINUTE + FENETRE_RENOMMAGE_MS,
    });
  });

  test('un renommage vieux de dix minutes pile est sorti de la fenêtre', () => {
    // La borne compte : à une milliseconde près, le bouton reste grisé pour rien.
    expect(quotaRenommage([T0 - FENETRE_RENOMMAGE_MS, T0 - MINUTE], T0).restants).toBe(1);
    expect(quotaRenommage([T0 - FENETRE_RENOMMAGE_MS + 1, T0 - MINUTE], T0).restants).toBe(0);
  });

  test('avec plus d’entrées que le quota, c’est l’avant-dernière qui libère', () => {
    // Prendre la plus ancienne annoncerait une libération trop tôt : à cet
    // instant-là il resterait encore deux renommages dans la fenêtre.
    const historique = [T0 - 9 * MINUTE, T0 - 6 * MINUTE, T0 - MINUTE];
    const quota = quotaRenommage(historique, T0);
    expect(quota.restants).toBe(0);
    expect(quota.libereA).toBe(T0 - 6 * MINUTE + FENETRE_RENOMMAGE_MS);
    // Contrôle : à cet instant, un jeton est bien revenu.
    expect(quotaRenommage(historique, quota.libereA as number).restants).toBe(1);
  });

  test('un historique non trié ou pollué ne fausse pas le calcul', () => {
    const quota = quotaRenommage([T0 - MINUTE, Number.NaN, T0 - 4 * MINUTE], T0);
    expect(quota).toEqual({ restants: 0, libereA: T0 - 4 * MINUTE + FENETRE_RENOMMAGE_MS });
  });

  test('l’historique s’élague au lieu de grossir sans fin', () => {
    const vieux = [T0 - 30 * MINUTE, T0 - 20 * MINUTE, T0 - MINUTE];
    expect(historiqueRenommageElague(vieux, T0)).toEqual([T0 - MINUTE]);
    expect(enregistrerRenommage(vieux, T0)).toEqual([T0 - MINUTE, T0]);
  });
});

describe('libelleRenommer', () => {
  test('affiche le quota restant, puis le décompte, comme la maquette', () => {
    expect(libelleRenommer(quotaRenommage([], T0), T0)).toBe('✏️ Renommer (2/2)');

    const epuise = quotaRenommage([T0 - 4 * MINUTE, T0 - MINUTE], T0);
    expect(libelleRenommer(epuise, T0)).toBe('✏️ Renommer (0/2 · 6 min)');
  });

  test('un reste de quelques secondes n’annonce jamais « 0 min »', () => {
    // Un bouton grisé qui affiche zéro minute passe pour un blocage.
    expect(libelleRenommer({ restants: 0, libereA: T0 + 1 }, T0)).toBe('✏️ Renommer (0/2 · 1 min)');
    expect(libelleRenommer({ restants: 0, libereA: T0 + 5 * MINUTE + 30_000 }, T0)).toBe(
      '✏️ Renommer (0/2 · 6 min)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Le registre des demandes d'accès
// ─────────────────────────────────────────────────────────────────────────────

describe('RegistreDemandesAcces', () => {
  test('la clé identifie la personne dans ce salon de ce serveur', () => {
    expect(cleMembreSalon(GUILD, SALON, ALICE)).toBe(`${GUILD}:${SALON}:${ALICE}`);
  });

  test('une première demande s’enregistre et porte son échéance', () => {
    const registre = new RegistreDemandesAcces();
    const resultat = registre.demander(GUILD, SALON, ALICE, T0);

    expect(resultat.statut).toBe('enregistree');
    if (resultat.statut !== 'enregistree') throw new Error('statut inattendu');
    expect(resultat.demande.expireA).toBe(T0 + EXPIRATION_DEMANDE_MS);
  });

  test('un second clic ne renvoie rien : la demande est déjà en attente', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);
    const second = registre.demander(GUILD, SALON, ALICE, T0 + MINUTE);

    expect(second.statut).toBe('dejaEnAttente');
    if (second.statut !== 'dejaEnAttente') throw new Error('statut inattendu');
    expect(second.resteMs).toBe(EXPIRATION_DEMANDE_MS - MINUTE);
    // Une seule demande, pas deux pings pour le propriétaire.
    expect(registre.taille.demandes).toBe(1);
  });

  test('une demande expirée laisse repartir de zéro', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);

    expect(registre.demandeEnAttente(GUILD, SALON, ALICE, T0 + EXPIRATION_DEMANDE_MS)).toBeNull();
    const reprise = registre.demander(GUILD, SALON, ALICE, T0 + EXPIRATION_DEMANDE_MS);
    expect(reprise.statut).toBe('enregistree');
  });

  test('un refus vaut dix minutes de silence, avec le temps restant', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);
    const decision = registre.resoudre(GUILD, SALON, ALICE, 'refusee', T0 + MINUTE);

    expect(decision.demande?.userId).toBe(ALICE);
    expect(decision.silenceJusquA).toBe(T0 + MINUTE + SILENCE_APRES_REFUS_MS);

    const redemande = registre.demander(GUILD, SALON, ALICE, T0 + 5 * MINUTE);
    expect(redemande.statut).toBe('silence');
    if (redemande.statut !== 'silence') throw new Error('statut inattendu');
    expect(redemande.resteMs).toBe(SILENCE_APRES_REFUS_MS - 4 * MINUTE);
  });

  test('le silence s’éteint à l’échéance, pas après', () => {
    const registre = new RegistreDemandesAcces();
    registre.resoudre(GUILD, SALON, ALICE, 'refusee', T0);

    expect(registre.estEnSilence(GUILD, SALON, ALICE, T0 + SILENCE_APRES_REFUS_MS - 1)).toBe(true);
    expect(registre.estEnSilence(GUILD, SALON, ALICE, T0 + SILENCE_APRES_REFUS_MS)).toBe(false);
    expect(registre.demander(GUILD, SALON, ALICE, T0 + SILENCE_APRES_REFUS_MS).statut).toBe(
      'enregistree',
    );
  });

  test('une acceptation efface un silence antérieur', () => {
    const registre = new RegistreDemandesAcces();
    registre.resoudre(GUILD, SALON, ALICE, 'refusee', T0);
    registre.resoudre(GUILD, SALON, ALICE, 'acceptee', T0 + MINUTE);

    expect(registre.estEnSilence(GUILD, SALON, ALICE, T0 + 2 * MINUTE)).toBe(false);
  });

  test('deux salons ne se partagent ni demande ni silence', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);
    registre.resoudre(GUILD, SALON, ALICE, 'refusee', T0);

    // Refusée ici ne veut pas dire refusée partout.
    expect(registre.demander(GUILD, AUTRE_SALON, ALICE, T0).statut).toBe('enregistree');
  });

  test('tout disparaît à la mort du salon — demandes et silences', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);
    registre.resoudre(GUILD, SALON, BOB, 'refusee', T0);
    registre.demander(GUILD, AUTRE_SALON, ALICE, T0);

    expect(registre.oublierSalon(GUILD, SALON)).toBe(2);
    expect(registre.taille).toEqual({ demandes: 1, silences: 0 });
    // Un silence orphelin ferait taire quelqu'un dans un salon qui n'existe plus.
    expect(registre.estEnSilence(GUILD, SALON, BOB, T0 + MINUTE)).toBe(false);
    expect(registre.demandeEnAttente(GUILD, AUTRE_SALON, ALICE, T0 + MINUTE)).not.toBeNull();
  });

  test('la purge périodique nettoie sans toucher au vivant', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, ALICE, T0);
    registre.resoudre(GUILD, SALON, BOB, 'refusee', T0);
    registre.demander(GUILD, AUTRE_SALON, ALICE, T0 + 9 * MINUTE);

    expect(registre.purger(T0 + EXPIRATION_DEMANDE_MS)).toBe(2);
    expect(registre.taille).toEqual({ demandes: 1, silences: 0 });
  });

  test('les demandes d’un salon sortent dans l’ordre d’arrivée', () => {
    const registre = new RegistreDemandesAcces();
    registre.demander(GUILD, SALON, BOB, T0 + MINUTE);
    registre.demander(GUILD, SALON, ALICE, T0);
    registre.demander(GUILD, AUTRE_SALON, ALICE, T0);

    const demandes = registre.demandesDuSalon(GUILD, SALON, T0 + 2 * MINUTE);
    expect(demandes.map((d) => d.userId)).toEqual([ALICE, BOB]);
  });

  test('les durées sont réglables, comme dans l’onglet du dashboard', () => {
    const registre = new RegistreDemandesAcces({ expirationMs: 2 * MINUTE, silenceMs: 30_000 });
    const resultat = registre.demander(GUILD, SALON, ALICE, T0);
    if (resultat.statut !== 'enregistree') throw new Error('statut inattendu');

    expect(resultat.demande.expireA).toBe(T0 + 2 * MINUTE);
    registre.resoudre(GUILD, SALON, ALICE, 'refusee', T0);
    expect(registre.estEnSilence(GUILD, SALON, ALICE, T0 + 29_000)).toBe(true);
    expect(registre.estEnSilence(GUILD, SALON, ALICE, T0 + 30_000)).toBe(false);
  });

  test('le bouton n’apparaît que lorsqu’il sert', () => {
    expect(boutonDemanderAccesVisible({ verrouille: true, reserve: false })).toBe(true);
    expect(boutonDemanderAccesVisible({ verrouille: false, reserve: true })).toBe(true);
    // Un salon plein, c'est une place qui manque, pas une permission.
    expect(boutonDemanderAccesVisible({ verrouille: false, reserve: false })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. La matrice de permissions
// ─────────────────────────────────────────────────────────────────────────────

const TOUT_AUTORISE: ReglagesAdmin = reglagesAdminParDefaut();

describe('normaliserReglagesAdmin', () => {
  test('sans réglage, un modérateur garde ce qu’il a aujourd’hui', () => {
    // La refonte pose des limites là où il n'y en a aucune : elle n'en retire
    // aucune tant qu'un admin ne l'a pas demandé.
    const reglages = normaliserReglagesAdmin(null);
    expect(Object.values(reglages).every((valeur) => valeur === 'autorise')).toBe(true);
    expect(normaliserReglagesAdmin('nawak')).toEqual(reglages);
    expect(normaliserReglagesAdmin([])).toEqual(reglages);
  });

  test('les booléens et les libellés sont acceptés, l’inconnu est ignoré', () => {
    const reglages = normaliserReglagesAdmin({
      modeEcriture: 'adminsSeulement',
      transferer: false,
      renommer: true,
      limite: 'nawak',
      inexistant: false,
    });

    expect(reglages.modeEcriture).toBe('adminsSeulement');
    expect(reglages.transferer).toBe('adminsSeulement');
    expect(reglages.renommer).toBe('autorise');
    expect(reglages.limite).toBe('autorise');
    expect('inexistant' in reglages).toBe(false);
  });

  test('reglagesVerrouilles liste ce qui est fermé, dans l’ordre canonique', () => {
    expect(reglagesVerrouilles({ reserver: false, modeEcriture: false })).toEqual([
      'modeEcriture',
      'reserver',
    ]);
    expect(reglagesVerrouilles(TOUT_AUTORISE)).toEqual([]);
  });
});

describe('raisonAdminsSeulement', () => {
  test('reprend la phrase de la maquette, au singulier comme au pluriel', () => {
    expect(raisonAdminsSeulement(['modeEcriture', 'reserver'])).toBe(
      "Le mode d'écriture et la réservation sont réservés aux admins sur ce serveur.",
    );
    expect(raisonAdminsSeulement(['modeEcriture'])).toBe(
      "Le mode d'écriture est réservé aux admins sur ce serveur.",
    );
    // Accord au féminin : « est réservée », pas « est réservé ».
    expect(raisonAdminsSeulement(['reserver'])).toBe(
      'La réservation est réservée aux admins sur ce serveur.',
    );
    // Une ligne qui couvre deux actions reste au pluriel, même seule.
    expect(raisonAdminsSeulement(['expulserBannir'])).toBe(
      "L'expulsion et le bannissement sont réservés aux admins sur ce serveur.",
    );
  });

  test('l’ordre des arguments ne change pas la phrase', () => {
    expect(raisonAdminsSeulement(['reserver', 'modeEcriture'])).toBe(
      raisonAdminsSeulement(['modeEcriture', 'reserver']),
    );
  });

  test('rien à dire ne produit pas une phrase vide à moitié écrite', () => {
    expect(raisonAdminsSeulement([])).toBe('');
  });
});

describe('peutAgir', () => {
  test('le propriétaire fait tout chez lui, sauf ce qui n’a pas de sens', () => {
    expect(peutAgir('proprietaire', 'modeEcriture', { modeEcriture: false }).autorise).toBe(true);
    expect(peutAgir('proprietaire', 'reserver', { reserver: false }).autorise).toBe(true);

    // Jamais un bouton mort : ces deux-là sont refusés avec leur motif.
    const recuperer = peutAgir('proprietaire', 'recuperer', TOUT_AUTORISE);
    expect(recuperer).toEqual({
      autorise: false,
      motif: 'dejaProprietaire',
      raison: 'Tu es déjà propriétaire de ce salon.',
    });
    expect(peutAgir('proprietaire', 'demanderAcces', TOUT_AUTORISE).autorise).toBe(false);
  });

  test('un admin n’est jamais arrêté par les réglages des modérateurs', () => {
    for (const action of ACTIONS_PANNEAU) {
      const verdict = peutAgir('admin', action, {
        modeEcriture: false,
        reserver: false,
        transferer: false,
        expulserBannir: false,
        renommer: false,
        limite: false,
        verrouiller: false,
      });
      expect(verdict.autorise).toBe(true);
    }
  });

  test('un modérateur garde tout tant qu’un admin n’a rien fermé', () => {
    for (const action of ACTIONS_PANNEAU) {
      expect(peutAgir('moderateur', action, TOUT_AUTORISE).autorise).toBe(true);
    }
  });

  test('un réglage fermé refuse le modérateur en disant pourquoi', () => {
    const verdict = peutAgir('moderateur', 'modeEcriture', { modeEcriture: 'adminsSeulement' });
    expect(verdict).toEqual({
      autorise: false,
      motif: 'adminsSeulement',
      raison: "Le mode d'écriture est réservé aux admins sur ce serveur.",
    });
    // Un refus sans motif redonnerait le panneau d'aujourd'hui : on découvre
    // l'interdiction après le clic.
    if (verdict.autorise) throw new Error('verdict inattendu');
    expect(verdict.raison.length).toBeGreaterThan(0);
  });

  test('la ligne « Expulser / bannir » gouverne bien les deux actions', () => {
    const reglages = { expulserBannir: 'adminsSeulement' };
    expect(peutAgir('moderateur', 'expulser', reglages).autorise).toBe(false);
    expect(peutAgir('moderateur', 'bannir', reglages).autorise).toBe(false);
    // ... et rien d'autre.
    expect(peutAgir('moderateur', 'renommer', reglages).autorise).toBe(true);
  });

  test('fermer une ligne n’en ferme aucune autre', () => {
    const verrouille = peutAgir('moderateur', 'transferer', { transferer: false });
    expect(verrouille.autorise).toBe(false);
    expect(peutAgir('moderateur', 'recuperer', { transferer: false }).autorise).toBe(true);
  });
});

describe('peutAgirSurCible', () => {
  test('le staff ne peut être ni expulsé ni banni, et la raison le nomme', () => {
    const bob = cible({ nom: 'Bob', estStaff: true });
    const verdict = peutAgirSurCible('proprietaire', 'expulser', TOUT_AUTORISE, bob);

    expect(verdict).toEqual({
      autorise: false,
      motif: 'cibleStaff',
      raison: 'Bob fait partie du staff : il ne peut être ni expulsé ni banni.',
    });
    expect(peutAgirSurCible('proprietaire', 'bannir', TOUT_AUTORISE, bob).autorise).toBe(false);
    // Le staff reste transférable : on peut lui donner le salon.
    expect(peutAgirSurCible('proprietaire', 'transferer', TOUT_AUTORISE, bob).autorise).toBe(true);
  });

  test('sans nom, la raison reste lisible', () => {
    const verdict = peutAgirSurCible('proprietaire', 'expulser', TOUT_AUTORISE, cible({ estStaff: true }));
    if (verdict.autorise) throw new Error('verdict inattendu');
    expect(verdict.raison).toBe(
      'Cette personne fait partie du staff : elle ne peut être ni expulsée ni bannie.',
    );
  });

  test('on bannit quelqu’un d’absent, on ne l’expulse pas', () => {
    const absent = cible({ nom: 'Alice', dansLeSalon: false });
    const expulser = peutAgirSurCible('proprietaire', 'expulser', TOUT_AUTORISE, absent);

    expect(expulser).toEqual({
      autorise: false,
      motif: 'cibleHorsSalon',
      raison: "Alice n'est pas dans le salon.",
    });
    // Bannir un absent a du sens : il ne verra plus le salon.
    expect(peutAgirSurCible('proprietaire', 'bannir', TOUT_AUTORISE, absent).autorise).toBe(true);
  });

  test('on ne se transfère pas le salon à soi-même, ni à son propriétaire', () => {
    expect(
      peutAgirSurCible('proprietaire', 'transferer', TOUT_AUTORISE, cible({ estSoiMeme: true })),
    ).toMatchObject({ autorise: false, motif: 'cibleSoiMeme' });

    expect(
      peutAgirSurCible('moderateur', 'transferer', TOUT_AUTORISE, cible({ nom: 'Toji', estProprietaire: true })),
    ).toEqual({
      autorise: false,
      motif: 'cibleDejaProprietaire',
      raison: 'Toji est déjà propriétaire du salon.',
    });
  });

  test('on ne s’expulse pas soi-même', () => {
    expect(
      peutAgirSurCible('proprietaire', 'expulser', TOUT_AUTORISE, cible({ estSoiMeme: true })),
    ).toMatchObject({ autorise: false, motif: 'cibleSoiMeme' });
  });

  test('le refus de rôle passe avant celui de la cible', () => {
    // Autrement un modérateur privé d'expulsion recevrait « cette personne est
    // du staff » et croirait le réglage ouvert.
    const verdict = peutAgirSurCible(
      'moderateur',
      'expulser',
      { expulserBannir: false },
      cible({ estStaff: true }),
    );
    expect(verdict).toMatchObject({ autorise: false, motif: 'adminsSeulement' });
  });

  test('le même bouton dit l’état de la personne', () => {
    expect(libelleActionMembre('autoriser', cible())).toBe('Autoriser');
    expect(libelleActionMembre('autoriser', cible({ autorise: true }))).toBe("Retirer l'accès");
    expect(libelleActionMembre('transferer', cible())).toBe('Lui donner le salon');
    expect(libelleActionMembre('expulser', cible())).toBe('Expulser');
    expect(libelleActionMembre('bannir', cible())).toBe('Bannir');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. L'origine des surcharges
// ─────────────────────────────────────────────────────────────────────────────

describe('origine des surcharges — entrées et sorties', () => {
  test('entrer en vocal pose une surcharge marquée « présence »', () => {
    expect(decisionEntreeVocal('inVoice', null)).toEqual({
      action: 'poser',
      origine: 'presence',
      patch: { SendMessages: true },
    });
  });

  test('entrer ne rétrograde pas une autorisation explicite', () => {
    expect(decisionEntreeVocal('inVoice', 'autorisation')).toEqual({
      action: 'conserver',
      motif: 'autorisationExplicite',
    });
    expect(decisionEntreeVocal('inVoice', 'presence')).toEqual({
      action: 'conserver',
      motif: 'dejaPosee',
    });
  });

  test('hors du mode « en vocal », entrer ne pose rien', () => {
    for (const mode of MODES_ECRITURE.filter((m) => m !== 'inVoice')) {
      expect(decisionEntreeVocal(mode, null)).toEqual({ action: 'aucune' });
    }
  });

  test('sortir retire une présence', () => {
    expect(decisionSortieVocal('inVoice', 'presence')).toEqual({
      action: 'retirer',
      patch: { SendMessages: null },
    });
  });

  test('SORTIR NE TOUCHE JAMAIS À UNE AUTORISATION EXPLICITE', () => {
    // Le point dur de toute la refonte. Sans la distinction d'origine, ce
    // départ effacerait un droit donné à la main par le propriétaire, et
    // personne ne comprendrait pourquoi l'accès a disparu.
    for (const mode of MODES_ECRITURE) {
      expect(decisionSortieVocal(mode, 'autorisation')).toEqual({
        action: 'conserver',
        motif: 'autorisationExplicite',
      });
    }
  });

  test('une présence laissée par un ancien mode se nettoie à la sortie', () => {
    expect(decisionSortieVocal('everyone', 'presence')).toEqual({
      action: 'retirer',
      patch: { SendMessages: null },
    });
    expect(decisionSortieVocal('everyone', null)).toEqual({ action: 'aucune' });
  });

  test('retirer l’accès à quelqu’un encore présent le rétrograde sans le rendre muet', () => {
    // Le retirer ici couperait l'écriture d'une personne pourtant connectée,
    // ce que le mode promet le contraire. Sa surcharge partira avec elle.
    expect(decisionRetraitAutorisation('inVoice', true)).toEqual({
      action: 'poser',
      origine: 'presence',
      patch: { SendMessages: true },
    });
    expect(decisionRetraitAutorisation('inVoice', false)).toEqual({
      action: 'retirer',
      patch: { SendMessages: null },
    });
    expect(decisionRetraitAutorisation('everyone', true)).toEqual({
      action: 'retirer',
      patch: { SendMessages: null },
    });
  });

  test('scénario complet : entrée, autorisation, sortie', () => {
    const registre = new RegistreOriginesSurcharge();

    // 1. Alice entre en vocal.
    const entree = decisionEntreeVocal('inVoice', registre.origine(GUILD, SALON, ALICE));
    expect(entree.action).toBe('poser');
    registre.marquer(GUILD, SALON, ALICE, 'presence');

    // 2. Le propriétaire clique « Autoriser » sur elle.
    registre.marquer(GUILD, SALON, ALICE, 'autorisation');
    expect(registre.origine(GUILD, SALON, ALICE)).toBe('autorisation');

    // 3. Alice quitte le vocal : son autorisation survit.
    const sortie = decisionSortieVocal('inVoice', registre.origine(GUILD, SALON, ALICE));
    expect(sortie).toEqual({ action: 'conserver', motif: 'autorisationExplicite' });
    expect(registre.origine(GUILD, SALON, ALICE)).toBe('autorisation');
  });
});

describe('transitionModeEcriture', () => {
  const sansMarque = new Map<string, OrigineSurcharge>();

  test('entrer dans « en vocal » pose les présents non marqués', () => {
    expect(transitionModeEcriture('everyone', 'inVoice', [ALICE, BOB, ALICE], sansMarque)).toEqual({
      aPoser: [ALICE, BOB],
      aRetirer: [],
    });
  });

  test('entrer dans « en vocal » ne rétrograde pas un autorisé déjà présent', () => {
    const origines = new Map<string, OrigineSurcharge>([[ALICE, 'autorisation']]);
    expect(transitionModeEcriture('ownerOnly', 'inVoice', [ALICE, BOB], origines)).toEqual({
      aPoser: [BOB],
      aRetirer: [],
    });
  });

  test('sortir de « en vocal » ne retire que les présences', () => {
    const origines = new Map<string, OrigineSurcharge>([
      [ALICE, 'presence'],
      [BOB, 'autorisation'],
    ]);
    expect(transitionModeEcriture('inVoice', 'everyone', [ALICE, BOB], origines)).toEqual({
      aPoser: [],
      aRetirer: [ALICE],
    });
  });

  test('un changement qui ne touche pas « en vocal » ne bouge aucune surcharge', () => {
    const origines = new Map<string, OrigineSurcharge>([[ALICE, 'presence']]);
    expect(transitionModeEcriture('everyone', 'nobody', [ALICE], origines)).toEqual({
      aPoser: [],
      aRetirer: [],
    });
    const memeMode: ModeEcriture = 'inVoice';
    expect(transitionModeEcriture(memeMode, memeMode, [ALICE], origines)).toEqual({
      aPoser: [],
      aRetirer: [],
    });
  });
});

describe('RegistreOriginesSurcharge', () => {
  test('« présence » n’écrase jamais « autorisation »', () => {
    const registre = new RegistreOriginesSurcharge();
    registre.marquer(GUILD, SALON, ALICE, 'autorisation');

    expect(registre.marquer(GUILD, SALON, ALICE, 'presence')).toBe('autorisation');
    expect(registre.origine(GUILD, SALON, ALICE)).toBe('autorisation');
  });

  test('« autorisation » promeut une présence', () => {
    const registre = new RegistreOriginesSurcharge();
    registre.marquer(GUILD, SALON, ALICE, 'presence');

    expect(registre.marquer(GUILD, SALON, ALICE, 'autorisation')).toBe('autorisation');
  });

  test('les marques d’un salon ne débordent pas sur un autre', () => {
    const registre = new RegistreOriginesSurcharge();
    registre.marquer(GUILD, SALON, ALICE, 'presence');
    registre.marquer(GUILD, SALON, BOB, 'autorisation');
    registre.marquer(GUILD, AUTRE_SALON, ALICE, 'autorisation');

    expect([...registre.originesDuSalon(GUILD, SALON).entries()].sort()).toEqual([
      [ALICE, 'presence'],
      [BOB, 'autorisation'],
    ]);
    expect(registre.origine(GUILD, AUTRE_SALON, BOB)).toBeNull();
  });

  test('tout disparaît à la mort du salon', () => {
    const registre = new RegistreOriginesSurcharge();
    registre.marquer(GUILD, SALON, ALICE, 'presence');
    registre.marquer(GUILD, SALON, BOB, 'autorisation');
    registre.marquer(GUILD, AUTRE_SALON, ALICE, 'presence');

    expect(registre.oublierSalon(GUILD, SALON)).toBe(2);
    expect(registre.taille).toBe(1);
    expect(registre.origine(GUILD, AUTRE_SALON, ALICE)).toBe('presence');
  });

  test('oublier une personne la démarque', () => {
    const registre = new RegistreOriginesSurcharge();
    registre.marquer(GUILD, SALON, ALICE, 'presence');

    expect(registre.oublier(GUILD, SALON, ALICE)).toBe(true);
    expect(registre.oublier(GUILD, SALON, ALICE)).toBe(false);
    expect(registre.origine(GUILD, SALON, ALICE)).toBeNull();
  });
});
