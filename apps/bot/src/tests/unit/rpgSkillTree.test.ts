import { describe, expect, test } from 'bun:test';
import {
  RPG_SKILL_NODES,
  aggregateNodeBonuses,
  branchesForClass,
  getSkillNode,
  nodesForClass,
  pointsSpent,
  skillsFromNodes,
} from '../../services/features/rpg/rpgSkillTree.js';
import { RPG_CLASS_LIST } from '../../services/features/rpg/rpgClasses.js';

describe('catalogue de l arbre de compétences', () => {
  test('les identifiants de nœuds sont uniques', () => {
    // `nodeId` est la clé stockée en base : un doublon ferait pointer deux nœuds
    // différents sur la même ligne d'achat.
    const duplicates = RPG_SKILL_NODES
      .map((node) => node.id)
      .filter((id, index, all) => all.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('les compétences accordées ont des identifiants uniques', () => {
    // Le moteur de combat résout une compétence par son id : deux compétences homonymes
    // rendraient le cooldown de l'une applicable à l'autre.
    const ids = RPG_SKILL_NODES
      .map((node) => node.grantsSkill?.id)
      .filter((id): id is string => Boolean(id));
    const duplicates = ids.filter((id, index, all) => all.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('chaque prérequis désigne un nœud de la même classe', () => {
    const offenders = RPG_SKILL_NODES.flatMap((node) =>
      node.requires
        .filter((id) => getSkillNode(id)?.classId !== node.classId)
        .map((id) => `${node.id} -> ${id}`),
    );

    expect(offenders).toEqual([]);
  });

  test('un prérequis se situe toujours à un palier strictement inférieur', () => {
    // C'est ce qui garantit l'absence de cycle : un arc ne va jamais que vers le haut.
    const offenders = RPG_SKILL_NODES.flatMap((node) =>
      node.requires
        .filter((id) => (getSkillNode(id)?.tier ?? 0) >= node.tier)
        .map((id) => `${node.id} (palier ${node.tier}) -> ${id}`),
    );

    expect(offenders).toEqual([]);
  });

  test('un prérequis ne demande jamais un niveau supérieur au nœud qu il ouvre', () => {
    // Sinon le nœud enfant serait affiché comme accessible alors que son parent, lui,
    // resterait hors de portée : le joueur ne verrait jamais pourquoi ça bloque.
    const offenders = RPG_SKILL_NODES.flatMap((node) =>
      node.requires
        .filter((id) => (getSkillNode(id)?.levelRequired ?? 0) > node.levelRequired)
        .map((id) => `${node.id} (niv. ${node.levelRequired}) -> ${id}`),
    );

    expect(offenders).toEqual([]);
  });

  test('chaque classe a des branches, et chacune une racine sans prérequis', () => {
    for (const rpgClass of RPG_CLASS_LIST) {
      const nodes = nodesForClass(rpgClass.id);
      expect(nodes.length).toBeGreaterThan(0);

      for (const branch of branchesForClass(rpgClass.id)) {
        const inBranch = nodes.filter((node) => node.branch === branch);
        // Sans racine, la branche entière serait inatteignable.
        expect(inBranch.some((node) => node.requires.length === 0)).toBe(true);
      }
    }
  });

  test('un nœud accorde soit des bonus, soit une compétence', () => {
    const empty = RPG_SKILL_NODES.filter((node) => !node.bonus && !node.grantsSkill);
    expect(empty.map((node) => node.id)).toEqual([]);
  });

  test('un nœud de compétence ne se prend qu une fois', () => {
    // Un rang supplémentaire n'ajouterait rien : la compétence est déjà acquise.
    const offenders = RPG_SKILL_NODES.filter((node) => node.grantsSkill && node.maxRank !== 1);
    expect(offenders.map((node) => node.id)).toEqual([]);
  });
});

describe('aggregateNodeBonuses', () => {
  test('multiplie le bonus par le rang possédé', () => {
    // Garde haute : +4 DÉF par rang, 3 rangs maximum.
    const total = aggregateNodeBonuses([{ nodeId: 'war_bulwark_1', rank: 3 }]);
    expect(total.defenseFlat).toBe(12);
  });

  test('borne un rang stocké au-delà du maximum du catalogue', () => {
    // Le catalogue peut avoir été réduit depuis l'achat : la ligne en base survit, mais
    // elle ne doit pas accorder un bonus que l'arbre ne permet plus d'atteindre.
    const total = aggregateNodeBonuses([{ nodeId: 'war_bulwark_1', rank: 99 }]);
    expect(total.defenseFlat).toBe(12);
  });

  test('ignore un nœud absent du catalogue', () => {
    const total = aggregateNodeBonuses([{ nodeId: 'noeud_supprime', rank: 2 }]);
    expect(total.defenseFlat).toBe(0);
    expect(total.attackFlat).toBe(0);
  });

  test('cumule plusieurs nœuds', () => {
    const total = aggregateNodeBonuses([
      { nodeId: 'war_bulwark_1', rank: 1 },
      { nodeId: 'war_fury_1', rank: 2 },
    ]);

    expect(total.defenseFlat).toBe(4);
    expect(total.attackFlat).toBe(8);
  });
});

describe('skillsFromNodes', () => {
  test('ne rend que les nœuds qui accordent une compétence', () => {
    const skills = skillsFromNodes([
      { nodeId: 'war_fury_3' },
      { nodeId: 'war_bulwark_1' },
      { nodeId: 'noeud_supprime' },
    ]);

    expect(skills.map((skill) => skill.id)).toEqual(['war_rampage']);
  });
});

describe('pointsSpent', () => {
  test('compte le coût par rang, et ignore ce qui n existe plus', () => {
    // Garde haute coûte 1 point par rang, Déchaînement 3 pour son rang unique.
    const spent = pointsSpent([
      { nodeId: 'war_bulwark_1', rank: 3 },
      { nodeId: 'war_fury_3', rank: 1 },
      { nodeId: 'noeud_supprime', rank: 5 },
    ]);

    expect(spent).toBe(6);
  });
});
