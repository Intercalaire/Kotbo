import { describe, expect, test } from 'bun:test';
import { Message, MessageFlags, TextDisplayBuilder, VoiceChannel } from 'discord.js';
import { embedToV2, messageEstV2, sansConversionV2, transformUpdatePayload } from '../../utils/patchV2';

const v2Message = {
  flags: { has: (f: number) => f === MessageFlags.IsComponentsV2 },
};

const legacyMessage = {
  flags: { has: () => false },
};

describe('transformUpdatePayload', () => {
  test('convertit content en TextDisplay pour un update sur message V2', () => {
    const payload = transformUpdatePayload(
      { content: 'Alerte ignorée par <@123>.', embeds: [], components: [] },
      v2Message,
    ) as { content?: string; embeds?: unknown[]; components: unknown[]; flags: unknown; allowedMentions?: unknown };

    expect(payload.content).toBeUndefined();
    expect(payload.embeds).toBeUndefined();
    expect(payload.components).toHaveLength(1);
    expect(payload.components[0]).toBeInstanceOf(TextDisplayBuilder);
    expect((payload.components[0] as TextDisplayBuilder).toJSON().content).toBe('Alerte ignorée par <@123>.');
    expect(payload.flags).toContain(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  test('préserve les composants existants en les plaçant après le texte', () => {
    const row = { type: 1, components: [] };
    const payload = transformUpdatePayload(
      { content: 'Validé.', components: [row] },
      v2Message,
    ) as { components: unknown[] };

    expect(payload.components).toHaveLength(2);
    expect(payload.components[0]).toBeInstanceOf(TextDisplayBuilder);
    expect(payload.components[1]).toBe(row);
  });

  test('convertit un update string sur message V2', () => {
    const payload = transformUpdatePayload('Terminé.', v2Message) as { components: unknown[]; flags: unknown[] };

    expect(payload.components).toHaveLength(1);
    expect(payload.components[0]).toBeInstanceOf(TextDisplayBuilder);
    expect(payload.flags).toContain(MessageFlags.IsComponentsV2);
  });

  test('ne modifie pas un update content sur message legacy', () => {
    const options = { content: 'Alerte ignorée.', embeds: [], components: [] };
    const payload = transformUpdatePayload(options, legacyMessage);

    expect(payload).toBe(options);
    expect((payload as { content?: string }).content).toBe('Alerte ignorée.');
  });

  test('convertit toujours les embeds via transformPayload, cible V2 ou non', () => {
    const payload = transformUpdatePayload(
      { embeds: [{ title: 'Test', description: 'Desc' }], components: [] },
      v2Message,
    ) as { embeds?: unknown[]; components: unknown[]; flags: unknown };

    expect(payload.embeds).toBeUndefined();
    expect(payload.components.length).toBeGreaterThanOrEqual(1);
  });
});

/** Concatene les TextDisplay d'un container pour inspecter son rendu. */
function containerText(container: ReturnType<typeof embedToV2>): string {
  const json = container.toJSON() as { components: any[] };
  const collect = (nodes: any[]): string[] => nodes.flatMap((node) => {
    if (node.type === 10) return [node.content as string];
    if (Array.isArray(node.components)) return collect(node.components);
    return [];
  });
  return collect(json.components).join('\n');
}

describe('embedToV2', () => {
  test('rend le titre cliquable quand l embed porte une url', () => {
    const text = containerText(embedToV2({
      title: 'Ma super video',
      url: 'https://www.youtube.com/watch?v=abc123',
      description: 'Desc',
    }));

    expect(text).toContain('[Ma super video](https://www.youtube.com/watch?v=abc123)');
  });

  test('sort le titre cliquable du heading, que Discord rendrait en clair', () => {
    const text = containerText(embedToV2({
      title: '📜 Reglement publie',
      url: 'https://discord.com/channels/1/2/3',
    }));

    expect(text).toContain('**[📜 Reglement publie](https://discord.com/channels/1/2/3)**');
    expect(text).not.toContain('### [');
    expect(text).not.toContain('### **[');
  });

  test('garde l emoji hors du libelle et rend l auteur cliquable', () => {
    const text = containerText(embedToV2({
      title: 'Nouvelle actualite',
      url: 'https://exemple.test/article',
      author: { name: 'Ma chaine', url: 'https://exemple.test/chaine' },
    }));

    expect(text).toContain('**[Ma chaine](https://exemple.test/chaine)**');
    expect(text).toContain('[Nouvelle actualite](https://exemple.test/article)');
  });

  test('ignore une url non http et laisse le titre en clair', () => {
    const text = containerText(embedToV2({
      title: 'Titre',
      url: 'javascript:alert(1)',
    }));

    expect(text).toContain('### Titre');
    expect(text).not.toContain('](');
  });

  test('neutralise les crochets du libelle', () => {
    const text = containerText(embedToV2({
      title: 'Live [FR] test',
      url: 'https://exemple.test/live',
    }));

    // Backslash construit a la main pour rester lisible dans l'assertion.
    const bs = String.fromCharCode(92);
    expect(text).toContain(`[Live ${bs}[FR${bs}] test](https://exemple.test/live)`);
  });

  test('échappe les parenthèses de l URL pour préserver la syntaxe markdown', () => {
    const text = containerText(embedToV2({
      title: 'Documentation',
      url: 'https://exemple.test/wiki/Page_(disambiguation)',
    }));

    expect(text).toContain('[Documentation](https://exemple.test/wiki/Page_%28disambiguation%29)');
  });
});


/**
 * Passe la charge par le `send` REELLEMENT patche (les prototypes sont patches
 * a l'import du module). L'appel d'origine de discord.js echoue sur un `this`
 * factice, mais la transformation est deja faite a ce moment-la : la charge est
 * mutee sur place, donc on inspecte l'objet qu'on a fourni.
 */
function envoiPatche<T extends object>(payload: T): T {
  try {
    const retour = (VoiceChannel.prototype.send as (...args: unknown[]) => unknown)
      .call({} as never, payload);
    if (retour && typeof (retour as Promise<unknown>).catch === 'function') {
      (retour as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Attendu : seul le passage par transformPayload nous interesse.
  }
  return payload;
}

/** Meme principe pour `Message.prototype.edit`, avec un message cible deja V2. */
function editionPatchee<T extends object>(payload: T, cible: unknown): T {
  try {
    const retour = (Message.prototype.edit as (...args: unknown[]) => unknown)
      .call(cible as never, payload);
    if (retour && typeof (retour as Promise<unknown>).catch === 'function') {
      (retour as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Attendu.
  }
  return payload;
}

/** La marque ne doit plus etre sur la charge quand discord.js la recoit. */
function porteLaMarque(payload: object): boolean {
  return Object.getOwnPropertySymbols(payload).includes(Symbol.for('kotbo.sansConversionV2'));
}

describe('sansConversionV2', () => {
  test('un send marque ressort avec ses embeds intacts, sans flags V2 ni marque', () => {
    const embed = { title: 'Salon vocal', fields: [{ name: 'Proprietaire', value: 'Membre', inline: true }] };
    const payload = envoiPatche(sansConversionV2({ embeds: [embed], components: [] })) as {
      embeds?: unknown[]; components?: unknown[]; flags?: unknown;
    };

    expect(payload.embeds).toEqual([embed]);
    expect(payload.embeds?.[0]).toBe(embed);
    expect(payload.flags).toBeUndefined();
    // La marque reste posee : cle Symbol non enumerable, invisible de
    // discord.js. La retirer rendrait la charge convertible au second envoi.
    expect(porteLaMarque(payload)).toBe(true);
  });

  test('la meme charge NON marquee ressort convertie en V2', () => {
    const payload = envoiPatche({
      embeds: [{ title: 'Salon vocal', fields: [{ name: 'Proprietaire', value: 'Membre', inline: true }] }],
      components: [],
    }) as { embeds?: unknown[]; components?: unknown[]; flags?: unknown };

    expect(payload.embeds).toBeUndefined();
    expect(payload.components?.length).toBeGreaterThanOrEqual(1);
    expect(payload.flags).toContain(MessageFlags.IsComponentsV2);
  });

  test('une edition vers un message deja V2 laisse la charge marquee intacte', () => {
    const embed = { title: 'Salon vocal', description: 'Panneau V1' };
    const payload = editionPatchee(
      sansConversionV2({ content: 'Panneau', embeds: [embed], components: [] }),
      v2Message,
    ) as { content?: string; embeds?: unknown[]; components?: unknown[]; flags?: unknown };

    expect(payload.content).toBe('Panneau');
    expect(payload.embeds).toEqual([embed]);
    expect(payload.flags).toBeUndefined();
    // La marque reste posee : cle Symbol non enumerable, invisible de
    // discord.js. La retirer rendrait la charge convertible au second envoi.
    expect(porteLaMarque(payload)).toBe(true);
  });

  test('transformUpdatePayload marque : aucune reconversion forcee sur cible V2', () => {
    const options = sansConversionV2({ content: 'Reste en V1.', embeds: [{ title: 'T' }] });
    const payload = transformUpdatePayload(options, v2Message) as {
      content?: string; embeds?: unknown[]; flags?: unknown;
    };

    expect(payload).toBe(options);
    expect(payload.content).toBe('Reste en V1.');
    expect(payload.embeds).toHaveLength(1);
    expect(payload.flags).toBeUndefined();
  });

  /**
   * La marque est retiree de la charge au premier passage, pour que discord.js
   * ne voie pas de champ inconnu. Une charge construite une fois puis envoyee
   * DEUX fois — un envoi, puis une edition — repartirait alors en conversion
   * V2 au second passage : le panneau s'afficherait en V1 puis basculerait en
   * V2 tout seul, sans que rien ne l'explique.
   */
  test('une meme charge envoyee deux fois reste en V1 au second passage', () => {
    const options = sansConversionV2({ content: 'Panneau', embeds: [{ title: 'T' }] });

    const premier = envoiPatche(options) as { content?: string; flags?: unknown };
    expect(premier.flags).toBeUndefined();

    const second = envoiPatche(options) as { content?: string; embeds?: unknown[]; flags?: unknown };
    expect(second.flags).toBeUndefined();
    expect(second.content).toBe('Panneau');
    expect(second.embeds).toHaveLength(1);
  });
});

describe('messageEstV2', () => {
  test('vrai sur un message portant le drapeau, faux sinon', () => {
    expect(messageEstV2(v2Message)).toBe(true);
    expect(messageEstV2(legacyMessage)).toBe(false);
  });

  test('faux sur un message sans flags exploitables', () => {
    expect(messageEstV2(null)).toBe(false);
    expect(messageEstV2({})).toBe(false);
  });
});
