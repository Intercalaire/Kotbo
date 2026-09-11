import { describe, expect, test } from 'bun:test';
import { ButtonStyle } from 'discord.js';
import {
  applyAppearanceOverrides,
  defaultAppearance,
  mergeAppearance,
  normalizeAppearancePatch,
  renderGiveawayText,
  resolveButtonStyle,
} from '../../services/features/giveawayAppearance.js';

const FR = defaultAppearance('fr');
const EN = defaultAppearance('en');

/**
 * L'apparence d'un concours vient de trois couches empilées, et les valeurs
 * arrivent d'un formulaire ou d'une colonne JSON que personne ne valide en
 * amont. Une valeur douteuse doit disparaître au lieu de faire échouer la
 * publication du concours devant tout le serveur.
 */
describe('normalizeAppearancePatch', () => {
  test('ne garde que les couleurs hexadécimales complètes', () => {
    const patch = normalizeAppearancePatch({
      embedColorActive: '#abcdef',
      embedColorEnded: 'rouge',
      embedColorPending: '#FFF',
    });

    expect(patch.embedColorActive).toBe('#ABCDEF');
    expect(patch.embedColorEnded).toBeUndefined();
    expect(patch.embedColorPending).toBeUndefined();
  });

  test('refuse une image qui n\'est pas en HTTPS', () => {
    expect(normalizeAppearancePatch({ imageUrl: 'http://exemple.test/a.png' }).imageUrl).toBeUndefined();
    expect(normalizeAppearancePatch({ imageUrl: 'pas une url' }).imageUrl).toBeUndefined();
    expect(normalizeAppearancePatch({ imageUrl: 'https://exemple.test/a.png' }).imageUrl)
      .toBe('https://exemple.test/a.png');
  });

  test('traduit une image vidée en effacement explicite', () => {
    // Sans ce cas, un champ vidé dans le dashboard laisserait l'ancienne image.
    expect(normalizeAppearancePatch({ thumbnailUrl: '' }).thumbnailUrl).toBeNull();
    expect(normalizeAppearancePatch({ thumbnailUrl: null }).thumbnailUrl).toBeNull();
  });

  test('ignore un gabarit vide ou trop long', () => {
    expect(normalizeAppearancePatch({ titleTemplate: '   ' }).titleTemplate).toBeUndefined();
    expect(normalizeAppearancePatch({ titleTemplate: 'x'.repeat(201) }).titleTemplate).toBeUndefined();
    expect(normalizeAppearancePatch({ titleTemplate: 'Concours : {prize}' }).titleTemplate)
      .toBe('Concours : {prize}');
  });

  test('laisse vider l\'emoji du bouton, mais jamais son libellé', () => {
    // Un bouton sans emoji est un choix de présentation ; un bouton sans
    // libellé n'existe pas, donc le réglage en place doit survivre.
    expect(normalizeAppearancePatch({ joinButtonEmoji: '' }).joinButtonEmoji).toBe('');
    expect(normalizeAppearancePatch({ joinButtonLabel: '' }).joinButtonLabel).toBeUndefined();
    expect(normalizeAppearancePatch({ joinButtonEmoji: '🎁' }).joinButtonEmoji).toBe('🎁');
  });

  test('ne retient que les styles de bouton connus', () => {
    expect(normalizeAppearancePatch({ joinButtonStyle: 'success' }).joinButtonStyle).toBe('SUCCESS');
    expect(normalizeAppearancePatch({ joinButtonStyle: 'ARC-EN-CIEL' }).joinButtonStyle).toBeUndefined();
  });

  test('rejette ce qui n\'est pas un objet de réglages', () => {
    expect(normalizeAppearancePatch(null)).toEqual({});
    expect(normalizeAppearancePatch(['#FFFFFF'])).toEqual({});
    expect(normalizeAppearancePatch('#FFFFFF')).toEqual({});
  });
});

describe('mergeAppearance', () => {
  test('laisse la couche la plus précise l\'emporter', () => {
    const merged = mergeAppearance(
      'fr',
      { embedColorActive: '#111111', joinButtonLabel: 'Participer' },
      { embedColorActive: '#222222' },
    );

    expect(merged.embedColorActive).toBe('#222222');
    expect(merged.joinButtonLabel).toBe('Participer');
  });

  test('part des textes d\'usine de la langue demandée', () => {
    expect(mergeAppearance('fr', null, undefined, {})).toEqual(FR);
    expect(mergeAppearance('en', {}).titleTemplate).toBe(EN.titleTemplate);
  });
});

describe('defaultAppearance', () => {
  test('traduit les textes sans y glisser d\'emoji', () => {
    // Le serveur choisit ses emoji : le bot n'en impose aucun dans les
    // gabarits, pas même sur le bouton de participation.
    for (const appearance of [FR, EN]) {
      const texts = Object.values(appearance).filter((v): v is string => typeof v === 'string');
      expect(texts.some((text) => /\p{Extended_Pictographic}/u.test(text))).toBe(false);
      expect(appearance.joinButtonEmoji).toBe('');
    }

    expect(FR.titleTemplate).not.toBe(EN.titleTemplate);
  });
});

