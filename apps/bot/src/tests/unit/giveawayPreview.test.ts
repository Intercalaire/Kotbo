import { describe, expect, test } from 'bun:test';
import {
  fillTemplate,
  renderPreview,
  toDiscordHtml,
  type PreviewLabels,
  type PreviewSample,
} from '../../../../dashboard/src/lib/giveawayPreview.ts';

/**
 * Aperçu de l'annonce, rendu dans le dashboard. Il est testé depuis ici faute
 * de tests côté dashboard, et parce que son point sensible le mérite : le
 * rendu insère du HTML construit à partir d'un gabarit librement saisi.
 */

const labels: PreviewLabels = {
  rewardsTitle: 'En plus du lot :',
  coins: 'Pièces :',
  xp: 'XP RPG :',
  item: 'Objet :',
  validation: 'Validation du staff requise',
  bonusRolesTitle: 'Chances supplémentaires :',
  endsIn: 'dans',
};

const sample: PreviewSample = {
  prize: 'Un mois de Nitro',
  description: 'Merci de votre participation',
  winnerCount: 2,
  participants: 37,
  winners: ['Camille', 'Dominique'],
  host: 'Alex',
  serverName: 'Mon serveur',
  bonusRoles: [{ name: 'Actifs', weight: 2 }, { name: 'Boosters', weight: 5 }],
  coins: 250,
  xp: 100,
  item: '',
  needValidation: false,
  endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
};

describe('toDiscordHtml', () => {
  test('neutralise le HTML avant toute mise en forme', () => {
    // Un gabarit est saisi librement : sans cette neutralisation, il ouvrirait
    // une brèche dans la page de configuration.
    const rendered = toDiscordHtml('<img src=x onerror="alert(1)">');

    expect(rendered).not.toContain('<img');
    expect(rendered).toContain('&lt;img');
  });

  test('rend le balisage que le bot produit', () => {
    expect(toDiscordHtml('**gras**')).toBe('<strong>gras</strong>');
    expect(toDiscordHtml('*doux*')).toBe('<em>doux</em>');
    expect(toDiscordHtml('~~barré~~')).toBe('<s>barré</s>');
    expect(toDiscordHtml('une\ndeux')).toBe('une<br />deux');
  });

  test('arrête la pastille de mention à la fin du pseudo', () => {
    // La virgule qui sépare deux gagnants ne doit pas entrer dans la pastille.
    const rendered = toDiscordHtml('@Camille, @Dominique');

    expect(rendered).toBe(
      '<span class="mention">@Camille</span>, <span class="mention">@Dominique</span>',
    );
  });
});

describe('fillTemplate', () => {
  test('remplace les variables du concours', () => {
    expect(fillTemplate('{prize} pour {winnerCount} sur {participants}', sample, labels))
      .toBe('Un mois de Nitro pour 2 sur 37');
    expect(fillTemplate('Bravo {winners} de {server}', sample, labels))
      .toBe('Bravo @Camille, @Dominique de Mon serveur');
  });

  test('compose les blocs des récompenses et des rôles avantagés', () => {
    const rewards = fillTemplate('{bonus}', sample, labels);
    expect(rewards).toContain('**En plus du lot :**');
    expect(rewards).toContain('**Pièces :** +250');
    expect(rewards).not.toContain('Objet');

    // Le rôle le plus favorisé passe devant, comme dans l'annonce réelle.
    expect(fillTemplate('{bonusRoles}', sample, labels))
      .toBe('\n**Chances supplémentaires :**\n@Boosters ×5\n@Actifs ×2\n');
  });

  test('efface les blocs facultatifs quand il n\'y a rien à montrer', () => {
    const empty = { ...sample, description: '', coins: 0, xp: 0, item: '', bonusRoles: [] };

    expect(fillTemplate('{description}{bonus}{bonusRoles}', empty, labels)).toBe('');
  });

  test('rend la fin de concours lisible plutôt qu\'en horodatage Discord', () => {
    const rendered = fillTemplate('{endsRelative}', sample, labels);

    // Discord affiche un compte à rebours vivant, impossible à reproduire.
    expect(rendered).toBe('dans 2 j');
    expect(rendered).not.toContain('<t:');
  });
});

describe('renderPreview', () => {
  test('assemble le gabarit et sa mise en forme', () => {
    // La variable porte déjà l'arobase : en ajouter une la doublerait.
    const rendered = renderPreview('**{prize}** pour {host}', sample, labels);

    expect(rendered).toBe(
      '<strong>Un mois de Nitro</strong> pour <span class="mention">@Alex</span>',
    );
  });
});
