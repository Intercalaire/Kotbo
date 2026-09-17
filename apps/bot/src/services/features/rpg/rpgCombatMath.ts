/**
 * Formule de dégâts partagée par les deux moteurs de combat (combat interactif du hub et
 * simulation de boss). Les avoir en double avait déjà provoqué une divergence : elle est
 * désormais définie une seule fois ici.
 */

export type AttackInput = {
  attack: number;
  /** Défense de la cible, avant réduction de pénétration. */
  targetDefense: number;
  /** Vitesse de l'attaquant : élargit la fourchette de dégâts. */
  speed: number;
  /** Chance de coup critique, de 0 à 1. */
  critChance: number;
  /** Part de la défense adverse ignorée, de 0 à 1. */
  armorPiercing?: number;
  /** Multiplicateur de la compétence employée (1 = attaque normale). */
  skillMultiplier?: number;
  /** Multiplicateur défensif actif sur la cible (2 = posture de défense). */
  targetDefenseMultiplier?: number;
  /** Part des dégâts annulée par le passif de la cible, de 0 à 1. */
  targetDamageReduction?: number;
  /** Part des dégâts infligés rendue en PV à l'attaquant, de 0 à 1. */
  lifesteal?: number;
  /** Part des dégâts subis que la cible renvoie à l'attaquant, de 0 à 1. */
  targetThorns?: number;
  /** Générateur aléatoire injectable, pour rendre les tests déterministes. */
  random?: () => number;
};

export type AttackResult = {
  damage: number;
  critical: boolean;
  /** PV rendus à l'attaquant par le vol de vie. Zéro sans enchantement adéquat. */
  healed: number;
  /** Dégâts renvoyés à l'attaquant par les épines de la cible. Zéro par défaut. */
  reflected: number;
};

export const CRIT_MULTIPLIER = 1.6;

/**
 * Raideur de l'atténuation par la défense.
 *
 * Les dégâts passent à `DEFENSE_SCALE / (DEFENSE_SCALE + défense)`. Cette valeur est
 * l'ordre de grandeur de la défense à laquelle on encaisse la moitié des coups : à 90
 * de défense, un coup passe à 50 %. Elle est calée sur la courbe réelle du jeu, où un
 * personnage passe d'une vingtaine de défense au niveau 2 à environ 170 au niveau 30.
 */
export const DEFENSE_SCALE = 90;

/**
 * Part minimale des dégâts qui passe toujours.
 *
 * Sans plancher, une défense très haute rendrait invulnérable : c'est exactement ce que
 * faisait l'ancienne formule, qui retombait sur 1 dégât fixe dès que la moitié de la
 * défense dépassait l'attaque.
 */
export const MIN_DAMAGE_THROUGH = 0.25;

/**
 * Part des dégâts qui franchit une défense donnée, de `MIN_DAMAGE_THROUGH` à 1.
 *
 * REMPLACE `attaque − défense / 2`. Cette soustraction cassait aux deux bouts : au-dessus
 * du seuil elle laissait passer l'intégralité de l'attaque — d'où les créatures abattues
 * en un coup — et en dessous elle tombait sur le plancher de 1 dégât, ce qui rendait le
 * personnage intouchable. Un ratio n'a ni seuil ni plafond : la défense compte toujours,
 * et ne suffit jamais.
 */
export function damageThrough(defense: number): number {
  return Math.max(MIN_DAMAGE_THROUGH, DEFENSE_SCALE / (DEFENSE_SCALE + Math.max(0, defense)));
}

/**
 * Dégâts = attaque × `damageThrough(défense effective)` × compétence × critique, moins la
 * réduction du passif adverse. Le résultat est toujours d'au moins 1 : aucun combat ne
 * doit pouvoir se bloquer parce que les deux camps infligent zéro.
 *
 * Le vol de vie et les épines sont dérivés ici plutôt que dans chaque moteur de combat :
 * ils se calculent sur les dégâts RÉELLEMENT infligés, et les recalculer en trois endroits
 * était la garantie de les voir diverger, comme la formule de dégâts elle-même avant elle.
 * Appliquer les PV rendus et renvoyés reste à la charge de l'appelant, seul à connaître
 * l'état de son combat.
 */
export function computeAttack(input: AttackInput): AttackResult {
  const random = input.random ?? Math.random;

  const pierced = input.targetDefense * (1 - Math.min(1, Math.max(0, input.armorPiercing ?? 0)));
  const effectiveDefense = pierced * (input.targetDefenseMultiplier ?? 1);

  const variance = Math.floor(random() * Math.max(1, Math.floor(input.speed / 3)));
  const raw = Math.max(1, Math.floor(input.attack * damageThrough(effectiveDefense))) + variance;

  const withSkill = raw * (input.skillMultiplier ?? 1);
  const critical = random() < input.critChance;
  const withCrit = critical ? withSkill * CRIT_MULTIPLIER : withSkill;

  const reduced = withCrit * (1 - Math.min(0.9, Math.max(0, input.targetDamageReduction ?? 0)));
  const damage = Math.max(1, Math.floor(reduced));

  const lifesteal = Math.min(1, Math.max(0, input.lifesteal ?? 0));
  const thorns = Math.min(1, Math.max(0, input.targetThorns ?? 0));

  return {
    damage,
    critical,
    healed: Math.floor(damage * lifesteal),
    reflected: Math.floor(damage * thorns),
  };
}