describe('applyAppearanceOverrides', () => {
  test('garde les textes du serveur sous une surcharge de couleur', () => {
    // Repartir des textes d'usine ferait retomber un serveur anglophone dans
    // la langue de repli des qu'un concours change sa couleur.
    const serverLook = { ...EN, joinButtonLabel: 'Join now' };
    const merged = applyAppearanceOverrides(serverLook, { embedColorActive: '#123456' });

    expect(merged.embedColorActive).toBe('#123456');
    expect(merged.joinButtonLabel).toBe('Join now');
    expect(merged.titleTemplate).toBe(EN.titleTemplate);
  });

  test('ignore une surcharge illisible', () => {
    expect(applyAppearanceOverrides(FR, 'nawak')).toEqual(FR);
  });
});

describe('renderGiveawayText', () => {
  const context = {
    id: 'abc',
    prize: 'Nitro',
    winnerCount: 2,
    participantCount: 7,
    endsAt: new Date(1_700_000_000_000),
    winners: '<@1>, <@2>',
    host: '<@9>',
    guildName: 'Kotbo',
  };

  test('remplace les variables du concours', () => {
    expect(renderGiveawayText('{prize} pour {winnerCount} sur {participants}', context))
      .toBe('Nitro pour 2 sur 7');
    expect(renderGiveawayText('Bravo {winners} de {server} !', context))
      .toBe('Bravo <@1>, <@2> de Kotbo !');
  });

  test('rend la fin de concours au format horodaté de Discord', () => {
    expect(renderGiveawayText('{endsAt} / {endsRelative}', context))
      .toBe('<t:1700000000:f> / <t:1700000000:R>');
  });

  test('vide une variable sans valeur au lieu de l\'afficher', () => {
    // Un « {winners} » brut resterait affiché aux membres à la création.
    expect(renderGiveawayText('Gagnants : {winners}', { ...context, winners: undefined }))
      .toBe('Gagnants : ');
  });

  test('laisse intact un texte sans variable', () => {
    expect(renderGiveawayText('Bonne chance !', context)).toBe('Bonne chance !');
  });

  test('reproduit au caractère près le corps d\'annonce d\'origine', () => {
    // Ce corps était concaténé en dur avant d'être configurable : un serveur
    // qui ne touche à rien doit voir exactement le même message qu'avant.
    const rendered = renderGiveawayText(FR.descriptionTemplate, {
      ...context,
      descriptionBlock: 'Un concours\n\n',
      bonusBlock: '\n**En plus du lot :**\n**Pièces :** +5\n',
    });

    expect(rendered).toBe(
      'Un concours\n\n'
      + 'Cliquez sur le bouton ci-dessous pour participer !\n'
      + '\n**En plus du lot :**\n**Pièces :** +5\n'
      + '\n**Fin :** <t:1700000000:R> (<t:1700000000:f>)\n'
      + '**Nombre de gagnants :** 2\n'
      + '**Participants :** 7',
    );
  });

  test('efface les blocs facultatifs d\'un concours sans description ni bonus', () => {
    const rendered = renderGiveawayText(FR.descriptionTemplate, context);

    expect(rendered.startsWith('Cliquez sur le bouton ci-dessous pour participer !')).toBe(true);
    expect(rendered).not.toContain('En plus du lot');
    expect(rendered).not.toContain('Chances supplémentaires');
  });

  test('annonce les rôles avantagés entre le bouton et la date de fin', () => {
    const rendered = renderGiveawayText(FR.descriptionTemplate, {
      ...context,
      bonusRolesBlock: '\n**Chances supplémentaires :**\n<@&7> ×2\n',
    });

    expect(rendered).toBe(
      'Cliquez sur le bouton ci-dessous pour participer !\n'
      + '\n**Chances supplémentaires :**\n<@&7> ×2\n'
      + '\n**Fin :** <t:1700000000:R> (<t:1700000000:f>)\n'
      + '**Nombre de gagnants :** 2\n'
      + '**Participants :** 7',
    );
  });
});

describe('defaults contre gabarit personnalisé', () => {
  test('le corps d\'usine réserve une place aux rôles avantagés', () => {
    // Sans cette place, le bloc ne s'afficherait nulle part et le réglage qui
    // l'annonce passerait pour sans effet.
    for (const appearance of [FR, EN]) {
      expect(appearance.descriptionTemplate).toContain('{bonusRoles}');
    }
  });
});

describe('resolveButtonStyle', () => {
  test('traduit les styles configurables', () => {
    expect(resolveButtonStyle('SUCCESS')).toBe(ButtonStyle.Success);
    expect(resolveButtonStyle('DANGER')).toBe(ButtonStyle.Danger);
  });

  test('retombe sur le bleu d\'origine pour une valeur inconnue', () => {
    expect(resolveButtonStyle('INCONNU')).toBe(ButtonStyle.Primary);
    expect(resolveButtonStyle(null)).toBe(ButtonStyle.Primary);
  });
});
