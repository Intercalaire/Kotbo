/**
 * « Ce salon-la, c'est Discord qui l'a pose, pas vous. »
 *
 * Aucun serveur ne nait vide : sa creation y met deux categories et deux
 * salons, dont les noms sont exactement ceux de la maquette de Kotbo. Les
 * prendre pour le travail de quelqu'un a deux consequences, et les deux se sont
 * produites : un serveur cree la minute d'avant se voyait demander « quel salon
 * est quoi » sur huit ecrans, et la pose y ouvrait un second salon general a
 * cote de celui qui existait deja.
 *
 * Ces cas fixent les deux bords. Reconnaitre trop large ferait passer pour
 * « pose par Discord » le salon principal d'une communaute - celui ou tout le
 * monde parle depuis trois ans -, et Kotbo se brancherait dessus sans le
 * demander. Reconnaitre trop etroit ne coute que le parcours detaille : plus
 * long, mais sans doublon. Le doute penche donc vers le second.
 */
import { describe, expect, test } from 'bun:test';
import { discordDefaultPlanKey } from '../../services/core/serverTemplateService.js';

describe('discordDefaultPlanKey', () => {
  test('reconnait les quatre elements poses a la creation, en francais', () => {
    expect(discordDefaultPlanKey({ name: 'Salons textuels', kind: 'category' })).toBe('text.category');
    expect(discordDefaultPlanKey({ name: 'général', kind: 'text' })).toBe('text.general');
    expect(discordDefaultPlanKey({ name: 'Salons vocaux', kind: 'category' })).toBe('voice.category');
    expect(discordDefaultPlanKey({ name: 'Général', kind: 'voice' })).toBe('voice.general');
  });

  test('les reconnait aussi dans les autres langues de creation', () => {
    // C'est la langue du createur du serveur qui a nomme ces salons, pas celle
    // du bot : un serveur monte en anglais et configure en francais porte des
    // noms anglais, et c'est le cas le plus courant.
    expect(discordDefaultPlanKey({ name: 'Text Channels', kind: 'category' })).toBe('text.category');
    expect(discordDefaultPlanKey({ name: 'general', kind: 'text' })).toBe('text.general');
    expect(discordDefaultPlanKey({ name: 'Sprachkanäle', kind: 'category' })).toBe('voice.category');
    expect(discordDefaultPlanKey({ name: 'Geral', kind: 'voice' })).toBe('voice.general');
  });

  test('la nature doit concorder : un vocal nomme general ne tient pas la ligne textuelle', () => {
    // Un serveur nait avec les deux, homonymes. Les confondre brancherait le
    // salon de discussion sur un salon vocal.
    expect(discordDefaultPlanKey({ name: 'général', kind: 'voice' })).toBe('voice.general');
    expect(discordDefaultPlanKey({ name: 'Salons textuels', kind: 'text' })).toBeNull();
  });

  test('un salon ou l on a deja parle n est plus un salon pose par Discord', () => {
    // Le `#général` d'une communaute de trois ans porte le meme nom que celui
    // que Discord vient de poser. La difference se lit a ce qu'il contient, et
    // c'est elle qui decide si la question merite d'etre posee.
    expect(discordDefaultPlanKey({ name: 'général', kind: 'text', used: true })).toBeNull();
    expect(discordDefaultPlanKey({ name: 'général', kind: 'text', used: false })).toBe('text.general');
  });

  test('les decorations de nom ne cachent pas un salon par defaut', () => {
    expect(discordDefaultPlanKey({ name: '💬・general', kind: 'text' })).toBe('text.general');
    expect(discordDefaultPlanKey({ name: '━ SALONS TEXTUELS ━', kind: 'category' })).toBe('text.category');
  });

  test('tout le reste appartient au serveur', () => {
    // Le doute profite au parcours detaille : mieux vaut demander a qui n'avait
    // rien a dire que de se brancher sur un salon sans prevenir.
    expect(discordDefaultPlanKey({ name: 'discussions', kind: 'text' })).toBeNull();
    expect(discordDefaultPlanKey({ name: 'reglement', kind: 'text' })).toBeNull();
    expect(discordDefaultPlanKey({ name: 'Informations', kind: 'category' })).toBeNull();
    expect(discordDefaultPlanKey({ name: 'Membre', kind: 'role' })).toBeNull();
  });
});
