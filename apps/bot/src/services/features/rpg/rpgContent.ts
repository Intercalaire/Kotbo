/**
 * Contenu RPG livré de base avec le bot.
 *
 * Tout est défini ici sous forme de données pures (aucun accès base) pour que le seed,
 * les tests et le dashboard partagent exactement le même catalogue.
 *
 * Cohérence à préserver lors de toute modification :
 *  - chaque `itemName` d'un drop de monstre DOIT exister dans `RPG_ITEMS` ;
 *  - chaque ingrédient de recette et chaque `resultItemName` DOIT exister dans `RPG_ITEMS` ;
 *  - les noms d'objets sont uniques (contrainte `@@unique([guildId, name])`).
 * Le test `rpgContent.test.ts` vérifie ces trois invariants.
 */

export type ItemType = 'WEAPON' | 'ARMOR' | 'ACCESSORY' | 'POTION' | 'MATERIAL' | 'SCROLL';
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';

export type SeedItem = {
  name: string;
  description: string;
  emoji: string;
  type: ItemType;
  rarity: Rarity;
  levelRequired?: number;
  atkBonus?: number;
  defBonus?: number;
  spdBonus?: number;
  hpBonus?: number;
  hpRestore?: number;
  energyRestore?: number;
  /** Parchemins uniquement : entrée du catalogue `rpgEnchantments.ts` et palier posé. */
  enchantId?: string;
  enchantTier?: number;
  price: number;
  /** Les objets fabriqués et les matériaux ne s'achètent pas en boutique. */
  purchasable: boolean;
};

export type SeedMonsterDrop = {
  itemName: string;
  emoji: string;
  chance: number;
  coinBonus?: number;
};

export type SeedMonster = {
  name: string;
  description: string;
  emoji: string;
  level: number;
  health: number;
  attack: number;
  defense: number;
  speed: number;
  xpReward: number;
  coinReward: number;
  drops: SeedMonsterDrop[];
  isBoss?: boolean;
  bossRespawnHours?: number;
};

export type SeedAdventureChoice = {
  text: string;
  hpEffect: number;
  coinEffect: number;
  xpEffect: number;
  minLevel: number;
};

export type SeedAdventureEvent = {
  title: string;
  description: string;
  emoji: string;
  choices: SeedAdventureChoice[];
};

export type SeedRecipe = {
  resultItemName: string;
  ingredients: { itemName: string; quantity: number }[];
  coinCost: number;
  levelRequired: number;
};

// ════════════════════════════════════════════════════════════════════════════
// ARMES - 5 paliers, orientées force / agilité / magie
// ════════════════════════════════════════════════════════════════════════════

const WEAPONS: SeedItem[] = [
  // ── Palier 1 (niveau 1) ──
  { name: 'Épée en bois', description: "Une simple épée taillée dans du bois. Tout le monde commence quelque part.", emoji: '🪵', type: 'WEAPON', rarity: 'COMMON', levelRequired: 1, atkBonus: 5, price: 50, purchasable: true },
  { name: 'Dague rouillée', description: 'Légère et discrète, mais elle a connu des jours meilleurs.', emoji: '🔪', type: 'WEAPON', rarity: 'COMMON', levelRequired: 1, atkBonus: 4, spdBonus: 3, price: 60, purchasable: true },
  { name: 'Bâton de novice', description: "Un bâton de frêne qui canalise péniblement un filet de magie.", emoji: '🪄', type: 'WEAPON', rarity: 'COMMON', levelRequired: 1, atkBonus: 6, price: 70, purchasable: true },

  // ── Palier 2 (niveau 5) ──
  { name: 'Dague en fer', description: 'Une lame en fer, aiguisée et parfaitement équilibrée.', emoji: '🗡️', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 5, atkBonus: 9, spdBonus: 4, price: 180, purchasable: true },
  { name: 'Épée courte', description: "Forgée à partir d'os et de dents arrachés aux gobelins.", emoji: '⚔️', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 5, atkBonus: 12, price: 220, purchasable: false },
  { name: 'Arc de chasse', description: 'Un arc en if tendu de nerf de cerf. Silencieux et redoutable.', emoji: '🏹', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 5, atkBonus: 10, spdBonus: 5, price: 240, purchasable: true },
  { name: "Grimoire d'apprenti", description: "Trois sorts, dont deux qui fonctionnent à peu près.", emoji: '📕', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 6, atkBonus: 13, price: 260, purchasable: true },

  // ── Palier 3 (niveau 10) ──
  { name: 'Hache de guerre', description: 'Une masse de métal brut qui fend les armures comme du bois.', emoji: '🪓', type: 'WEAPON', rarity: 'RARE', levelRequired: 10, atkBonus: 19, price: 650, purchasable: false },
  { name: "Rapière d'argent", description: "L'argent brûle les morts-vivants au contact.", emoji: '🤺', type: 'WEAPON', rarity: 'RARE', levelRequired: 10, atkBonus: 16, spdBonus: 8, price: 700, purchasable: true },
  { name: 'Arc long elfique', description: 'Sa portée dépasse celle de la vue humaine.', emoji: '🎯', type: 'WEAPON', rarity: 'RARE', levelRequired: 11, atkBonus: 17, spdBonus: 6, price: 720, purchasable: true },
  { name: 'Sceptre de givre', description: "Le froid qu'il dégage fait craquer l'air alentour.", emoji: '❄️', type: 'WEAPON', rarity: 'RARE', levelRequired: 12, atkBonus: 21, price: 800, purchasable: false },

  // ── Palier 4 (niveau 18) ──
  { name: "Lame d'Obsidienne", description: "Un tranchant d'un seul atome d'épaisseur, né du cœur d'un volcan.", emoji: '🌋', type: 'WEAPON', rarity: 'EPIC', levelRequired: 18, atkBonus: 29, spdBonus: 5, price: 2200, purchasable: false },
  { name: 'Arc du Crépuscule', description: 'Ses flèches trouvent leur cible même dans le noir absolu.', emoji: '🌇', type: 'WEAPON', rarity: 'EPIC', levelRequired: 18, atkBonus: 26, spdBonus: 12, price: 2100, purchasable: false },
  { name: 'Bâton du Cataclysme', description: 'Chaque incantation laisse un cratère fumant.', emoji: '☄️', type: 'WEAPON', rarity: 'EPIC', levelRequired: 20, atkBonus: 33, price: 2600, purchasable: false },

  // ── Palier 5 (niveau 25) ──
  { name: 'Excalibur', description: "L'épée des rois légitimes, forgée dans des temps oubliés.", emoji: '👑', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 25, atkBonus: 46, spdBonus: 10, price: 8000, purchasable: false },
  { name: 'Faux des Âmes', description: 'Elle moissonne les vivants aussi facilement que le blé.', emoji: '💀', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 27, atkBonus: 52, price: 9000, purchasable: false },
  { name: 'Arc Céleste', description: "Tendu avec un rayon d'étoile en guise de corde.", emoji: '✨', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 25, atkBonus: 43, spdBonus: 20, price: 7500, purchasable: false },

  // ── Compléments de palier ──
  { name: 'Gourdin clouté', description: "Un morceau de bois, des clous. L'efficacité avant l'élégance.", emoji: '🏏', type: 'WEAPON', rarity: 'COMMON', levelRequired: 1, atkBonus: 7, spdBonus: -1, price: 65, purchasable: true },
  { name: 'Fronde de berger', description: 'Une lanière de cuir et un caillou bien choisi. Demandez à Goliath.', emoji: '🪨', type: 'WEAPON', rarity: 'COMMON', levelRequired: 2, atkBonus: 5, spdBonus: 4, price: 75, purchasable: true },
  { name: 'Masse de fer', description: 'Elle ne coupe pas. Elle écrase, ce qui revient au même.', emoji: '🔨', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 6, atkBonus: 14, spdBonus: -2, price: 250, purchasable: true },
  { name: 'Lance de piquier', description: 'Deux mètres de préavis avant le premier coup.', emoji: '🔱', type: 'WEAPON', rarity: 'UNCOMMON', levelRequired: 7, atkBonus: 12, spdBonus: 3, price: 270, purchasable: true },
  { name: 'Cimeterre du désert', description: 'La courbure fait tout le travail.', emoji: '🗡️', type: 'WEAPON', rarity: 'RARE', levelRequired: 11, atkBonus: 18, spdBonus: 7, price: 690, purchasable: true },
  { name: 'Marteau de siège', description: 'Conçu pour les portes. Fonctionne aussi sur les gens.', emoji: '⚒️', type: 'WEAPON', rarity: 'RARE', levelRequired: 13, atkBonus: 24, spdBonus: -4, price: 780, purchasable: false },
  { name: 'Katana spectral', description: 'La lame est là. On la voit à peine.', emoji: '👘', type: 'WEAPON', rarity: 'EPIC', levelRequired: 19, atkBonus: 28, spdBonus: 14, price: 2300, purchasable: false },
  { name: 'Fléau du Damné', description: 'Chaque chaîne porte le nom d’un vaincu.', emoji: '⛓️', type: 'WEAPON', rarity: 'EPIC', levelRequired: 20, atkBonus: 32, spdBonus: 2, price: 2500, purchasable: false },

  // ── Palier 6 (niveau 30) : ce qui se gagne après la campagne ──
  { name: 'Ruine-Monde', description: "Une épée dont le nom se transmet en chuchotant.", emoji: '🌋', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 30, atkBonus: 62, spdBonus: 8, price: 14000, purchasable: false },
  { name: 'Arc du Dernier Jour', description: 'Une seule flèche. Elle suffit toujours.', emoji: '☄️', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 30, atkBonus: 55, spdBonus: 26, price: 13500, purchasable: false },
  { name: 'Codex du Silence', description: 'Le lire à voix haute est déconseillé.', emoji: '📗', type: 'WEAPON', rarity: 'LEGENDARY', levelRequired: 32, atkBonus: 68, price: 15000, purchasable: false },
];

// ════════════════════════════════════════════════════════════════════════════
// ARMURES
// ════════════════════════════════════════════════════════════════════════════

const ARMORS: SeedItem[] = [
  { name: 'Tunique en tissu', description: 'Vêtement de paysan, léger et aéré. Très aéré.', emoji: '👕', type: 'ARMOR', rarity: 'COMMON', levelRequired: 1, defBonus: 3, price: 40, purchasable: true },
  { name: 'Veste de cuir', description: 'Du cuir souple qui ne gêne pas les mouvements.', emoji: '🧥', type: 'ARMOR', rarity: 'COMMON', levelRequired: 1, defBonus: 5, spdBonus: 1, price: 90, purchasable: true },

  { name: 'Cotte de mailles', description: 'Bruyante, lourde, mais elle arrête les lames.', emoji: '🛡️', type: 'ARMOR', rarity: 'UNCOMMON', levelRequired: 5, defBonus: 9, price: 260, purchasable: true },
  { name: 'Armure de cuir clouté', description: 'Renforcée de fourrure de loup et de rivets de fer.', emoji: '🥾', type: 'ARMOR', rarity: 'UNCOMMON', levelRequired: 5, defBonus: 7, spdBonus: 3, price: 280, purchasable: false },
  { name: 'Robe de mage', description: 'Ses runes tissées absorbent une part des chocs.', emoji: '🧙', type: 'ARMOR', rarity: 'UNCOMMON', levelRequired: 6, defBonus: 6, hpBonus: 20, price: 300, purchasable: true },

  { name: "Harnois d'acier", description: 'Une forteresse ambulante en plaques articulées.', emoji: '⚙️', type: 'ARMOR', rarity: 'RARE', levelRequired: 11, defBonus: 17, hpBonus: 30, price: 900, purchasable: false },
  { name: 'Cuirasse elfique', description: 'Aussi fine qu’une feuille, aussi solide que l’acier.', emoji: '🍃', type: 'ARMOR', rarity: 'RARE', levelRequired: 11, defBonus: 13, spdBonus: 5, hpBonus: 20, price: 950, purchasable: true },
  { name: 'Robe étoilée', description: 'Le tissu contient un morceau de ciel nocturne.', emoji: '🌌', type: 'ARMOR', rarity: 'RARE', levelRequired: 12, defBonus: 11, hpBonus: 50, price: 1000, purchasable: true },

  { name: "Armure d'Orichalque", description: "Un métal mythique que nul forgeron vivant ne sait travailler.", emoji: '🔱', type: 'ARMOR', rarity: 'EPIC', levelRequired: 18, defBonus: 26, hpBonus: 60, price: 2600, purchasable: false },
  { name: 'Manteau du Rôdeur', description: 'Il rend son porteur presque impossible à suivre.', emoji: '🌫️', type: 'ARMOR', rarity: 'EPIC', levelRequired: 18, defBonus: 18, spdBonus: 10, hpBonus: 40, price: 2400, purchasable: false },

  { name: 'Égide des Titans', description: 'Portée par les géants qui soutenaient le monde.', emoji: '🗿', type: 'ARMOR', rarity: 'LEGENDARY', levelRequired: 25, defBonus: 41, hpBonus: 120, price: 8500, purchasable: false },
  { name: 'Voile du Néant', description: "Le vide lui-même, plié et cousu en vêtement.", emoji: '🕳️', type: 'ARMOR', rarity: 'LEGENDARY', levelRequired: 26, defBonus: 31, spdBonus: 15, hpBonus: 80, price: 8200, purchasable: false },

  // ── Compléments de palier ──
  { name: 'Casaque rembourrée', description: 'De la laine, beaucoup de laine. Ça amortit.', emoji: '🧣', type: 'ARMOR', rarity: 'COMMON', levelRequired: 2, defBonus: 4, hpBonus: 10, price: 70, purchasable: true },
  { name: 'Brigandine', description: 'Des plaques cousues entre deux couches de toile.', emoji: '🥋', type: 'ARMOR', rarity: 'UNCOMMON', levelRequired: 7, defBonus: 11, spdBonus: -1, price: 300, purchasable: true },
  { name: 'Manteau de fourrure', description: 'Chaud, épais, et il arrête les griffes.', emoji: '🧥', type: 'ARMOR', rarity: 'UNCOMMON', levelRequired: 8, defBonus: 8, hpBonus: 35, price: 320, purchasable: false },
  { name: 'Plastron de mithril', description: 'Le poids d’une chemise, la solidité d’un mur.', emoji: '⚪', type: 'ARMOR', rarity: 'RARE', levelRequired: 13, defBonus: 15, spdBonus: 4, hpBonus: 35, price: 1050, purchasable: false },
  { name: 'Robe de l’Oracle', description: 'Les fils changent de couleur selon ce qui vous attend.', emoji: '🔮', type: 'ARMOR', rarity: 'RARE', levelRequired: 14, defBonus: 12, hpBonus: 60, price: 1100, purchasable: true },
  { name: 'Carapace de Basilic', description: 'Taillée dans le dos de la bête, sans la regarder.', emoji: '🦎', type: 'ARMOR', rarity: 'EPIC', levelRequired: 19, defBonus: 24, hpBonus: 70, price: 2700, purchasable: false },
  { name: 'Cuirasse démoniaque', description: 'Elle est tiède. Elle l’a toujours été.', emoji: '😈', type: 'ARMOR', rarity: 'EPIC', levelRequired: 21, defBonus: 28, spdBonus: 4, hpBonus: 50, price: 2900, purchasable: false },

  // ── Palier 6 (niveau 30) ──
  { name: 'Rempart du Dernier Roi', description: 'La dernière armure sortie des forges d’avant la chute.', emoji: '🏰', type: 'ARMOR', rarity: 'LEGENDARY', levelRequired: 30, defBonus: 52, hpBonus: 170, price: 15000, purchasable: false },
  { name: 'Linceul d’Étoiles', description: 'Il ne pèse rien et arrête pourtant tout.', emoji: '🌠', type: 'ARMOR', rarity: 'LEGENDARY', levelRequired: 31, defBonus: 38, spdBonus: 20, hpBonus: 120, price: 14500, purchasable: false },
];

// ════════════════════════════════════════════════════════════════════════════
// ACCESSOIRES - le troisième emplacement, qui définit vraiment un build
// ════════════════════════════════════════════════════════════════════════════

const ACCESSORIES: SeedItem[] = [
  { name: 'Anneau de cuivre', description: 'Il verdit au doigt, mais il porte chance.', emoji: '💍', type: 'ACCESSORY', rarity: 'COMMON', levelRequired: 1, atkBonus: 2, price: 80, purchasable: true },
  { name: 'Amulette de bois', description: 'Un talisman de village, gravé à la main.', emoji: '🪬', type: 'ACCESSORY', rarity: 'COMMON', levelRequired: 1, defBonus: 2, price: 80, purchasable: true },
  { name: 'Talisman du voyageur', description: 'Il allège les pas sur les longues routes.', emoji: '🧭', type: 'ACCESSORY', rarity: 'COMMON', levelRequired: 2, spdBonus: 3, price: 90, purchasable: true },

  { name: 'Anneau de fer', description: 'Simple, solide, efficace.', emoji: '⭕', type: 'ACCESSORY', rarity: 'UNCOMMON', levelRequired: 5, atkBonus: 5, defBonus: 2, price: 300, purchasable: true },
  { name: 'Collier de croc', description: 'Les crocs de vos premières victimes, enfilés sur un lien.', emoji: '🦷', type: 'ACCESSORY', rarity: 'UNCOMMON', levelRequired: 4, hpBonus: 25, price: 280, purchasable: false },
  { name: 'Bottes légères', description: 'Semelles de cuir souple, faites pour courir.', emoji: '👟', type: 'ACCESSORY', rarity: 'UNCOMMON', levelRequired: 5, spdBonus: 8, price: 320, purchasable: true },

  { name: 'Anneau de saphir', description: 'La pierre pulse doucement au rythme du cœur.', emoji: '🔵', type: 'ACCESSORY', rarity: 'RARE', levelRequired: 10, atkBonus: 8, hpBonus: 30, price: 1100, purchasable: true },
  { name: "Amulette d'ambre", description: 'Un insecte vieux de mille ans dort à l’intérieur.', emoji: '🟠', type: 'ACCESSORY', rarity: 'RARE', levelRequired: 10, defBonus: 10, hpBonus: 40, price: 1150, purchasable: true },
  { name: "Cape d'ombre", description: 'Tissée dans la soie des araignées géantes.', emoji: '🦇', type: 'ACCESSORY', rarity: 'RARE', levelRequired: 10, spdBonus: 14, price: 1200, purchasable: false },

  { name: 'Anneau de rubis', description: 'Chaud au toucher, comme une braise qui ne s’éteint pas.', emoji: '🔴', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 18, atkBonus: 15, defBonus: 5, price: 3000, purchasable: false },
  { name: 'Cœur de pierre', description: 'Celui qui le porte ne connaît plus la douleur.', emoji: '🪨', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 18, defBonus: 18, hpBonus: 90, price: 3200, purchasable: false },
  { name: 'Bottes ailées', description: 'Elles effleurent le sol sans jamais vraiment le toucher.', emoji: '🪽', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 19, spdBonus: 22, price: 3100, purchasable: false },

  { name: 'Sceau du Dragon', description: "L'autorité d'un dragon ancien, condensée en un sceau.", emoji: '🐲', type: 'ACCESSORY', rarity: 'LEGENDARY', levelRequired: 22, atkBonus: 25, defBonus: 12, hpBonus: 100, price: 6000, purchasable: false },
  { name: 'Couronne du Roi Gobelin', description: 'Ridicule sur la tête d’un humain. Terriblement efficace.', emoji: '👑', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 8, atkBonus: 10, defBonus: 6, hpBonus: 35, price: 1800, purchasable: false },

  // ── Compléments : trois emplacements à garnir, il en fallait de quoi choisir ──
  { name: 'Bracelet de cuir', description: 'Il protège le poignet, ce qui n’est pas rien.', emoji: '🤎', type: 'ACCESSORY', rarity: 'COMMON', levelRequired: 1, defBonus: 1, spdBonus: 2, price: 70, purchasable: true },
  { name: 'Pendentif de quartz', description: 'La pierre tiédit quand un danger approche.', emoji: '⚪', type: 'ACCESSORY', rarity: 'COMMON', levelRequired: 3, hpBonus: 12, price: 95, purchasable: true },
  { name: 'Ceinture cloutée', description: 'Tient le pantalon et arrête les coups bas.', emoji: '🥋', type: 'ACCESSORY', rarity: 'UNCOMMON', levelRequired: 6, defBonus: 5, hpBonus: 15, price: 310, purchasable: true },
  { name: 'Gantelets de fer', description: 'On frappe plus fort quand on ne craint plus ses mains.', emoji: '🧤', type: 'ACCESSORY', rarity: 'UNCOMMON', levelRequired: 7, atkBonus: 7, price: 330, purchasable: true },
  { name: 'Broche de l’Aube', description: 'Elle luit faiblement, même dans le noir complet.', emoji: '🌅', type: 'ACCESSORY', rarity: 'RARE', levelRequired: 12, atkBonus: 6, defBonus: 6, spdBonus: 6, price: 1180, purchasable: true },
  { name: 'Anneau d’émeraude', description: 'Les plaies se referment un peu plus vite.', emoji: '🟢', type: 'ACCESSORY', rarity: 'RARE', levelRequired: 13, hpBonus: 65, price: 1220, purchasable: true },
  { name: 'Amulette du Nécromancien', description: 'Elle bat au rythme du cœur qu’elle a remplacé.', emoji: '🧟', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 20, atkBonus: 12, hpBonus: 55, price: 3300, purchasable: false },
  { name: 'Écaille porte-bonheur', description: 'Arrachée à un dragon endormi. Il dort toujours.', emoji: '🐲', type: 'ACCESSORY', rarity: 'EPIC', levelRequired: 21, defBonus: 14, spdBonus: 10, price: 3400, purchasable: false },
  { name: 'Larme du Léviathan', description: 'Une goutte d’eau qui ne s’évapore jamais.', emoji: '💧', type: 'ACCESSORY', rarity: 'LEGENDARY', levelRequired: 26, defBonus: 20, hpBonus: 140, price: 6500, purchasable: false },
  { name: 'Œil du Seigneur des Ombres', description: 'Il regarde dans la même direction que vous. Toujours.', emoji: '🌑', type: 'ACCESSORY', rarity: 'LEGENDARY', levelRequired: 28, atkBonus: 30, spdBonus: 14, price: 7200, purchasable: false },
];

// ════════════════════════════════════════════════════════════════════════════
// POTIONS
// ════════════════════════════════════════════════════════════════════════════

const POTIONS: SeedItem[] = [
  { name: 'Potion de Vie Mineure', description: 'Restaure 25 points de vie.', emoji: '🧪', type: 'POTION', rarity: 'COMMON', hpRestore: 25, price: 20, purchasable: true },
  { name: 'Potion de Vie', description: 'Restaure 70 points de vie.', emoji: '🍷', type: 'POTION', rarity: 'UNCOMMON', hpRestore: 70, price: 65, purchasable: true },
  { name: 'Potion de Vie Majeure', description: 'Restaure 160 points de vie.', emoji: '🏺', type: 'POTION', rarity: 'RARE', hpRestore: 160, price: 160, purchasable: true },
  { name: "Potion d'Énergie", description: "Restaure 35 points d'énergie.", emoji: '⚡', type: 'POTION', rarity: 'COMMON', energyRestore: 35, price: 30, purchasable: true },
  { name: "Grande Potion d'Énergie", description: "Restaure 80 points d'énergie.", emoji: '🔋', type: 'POTION', rarity: 'RARE', energyRestore: 80, price: 110, purchasable: true },
  { name: 'Élixir Divin', description: "Restaure 220 PV et 100 d'énergie. Un miracle en flacon.", emoji: '🍯', type: 'POTION', rarity: 'LEGENDARY', hpRestore: 220, energyRestore: 100, price: 400, purchasable: true },
  { name: 'Décoction du Bûcheron', description: "Restaure 45 PV et 20 d'énergie. Goût de résine.", emoji: '🥃', type: 'POTION', rarity: 'COMMON', hpRestore: 45, energyRestore: 20, price: 45, purchasable: true },
  { name: 'Tisane de Mousse', description: "Restaure 110 PV. Amère, mais elle fait son office.", emoji: '🍵', type: 'POTION', rarity: 'UNCOMMON', hpRestore: 110, price: 105, purchasable: true },
  { name: 'Philtre du Veilleur', description: "Restaure 55 d'énergie. On ne dort plus, c'est le principe.", emoji: '☕', type: 'POTION', rarity: 'UNCOMMON', energyRestore: 55, price: 70, purchasable: true },
  { name: 'Sang de Titan', description: "Restaure 400 PV. Il en reste très peu au monde.", emoji: '🩸', type: 'POTION', rarity: 'EPIC', hpRestore: 400, price: 320, purchasable: false },
];

// ════════════════════════════════════════════════════════════════════════════
// MATÉRIAUX - butin de combat, matière première de l'artisanat
// ════════════════════════════════════════════════════════════════════════════

function material(name: string, description: string, emoji: string, rarity: Rarity, price: number): SeedItem {
  return { name, description, emoji, type: 'MATERIAL', rarity, price, purchasable: false };
}

const MATERIALS: SeedItem[] = [
  material('Gelée de Slime', 'Gluante, tiède, étonnamment utile en alchimie.', '🟢', 'COMMON', 8),
  material('Queue de Rat', 'Preuve de dératisation. Les tanneurs en font des lanières.', '🪶', 'COMMON', 6),
  material('Dent de Gobelin', 'Jaune et ébréchée, mais dure comme du silex.', '🦷', 'COMMON', 12),
  material('Fourrure de Loup', 'Épaisse et chaude, très recherchée par les artisans.', '🧶', 'COMMON', 18),
  material('Aile de Chauve-souris', 'Membrane fine utilisée dans les philtres de vol.', '🦇', 'COMMON', 14),
  material('Défense de Sanglier', 'Ivoire brut, idéal pour les manches d’armes.', '🐗', 'UNCOMMON', 25),
  material('Os Enchanté', 'Il vibre faiblement quand on l’approche d’une flamme.', '🦴', 'UNCOMMON', 35),
  material("Soie d'Araignée", 'Plus résistante que l’acier à poids égal.', '🕸️', 'UNCOMMON', 40),
  material('Mousse de Troll', 'Elle repousse toute seule. Base de tous les onguents.', '🌿', 'UNCOMMON', 30),
  material('Plume de Harpie', 'Elle chante doucement quand le vent la traverse.', '🪶', 'RARE', 60),
  material('Éclat de Granite', 'Un fragment de golem, encore animé d’un frisson.', '🪨', 'RARE', 55),
  material('Ectoplasme', 'Froid, insaisissable, et pourtant bien réel.', '👻', 'RARE', 70),
  material('Braise Éternelle', 'Elle brûle depuis mille ans sans consommer quoi que ce soit.', '🔥', 'RARE', 85),
  material('Fragment d’Armure Maudite', 'Le métal murmure des reproches à qui l’écoute.', '🛡️', 'RARE', 80),
  material('Œil de Basilic', 'Ne le regardez pas trop longtemps.', '👁️', 'EPIC', 120),
  material('Corne de Minotaure', 'Elle a défoncé plus de murs que de portes.', '🐂', 'EPIC', 130),
  material('Écaille de Dragon', 'Aucune lame connue ne l’a jamais entaillée.', '✨', 'EPIC', 180),
  material('Phylactère Brisé', 'L’âme qu’il contenait s’est enfuie. Le pouvoir est resté.', '💎', 'EPIC', 200),
  material('Aiguillon de Wyverne', 'Encore humide d’un venin qui ronge la pierre.', '🦂', 'EPIC', 150),
  material('Grimoire Maudit', 'Les pages tournent seules, dans le mauvais sens.', '📓', 'EPIC', 220),
  material('Corne Démoniaque', 'Elle est chaude, et elle bat comme un cœur.', '😈', 'EPIC', 240),
  material("Cœur d'Obsidienne", 'Le noyau volcanique d’un colosse de pierre.', '🖤', 'EPIC', 260),
  material('Crinière de Chimère', 'Trois textures différentes sur une seule crinière.', '🦁', 'LEGENDARY', 320),
  material('Cœur de Givre', 'Il gèle l’air à un mètre à la ronde.', '🧊', 'LEGENDARY', 350),
  material("Croc d'Hydre", 'Repousse tout seul si on ne cautérise pas la gencive.', '🐍', 'LEGENDARY', 380),
  material('Cœur de Dragon', 'Il bat encore. Personne ne sait pourquoi.', '❤️‍🔥', 'LEGENDARY', 600),
  material('Orbe des Ombres', 'La nuit entière tient dans cette sphère.', '🌑', 'LEGENDARY', 700),
  material('Bourse Volée', 'Le butin d’un bandit, récupéré sur son cadavre.', '💰', 'UNCOMMON', 50),
  material('Œuf de Vouivre', 'Il remue encore. Mieux vaut ne pas attendre.', '🥚', 'RARE', 90),
  material('Sable de Goule', 'Ce qu’il reste quand le soleil se lève.', '⏳', 'UNCOMMON', 28),
  material('Bois de Sylvain', 'Coupé sur une créature qui protestait.', '🌳', 'UNCOMMON', 32),
  material('Perle des Profondeurs', 'Elle a mis mille ans à se former, dans le noir.', '🫧', 'RARE', 95),
  material('Cendre de Phénix', 'Encore tiède. Elle le restera longtemps.', '🔥', 'EPIC', 210),
  material('Fil de Parque', 'Quelqu’un a coupé ce fil. Ce quelqu’un est mort.', '🧵', 'EPIC', 230),
  material('Clé sans Serrure', 'Elle ouvre quelque chose. Personne ne sait quoi.', '🗝️', 'EPIC', 250),
  material('Gemme du Vide', 'On y voit son reflet, qui ne bouge pas en même temps.', '🔷', 'LEGENDARY', 420),
  material('Couronne Fondue', 'Un royaume entier, réduit à ce lingot tordu.', '👑', 'LEGENDARY', 480),
];

// ════════════════════════════════════════════════════════════════════════════
// PARCHEMINS D'ENCHANTEMENT
// ════════════════════════════════════════════════════════════════════════════
//
// Un parchemin est un objet ordinaire dont le seul rôle est de désigner une entrée du
// catalogue `rpgEnchantments.ts` et le palier qu'il pose. Il ne s'achète pas : il se
// fabrique à partir de matériaux, ce qui donne un second débouché au butin de combat.
//
// Le test `rpgContent.test.ts` vérifie que chaque `enchantId` existe bel et bien dans le
// catalogue et que le palier tient dans le `maxTier` de l'enchantement.

function scroll(
  name: string,
  description: string,
  emoji: string,
  rarity: Rarity,
  enchantId: string,
  enchantTier: number,
  price: number,
): SeedItem {
  return { name, description, emoji, type: 'SCROLL', rarity, enchantId, enchantTier, price, purchasable: false };
}

const SCROLLS: SeedItem[] = [
  // ── Armes ──
  scroll('Parchemin d’Embrasement I', "L'encre rougeoie encore quand on la touche.", '📜', 'UNCOMMON', 'flame', 1, 400),
  scroll('Parchemin d’Embrasement II', 'Le vélin fume légèrement, en permanence.', '🔥', 'RARE', 'flame', 2, 900),
  scroll('Parchemin d’Embrasement III', 'Le tenir trop longtemps laisse une marque.', '🌋', 'EPIC', 'flame', 3, 1800),
  scroll('Parchemin de Tranchant I', 'Les bords du papier coupent les doigts distraits.', '📜', 'UNCOMMON', 'keen', 1, 400),
  scroll('Parchemin de Tranchant II', 'On y a écrit avec une lame, pas une plume.', '🗡️', 'RARE', 'keen', 2, 900),
  scroll('Parchemin de Brise-Armure', "Chaque rune y a été frappée au burin.", '🪓', 'RARE', 'sunder', 1, 800),
  scroll('Parchemin de Vampirisme', 'Écrit avec un sang qui refuse de sécher.', '🩸', 'EPIC', 'vampiric', 1, 1600),

  // ── Armures ──
  scroll('Parchemin de Rempart I', 'Le vélin résiste au feu comme à la lame.', '📜', 'UNCOMMON', 'bulwark', 1, 400),
  scroll('Parchemin de Rempart II', 'Impossible à plier, encore moins à déchirer.', '🛡️', 'RARE', 'bulwark', 2, 900),
  scroll('Parchemin de Vitalité I', 'Les runes battent doucement, comme un pouls.', '📜', 'UNCOMMON', 'vitality', 1, 400),
  scroll('Parchemin de Vitalité II', 'Le posé sur une plaie l’apaise. Personne ne sait pourquoi.', '❤️', 'RARE', 'vitality', 2, 900),
  scroll('Parchemin d’Épines', 'Le manipuler sans gants est une mauvaise idée.', '🌵', 'RARE', 'thorns', 1, 800),
  scroll('Parchemin de Sauvegarde', 'Une prière ancienne, dans une langue oubliée.', '✨', 'EPIC', 'warding', 1, 1600),

  // ── Accessoires ──
  scroll('Parchemin de Célérité I', 'Il glisse des mains si on ne le tient pas fermement.', '📜', 'COMMON', 'swiftness', 1, 250),
  scroll('Parchemin de Célérité II', 'Les runes bougent trop vite pour être lues.', '🌪️', 'UNCOMMON', 'swiftness', 2, 600),
];

export const RPG_ITEMS: SeedItem[] = [...WEAPONS, ...ARMORS, ...ACCESSORIES, ...POTIONS, ...MATERIALS, ...SCROLLS];

// ════════════════════════════════════════════════════════════════════════════
// BESTIAIRE
// ════════════════════════════════════════════════════════════════════════════

export const RPG_MONSTERS: SeedMonster[] = [
  // ─── Palier 1 (niveau 1-4) ───
  { name: 'Slime', description: 'Une créature gélatineuse qui traîne dans les prairies.', emoji: '🟢', level: 1, health: 95, attack: 3, defense: 2, speed: 3, xpReward: 12, coinReward: 6, drops: [{ itemName: 'Gelée de Slime', emoji: '🟢', chance: 0.35 }] },
  { name: 'Rat Géant', description: 'Un rongeur de taille anormale qui rôde dans les égouts.', emoji: '🐀', level: 1, health: 80, attack: 5, defense: 3, speed: 8, xpReward: 14, coinReward: 9, drops: [{ itemName: 'Queue de Rat', emoji: '🪶', chance: 0.3 }] },
  { name: 'Chauve-souris des Cavernes', description: 'Elle attaque en piqué, toujours par surprise.', emoji: '🦇', level: 2, health: 93, attack: 6, defense: 2, speed: 14, xpReward: 16, coinReward: 10, drops: [{ itemName: 'Aile de Chauve-souris', emoji: '🦇', chance: 0.3 }] },
  { name: 'Gobelin', description: "Un petit humanoïde vert et rusé armé d'un couteau rouillé.", emoji: '👺', level: 2, health: 133, attack: 7, defense: 4, speed: 6, xpReward: 20, coinReward: 14, drops: [{ itemName: 'Dent de Gobelin', emoji: '🦷', chance: 0.3 }] },
  { name: 'Sanglier Enragé', description: 'Il charge d’abord et ne réfléchit jamais.', emoji: '🐗', level: 3, health: 200, attack: 11, defense: 6, speed: 9, xpReward: 24, coinReward: 16, drops: [{ itemName: 'Défense de Sanglier', emoji: '🐗', chance: 0.28 }] },
  { name: 'Loup Sauvage', description: 'Un prédateur féroce aux yeux luisants qui chasse en meute.', emoji: '🐺', level: 3, health: 164, attack: 10, defense: 5, speed: 12, xpReward: 25, coinReward: 17, drops: [{ itemName: 'Fourrure de Loup', emoji: '🧶', chance: 0.32 }] },

  // ─── Palier 2 (niveau 5-9) ───
  { name: 'Squelette Guerrier', description: "Les os d'un ancien soldat animés par une magie sombre.", emoji: '💀', level: 5, health: 171, attack: 11, defense: 9, speed: 7, xpReward: 34, coinReward: 22, drops: [{ itemName: 'Os Enchanté', emoji: '🦴', chance: 0.28 }] },
  { name: 'Bandit de Grand Chemin', description: 'Un voleur aguerri qui attaque les voyageurs imprudents.', emoji: '🥷', level: 5, health: 158, attack: 10, defense: 8, speed: 14, xpReward: 32, coinReward: 28, drops: [{ itemName: 'Bourse Volée', emoji: '💰', chance: 0.35, coinBonus: 40 }] },
  { name: 'Araignée Géante', description: "Une arachnide de la taille d'un cheval, tissant des toiles mortelles.", emoji: '🕷️', level: 6, health: 203, attack: 12, defense: 7, speed: 11, xpReward: 36, coinReward: 20, drops: [{ itemName: "Soie d'Araignée", emoji: '🕸️', chance: 0.3 }] },
  { name: 'Harpie', description: 'Mi-femme mi-rapace, son cri paralyse les proies.', emoji: '🦅', level: 7, health: 233, attack: 15, defense: 10, speed: 18, xpReward: 42, coinReward: 26, drops: [{ itemName: 'Plume de Harpie', emoji: '🪶', chance: 0.22 }] },
  { name: 'Troll des Marais', description: 'Une créature massive et répugnante à la régénération redoutable.', emoji: '🧌', level: 8, health: 304, attack: 17, defense: 16, speed: 4, xpReward: 46, coinReward: 34, drops: [{ itemName: 'Mousse de Troll', emoji: '🌿', chance: 0.3 }] },
  { name: 'Spectre', description: 'Les lames le traversent. Lui ne vous traverse pas.', emoji: '👻', level: 9, health: 201, attack: 22, defense: 9, speed: 16, xpReward: 52, coinReward: 30, drops: [{ itemName: 'Ectoplasme', emoji: '👻', chance: 0.25 }] },

  // ─── Palier 3 (niveau 10-17) ───
  { name: 'Golem de Pierre', description: 'Lent, stupide, et absolument increvable.', emoji: '🪨', level: 10, health: 365, attack: 19, defense: 23, speed: 3, xpReward: 58, coinReward: 40, drops: [{ itemName: 'Éclat de Granite', emoji: '🪨', chance: 0.28 }] },
  { name: 'Chevalier Noir', description: "Un chevalier déchu dont l'armure est imprégnée de malédictions.", emoji: '⚔️', level: 10, health: 296, attack: 25, defense: 20, speed: 10, xpReward: 65, coinReward: 55, drops: [{ itemName: 'Fragment d’Armure Maudite', emoji: '🛡️', chance: 0.2 }] },
  { name: 'Élémentaire de Feu', description: 'Une colonne de flammes dotée d’une volonté propre.', emoji: '🔥', level: 12, health: 281, attack: 32, defense: 10, speed: 17, xpReward: 72, coinReward: 50, drops: [{ itemName: 'Braise Éternelle', emoji: '🔥', chance: 0.2 }] },
  { name: 'Dragon Mineur', description: 'Un jeune dragon cracheur de feu, déjà dangereux malgré sa taille.', emoji: '🐉', level: 12, health: 351, attack: 30, defense: 15, speed: 15, xpReward: 80, coinReward: 65, drops: [{ itemName: 'Écaille de Dragon', emoji: '✨', chance: 0.15 }] },
  { name: 'Basilic', description: 'Son regard change la chair en pierre. Fermez les yeux.', emoji: '🦎', level: 14, health: 359, attack: 36, defense: 16, speed: 12, xpReward: 88, coinReward: 62, drops: [{ itemName: 'Œil de Basilic', emoji: '👁️', chance: 0.14 }] },
  { name: 'Liche', description: 'Un sorcier mort-vivant dont le pouvoir nécromantique est terrifiant.', emoji: '☠️', level: 15, health: 341, attack: 41, defense: 16, speed: 13, xpReward: 95, coinReward: 78, drops: [{ itemName: 'Phylactère Brisé', emoji: '💎', chance: 0.12 }] },
  { name: 'Minotaure', description: 'Il connaît chaque recoin du labyrinthe. Vous, non.', emoji: '🐂', level: 16, health: 546, attack: 46, defense: 23, speed: 11, xpReward: 105, coinReward: 85, drops: [{ itemName: 'Corne de Minotaure', emoji: '🐂', chance: 0.13 }] },
  { name: 'Wyverne', description: 'Un dragon sans bras, mais avec un dard plein de venin.', emoji: '🐲', level: 17, health: 473, attack: 52, defense: 21, speed: 22, xpReward: 112, coinReward: 90, drops: [{ itemName: 'Aiguillon de Wyverne', emoji: '🦂', chance: 0.13 }] },

  // ─── Palier 4 (niveau 18+) ───
  { name: 'Nécromancien', description: 'Chaque ennemi qu’il tue rejoint son armée.', emoji: '🧟', level: 19, health: 438, attack: 58, defense: 22, speed: 15, xpReward: 125, coinReward: 100, drops: [{ itemName: 'Grimoire Maudit', emoji: '📓', chance: 0.11 }] },
  { name: 'Démon Infernal', description: 'Une entité des profondeurs, incarnation de la destruction pure.', emoji: '👿', level: 20, health: 499, attack: 65, defense: 26, speed: 18, xpReward: 135, coinReward: 115, drops: [{ itemName: 'Corne Démoniaque', emoji: '😈', chance: 0.1 }] },
  { name: "Golem d'Obsidienne", description: 'Un colosse de roche volcanique, quasi indestructible.', emoji: '🗿', level: 22, health: 602, attack: 65, defense: 38, speed: 5, xpReward: 145, coinReward: 125, drops: [{ itemName: "Cœur d'Obsidienne", emoji: '🖤', chance: 0.09 }] },
  { name: 'Chimère', description: 'Lion, chèvre et serpent. Aucun des trois n’est content.', emoji: '🦁', level: 24, health: 519, attack: 92, defense: 21, speed: 20, xpReward: 165, coinReward: 140, drops: [{ itemName: 'Crinière de Chimère', emoji: '🦁', chance: 0.08 }] },
  { name: 'Titan de Glace', description: 'Sa seule présence fait tomber la température de vingt degrés.', emoji: '🧊', level: 26, health: 747, attack: 99, defense: 37, speed: 8, xpReward: 185, coinReward: 160, drops: [{ itemName: 'Cœur de Givre', emoji: '🧊', chance: 0.08 }] },

  // ─── BOSS ───
  { name: 'Roi Gobelin', description: 'Le souverain autoproclamé de la horde gobeline, entouré de ses gardes.', emoji: '👑', level: 5, health: 349, attack: 13, defense: 9, speed: 8, xpReward: 110, coinReward: 90, drops: [{ itemName: 'Couronne du Roi Gobelin', emoji: '👑', chance: 0.5 }, { itemName: 'Dent de Gobelin', emoji: '🦷', chance: 1 }], isBoss: true, bossRespawnHours: 1 },
  { name: 'Reine Araignée', description: 'Elle a mangé toutes les aventurières venues avant vous.', emoji: '🕷️', level: 8, health: 390, attack: 20, defense: 12, speed: 16, xpReward: 165, coinReward: 130, drops: [{ itemName: "Soie d'Araignée", emoji: '🕸️', chance: 0.8 }, { itemName: 'Œil de Basilic', emoji: '👁️', chance: 0.2 }], isBoss: true, bossRespawnHours: 2 },
  { name: 'Hydre des Marais', description: 'Une bête à trois têtes venimeuses, terreur des marécages.', emoji: '🐍', level: 10, health: 542, attack: 29, defense: 16, speed: 10, xpReward: 220, coinReward: 170, drops: [{ itemName: "Croc d'Hydre", emoji: '🐍', chance: 0.4 }, { itemName: 'Mousse de Troll', emoji: '🌿', chance: 0.9 }], isBoss: true, bossRespawnHours: 2 },
  { name: 'Dragon Ancien', description: 'Le plus ancien des dragons, dont le souffle réduit les montagnes en cendres.', emoji: '🐲', level: 18, health: 879, attack: 68, defense: 30, speed: 20, xpReward: 430, coinReward: 330, drops: [{ itemName: 'Cœur de Dragon', emoji: '❤️‍🔥', chance: 0.3 }, { itemName: 'Écaille de Dragon', emoji: '✨', chance: 0.85 }], isBoss: true, bossRespawnHours: 4 },
  { name: 'Archange Déchu', description: 'Il garde encore ses ailes. Elles sont noires, maintenant.', emoji: '🪽', level: 22, health: 1061, attack: 94, defense: 35, speed: 26, xpReward: 560, coinReward: 420, drops: [{ itemName: 'Plume de Harpie', emoji: '🪶', chance: 0.9 }, { itemName: 'Phylactère Brisé', emoji: '💎', chance: 0.35 }], isBoss: true, bossRespawnHours: 6 },
  { name: 'Léviathan des Abysses', description: 'Une masse sans fin qui remonte des fosses océaniques.', emoji: '🐋', level: 24, health: 1156, attack: 108, defense: 33, speed: 14, xpReward: 640, coinReward: 480, drops: [{ itemName: 'Cœur de Givre', emoji: '🧊', chance: 0.4 }, { itemName: "Croc d'Hydre", emoji: '🐍', chance: 0.5 }], isBoss: true, bossRespawnHours: 6 },
  { name: 'Seigneur des Ombres', description: "L'entité suprême des ténèbres, boss ultime du monde de Kotbo.", emoji: '🌑', level: 25, health: 1292, attack: 116, defense: 39, speed: 25, xpReward: 780, coinReward: 560, drops: [{ itemName: 'Orbe des Ombres', emoji: '🌑', chance: 0.25 }, { itemName: 'Crinière de Chimère', emoji: '🦁', chance: 0.4 }], isBoss: true, bossRespawnHours: 8 },

  // ─── Compléments palier 1 ───
  { name: 'Corbeau Charognard', description: 'Il vous suit depuis une heure. Il sait quelque chose.', emoji: '🐦‍⬛', level: 1, health: 70, attack: 4, defense: 2, speed: 15, xpReward: 13, coinReward: 8, drops: [{ itemName: 'Plume de Harpie', emoji: '🪶', chance: 0.08 }] },
  { name: 'Champignon Rôdeur', description: 'Il était immobile il y a encore une seconde.', emoji: '🍄', level: 2, health: 127, attack: 5, defense: 6, speed: 2, xpReward: 17, coinReward: 9, drops: [{ itemName: 'Mousse de Troll', emoji: '🌿', chance: 0.25 }] },
  { name: 'Sylvain', description: 'Un tronc qui marche, et qui n’a pas apprécié la hache.', emoji: '🌳', level: 4, health: 200, attack: 8, defense: 12, speed: 2, xpReward: 28, coinReward: 18, drops: [{ itemName: 'Bois de Sylvain', emoji: '🌳', chance: 0.3 }] },

  // ─── Compléments palier 2 ───
  { name: 'Goule', description: 'Elle mange ce qu’on enterre. Elle n’attend plus.', emoji: '🧟', level: 6, health: 209, attack: 13, defense: 7, speed: 9, xpReward: 38, coinReward: 21, drops: [{ itemName: 'Sable de Goule', emoji: '⏳', chance: 0.3 }] },
  { name: 'Ours des Cavernes', description: 'Vous êtes dans sa grotte. C’est tout le problème.', emoji: '🐻', level: 7, health: 341, attack: 17, defense: 15, speed: 7, xpReward: 44, coinReward: 30, drops: [{ itemName: 'Fourrure de Loup', emoji: '🧶', chance: 0.4 }] },
  { name: 'Guêpe Géante', description: 'Le dard fait la taille d’un poignard.', emoji: '🐝', level: 8, health: 189, attack: 18, defense: 6, speed: 21, xpReward: 45, coinReward: 24, drops: [{ itemName: 'Aiguillon de Wyverne', emoji: '🦂', chance: 0.1 }] },

  // ─── Compléments palier 3 ───
  { name: 'Vouivre', description: 'Une cousine pauvre du dragon. Toujours un dragon.', emoji: '🐉', level: 11, health: 306, attack: 26, defense: 11, speed: 19, xpReward: 70, coinReward: 52, drops: [{ itemName: 'Œuf de Vouivre', emoji: '🥚', chance: 0.18 }] },
  { name: 'Gargouille', description: 'Elle a passé deux siècles sur ce toit, à attendre.', emoji: '🗿', level: 13, health: 401, attack: 31, defense: 29, speed: 6, xpReward: 82, coinReward: 58, drops: [{ itemName: 'Éclat de Granite', emoji: '🪨', chance: 0.25 }] },
  { name: 'Banshee', description: 'Son cri fêle les os avant d’atteindre les oreilles.', emoji: '👻', level: 15, health: 336, attack: 42, defense: 12, speed: 20, xpReward: 96, coinReward: 70, drops: [{ itemName: 'Ectoplasme', emoji: '👻', chance: 0.3 }] },
  { name: 'Ondine des Récifs', description: 'Elle chante. N’écoutez pas.', emoji: '🧜', level: 16, health: 431, attack: 42, defense: 21, speed: 17, xpReward: 100, coinReward: 76, drops: [{ itemName: 'Perle des Profondeurs', emoji: '🫧', chance: 0.16 }] },

  // ─── Compléments palier 4 ───
  { name: 'Phénix', description: 'Le tuer une fois ne suffit jamais.', emoji: '🔥', level: 21, health: 534, attack: 76, defense: 21, speed: 28, xpReward: 150, coinReward: 130, drops: [{ itemName: 'Cendre de Phénix', emoji: '🔥', chance: 0.12 }] },
  { name: 'Colosse de Bronze', description: 'Il garde un pont que plus personne ne traverse.', emoji: '🗿', level: 23, health: 713, attack: 77, defense: 35, speed: 4, xpReward: 158, coinReward: 138, drops: [{ itemName: "Cœur d'Obsidienne", emoji: '🖤', chance: 0.1 }] },
  { name: 'Faucheur', description: 'Il ne court pas. Il n’en a jamais eu besoin.', emoji: '💀', level: 27, health: 605, attack: 110, defense: 25, speed: 24, xpReward: 200, coinReward: 175, drops: [{ itemName: 'Fil de Parque', emoji: '🧵', chance: 0.1 }] },
  { name: 'Gardien du Seuil', description: 'Il ne vous empêche pas d’entrer. Il empêche autre chose de sortir.', emoji: '🚪', level: 29, health: 825, attack: 118, defense: 41, speed: 12, xpReward: 225, coinReward: 195, drops: [{ itemName: 'Clé sans Serrure', emoji: '🗝️', chance: 0.1 }] },

  // ─── Nouveaux boss ───
  { name: 'Matriarche Sylvestre', description: 'La forêt entière est son corps. Vous marchez dessus depuis ce matin.', emoji: '🌲', level: 12, health: 682, attack: 38, defense: 22, speed: 7, xpReward: 260, coinReward: 200, drops: [{ itemName: 'Bois de Sylvain', emoji: '🌳', chance: 0.9 }, { itemName: 'Braise Éternelle', emoji: '🔥', chance: 0.25 }], isBoss: true, bossRespawnHours: 3 },
  { name: 'Roi Liche', description: 'Il régnait déjà avant de mourir. La mort n’a rien changé.', emoji: '☠️', level: 16, health: 745, attack: 54, defense: 23, speed: 14, xpReward: 350, coinReward: 280, drops: [{ itemName: 'Phylactère Brisé', emoji: '💎', chance: 0.45 }, { itemName: 'Grimoire Maudit', emoji: '📓', chance: 0.3 }], isBoss: true, bossRespawnHours: 4 },
  { name: 'Phénix Millénaire', description: 'Il a brûlé sept fois devant vous. Il recommencera.', emoji: '🕊️', level: 20, health: 969, attack: 80, defense: 25, speed: 30, xpReward: 480, coinReward: 380, drops: [{ itemName: 'Cendre de Phénix', emoji: '🔥', chance: 0.5 }, { itemName: 'Plume de Harpie', emoji: '🪶', chance: 0.95 }], isBoss: true, bossRespawnHours: 5 },
  { name: 'Tisseuse de Destins', description: 'Elle tenait votre fil. Elle vient de le reposer.', emoji: '🕸️', level: 27, health: 1256, attack: 134, defense: 39, speed: 22, xpReward: 700, coinReward: 520, drops: [{ itemName: 'Fil de Parque', emoji: '🧵', chance: 0.4 }, { itemName: "Soie d'Araignée", emoji: '🕸️', chance: 1 }], isBoss: true, bossRespawnHours: 8 },
  { name: 'Ce Qui Vient du Nord', description: 'Ni nom, ni forme fixe. Le terme de la campagne.', emoji: '❄️', level: 30, health: 1454, attack: 159, defense: 44, speed: 24, xpReward: 1000, coinReward: 750, drops: [{ itemName: 'Gemme du Vide', emoji: '🔷', chance: 0.3 }, { itemName: 'Couronne Fondue', emoji: '👑', chance: 0.3 }, { itemName: 'Cœur de Givre', emoji: '🧊', chance: 0.8 }], isBoss: true, bossRespawnHours: 12 },
];

// ════════════════════════════════════════════════════════════════════════════
// ÉVÉNEMENTS D'AVENTURE
// ════════════════════════════════════════════════════════════════════════════

export const RPG_ADVENTURE_EVENTS: SeedAdventureEvent[] = [
  {
    title: 'Le Gobelin Malicieux',
    description: 'Un petit gobelin ricane sur le bord de la route et essaie de voler votre sac !',
    emoji: '👹',
    choices: [
      { text: "L'attraper par le col (Force)", hpEffect: -15, coinEffect: 40, xpEffect: 30, minLevel: 1 },
      { text: 'Négocier pacifiquement', hpEffect: 0, coinEffect: -20, xpEffect: 15, minLevel: 1 },
      { text: "L'ignorer et continuer", hpEffect: 0, coinEffect: 0, xpEffect: 5, minLevel: 1 },
    ],
  },
  {
    title: 'Le Sphinx Gardien',
    description: 'Un sphinx majestueux vous bloque le passage et vous soumet une énigme difficile.',
    emoji: '🦁',
    choices: [
      { text: "Tenter de résoudre l'énigme", hpEffect: -25, coinEffect: 120, xpEffect: 60, minLevel: 2 },
      { text: 'Fuir lâchement', hpEffect: 0, coinEffect: 0, xpEffect: 5, minLevel: 1 },
    ],
  },
  {
    title: 'La Source de Vie',
    description: "Vous découvrez une magnifique source d'eau chaude thermale cachée dans les bois.",
    emoji: '♨️',
    choices: [
      { text: 'Prendre un bain chaud relaxant', hpEffect: 40, coinEffect: 0, xpEffect: 10, minLevel: 1 },
      { text: "Remplir une fiole d'eau", hpEffect: 0, coinEffect: 15, xpEffect: 15, minLevel: 1 },
    ],
  },
  {
    title: 'Le Coffre Trésor',
    description: "Un coffre en bois renforcé de fer repose au pied d'un arbre séculaire.",
    emoji: '🪙',
    choices: [
      { text: 'Forcer la serrure rouillée', hpEffect: -10, coinEffect: 80, xpEffect: 20, minLevel: 1 },
      { text: 'Utiliser un sortilège simple', hpEffect: 0, coinEffect: 50, xpEffect: 35, minLevel: 1 },
    ],
  },
  {
    title: 'Le Marchand Ambulant',
    description: 'Une roulotte bariolée est arrêtée au bord du chemin. Le marchand vous fait signe.',
    emoji: '🛒',
    choices: [
      { text: 'Acheter sa fiole « miracle »', hpEffect: 55, coinEffect: -70, xpEffect: 10, minLevel: 1 },
      { text: 'Lui vendre votre butin en trop', hpEffect: 0, coinEffect: 90, xpEffect: 15, minLevel: 3 },
      { text: 'Passer votre chemin', hpEffect: 0, coinEffect: 0, xpEffect: 5, minLevel: 1 },
    ],
  },
  {
    title: 'Le Pont Effondré',
    description: 'Le seul pont de la vallée s’est écroulé. La rivière gronde en contrebas.',
    emoji: '🌉',
    choices: [
      { text: 'Sauter de rocher en rocher', hpEffect: -30, coinEffect: 0, xpEffect: 55, minLevel: 4 },
      { text: 'Faire le grand détour', hpEffect: -5, coinEffect: 0, xpEffect: 20, minLevel: 1 },
    ],
  },
  {
    title: 'Le Champ de Bataille',
    description: 'Des centaines d’armes rouillées jonchent le sol. La bataille date de plusieurs siècles.',
    emoji: '⚰️',
    choices: [
      { text: 'Fouiller les cadavres', hpEffect: -20, coinEffect: 140, xpEffect: 40, minLevel: 5 },
      { text: 'Rendre hommage aux morts', hpEffect: 15, coinEffect: 0, xpEffect: 45, minLevel: 1 },
    ],
  },
  {
    title: 'L’Autel Oublié',
    description: 'Un autel de pierre couvert de mousse trône dans une clairière silencieuse.',
    emoji: '⛩️',
    choices: [
      { text: 'Y déposer une offrande', hpEffect: 0, coinEffect: -100, xpEffect: 120, minLevel: 6 },
      { text: 'Voler les offrandes des autres', hpEffect: -45, coinEffect: 200, xpEffect: 25, minLevel: 8 },
      { text: 'Prier respectueusement', hpEffect: 30, coinEffect: 0, xpEffect: 25, minLevel: 1 },
    ],
  },
  {
    title: 'La Caravane Attaquée',
    description: 'Des marchands se font dépouiller par trois bandits. Ils ne vous ont pas encore vu.',
    emoji: '🐫',
    choices: [
      { text: 'Charger les bandits', hpEffect: -50, coinEffect: 180, xpEffect: 100, minLevel: 7 },
      { text: 'Attendre et récupérer les restes', hpEffect: 0, coinEffect: 60, xpEffect: 20, minLevel: 1 },
    ],
  },
  {
    title: 'Le Puits sans Fond',
    description: 'Une pièce jetée dans ce puits ne fait jamais de bruit en touchant le fond.',
    emoji: '🕳️',
    choices: [
      { text: 'Y descendre à la corde', hpEffect: -60, coinEffect: 320, xpEffect: 150, minLevel: 10 },
      { text: 'Y jeter une pièce et faire un vœu', hpEffect: 20, coinEffect: -10, xpEffect: 30, minLevel: 1 },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════════════
// RECETTES D'ARTISANAT - ce qui donne enfin une utilité aux butins
// ════════════════════════════════════════════════════════════════════════════

export const RPG_RECIPES: SeedRecipe[] = [
  { resultItemName: 'Collier de croc', levelRequired: 4, coinCost: 120, ingredients: [{ itemName: 'Dent de Gobelin', quantity: 3 }, { itemName: 'Fourrure de Loup', quantity: 1 }] },
  { resultItemName: 'Épée courte', levelRequired: 5, coinCost: 200, ingredients: [{ itemName: 'Dent de Gobelin', quantity: 4 }, { itemName: 'Défense de Sanglier', quantity: 2 }] },
  { resultItemName: 'Armure de cuir clouté', levelRequired: 5, coinCost: 240, ingredients: [{ itemName: 'Fourrure de Loup', quantity: 4 }, { itemName: 'Gelée de Slime', quantity: 3 }] },
  { resultItemName: 'Hache de guerre', levelRequired: 9, coinCost: 600, ingredients: [{ itemName: 'Os Enchanté', quantity: 4 }, { itemName: 'Mousse de Troll', quantity: 3 }, { itemName: 'Défense de Sanglier', quantity: 2 }] },
  { resultItemName: "Cape d'ombre", levelRequired: 10, coinCost: 700, ingredients: [{ itemName: "Soie d'Araignée", quantity: 5 }, { itemName: 'Aile de Chauve-souris', quantity: 4 }] },
  { resultItemName: "Harnois d'acier", levelRequired: 11, coinCost: 900, ingredients: [{ itemName: 'Fragment d’Armure Maudite', quantity: 3 }, { itemName: 'Éclat de Granite', quantity: 4 }] },
  { resultItemName: 'Sceptre de givre', levelRequired: 12, coinCost: 1200, ingredients: [{ itemName: 'Cœur de Givre', quantity: 1 }, { itemName: 'Phylactère Brisé', quantity: 2 }, { itemName: 'Ectoplasme', quantity: 3 }] },
  { resultItemName: 'Anneau de rubis', levelRequired: 18, coinCost: 1500, ingredients: [{ itemName: 'Corne Démoniaque', quantity: 2 }, { itemName: 'Œil de Basilic', quantity: 3 }] },
  { resultItemName: 'Cœur de pierre', levelRequired: 18, coinCost: 1700, ingredients: [{ itemName: 'Éclat de Granite', quantity: 6 }, { itemName: "Cœur d'Obsidienne", quantity: 1 }] },
  { resultItemName: 'Bottes ailées', levelRequired: 19, coinCost: 1600, ingredients: [{ itemName: 'Plume de Harpie', quantity: 5 }, { itemName: 'Aiguillon de Wyverne', quantity: 2 }] },
  { resultItemName: 'Arc du Crépuscule', levelRequired: 18, coinCost: 1800, ingredients: [{ itemName: 'Aiguillon de Wyverne', quantity: 3 }, { itemName: 'Plume de Harpie', quantity: 3 }, { itemName: 'Ectoplasme', quantity: 2 }] },
  { resultItemName: "Lame d'Obsidienne", levelRequired: 18, coinCost: 2000, ingredients: [{ itemName: "Cœur d'Obsidienne", quantity: 2 }, { itemName: 'Écaille de Dragon', quantity: 2 }, { itemName: 'Braise Éternelle', quantity: 3 }] },
  { resultItemName: "Armure d'Orichalque", levelRequired: 18, coinCost: 2200, ingredients: [{ itemName: 'Écaille de Dragon', quantity: 4 }, { itemName: 'Corne de Minotaure', quantity: 2 }] },
  { resultItemName: 'Manteau du Rôdeur', levelRequired: 18, coinCost: 2100, ingredients: [{ itemName: "Soie d'Araignée", quantity: 6 }, { itemName: 'Plume de Harpie', quantity: 3 }, { itemName: 'Ectoplasme', quantity: 2 }] },
  { resultItemName: 'Bâton du Cataclysme', levelRequired: 20, coinCost: 2400, ingredients: [{ itemName: 'Braise Éternelle', quantity: 4 }, { itemName: 'Grimoire Maudit', quantity: 2 }, { itemName: 'Phylactère Brisé', quantity: 2 }] },
  { resultItemName: 'Sceau du Dragon', levelRequired: 22, coinCost: 3000, ingredients: [{ itemName: 'Cœur de Dragon', quantity: 1 }, { itemName: 'Écaille de Dragon', quantity: 3 }] },
  { resultItemName: 'Arc Céleste', levelRequired: 25, coinCost: 5500, ingredients: [{ itemName: 'Plume de Harpie', quantity: 6 }, { itemName: 'Cœur de Dragon', quantity: 2 }, { itemName: 'Aiguillon de Wyverne', quantity: 4 }] },
  { resultItemName: 'Excalibur', levelRequired: 25, coinCost: 6000, ingredients: [{ itemName: 'Cœur de Dragon', quantity: 2 }, { itemName: 'Couronne du Roi Gobelin', quantity: 1 }, { itemName: 'Crinière de Chimère', quantity: 2 }] },
  { resultItemName: 'Égide des Titans', levelRequired: 25, coinCost: 6500, ingredients: [{ itemName: 'Cœur de Dragon', quantity: 2 }, { itemName: 'Cœur de Givre', quantity: 3 }, { itemName: "Cœur d'Obsidienne", quantity: 2 }] },
  { resultItemName: 'Voile du Néant', levelRequired: 26, coinCost: 7000, ingredients: [{ itemName: 'Orbe des Ombres', quantity: 2 }, { itemName: "Croc d'Hydre", quantity: 3 }, { itemName: 'Ectoplasme', quantity: 5 }] },
  { resultItemName: 'Faux des Âmes', levelRequired: 27, coinCost: 7500, ingredients: [{ itemName: 'Orbe des Ombres', quantity: 2 }, { itemName: 'Grimoire Maudit', quantity: 3 }, { itemName: 'Crinière de Chimère', quantity: 2 }] },

  // ── Parchemins d'enchantement ──
  // Les paliers supérieurs coûtent des matériaux nettement plus rares : c'est ce qui étale
  // l'enchantement sur toute la progression au lieu d'en faire une case à cocher au niveau 5.
  { resultItemName: 'Parchemin de Célérité I', levelRequired: 6, coinCost: 200, ingredients: [{ itemName: 'Aile de Chauve-souris', quantity: 3 }, { itemName: 'Queue de Rat', quantity: 2 }] },
  { resultItemName: 'Parchemin d’Embrasement I', levelRequired: 8, coinCost: 350, ingredients: [{ itemName: 'Os Enchanté', quantity: 2 }, { itemName: 'Dent de Gobelin', quantity: 3 }] },
  { resultItemName: 'Parchemin de Tranchant I', levelRequired: 8, coinCost: 350, ingredients: [{ itemName: 'Défense de Sanglier', quantity: 3 }, { itemName: "Soie d'Araignée", quantity: 2 }] },
  { resultItemName: 'Parchemin de Rempart I', levelRequired: 8, coinCost: 350, ingredients: [{ itemName: 'Mousse de Troll', quantity: 3 }, { itemName: 'Fourrure de Loup', quantity: 3 }] },
  { resultItemName: 'Parchemin de Vitalité I', levelRequired: 8, coinCost: 350, ingredients: [{ itemName: 'Gelée de Slime', quantity: 4 }, { itemName: 'Mousse de Troll', quantity: 2 }] },
  { resultItemName: 'Parchemin de Célérité II', levelRequired: 12, coinCost: 500, ingredients: [{ itemName: 'Plume de Harpie', quantity: 3 }, { itemName: 'Aile de Chauve-souris', quantity: 4 }] },
  { resultItemName: 'Parchemin de Brise-Armure', levelRequired: 14, coinCost: 700, ingredients: [{ itemName: 'Éclat de Granite', quantity: 3 }, { itemName: 'Fragment d’Armure Maudite', quantity: 2 }] },
  { resultItemName: 'Parchemin d’Épines', levelRequired: 14, coinCost: 700, ingredients: [{ itemName: 'Aiguillon de Wyverne', quantity: 2 }, { itemName: 'Éclat de Granite', quantity: 3 }] },
  { resultItemName: 'Parchemin d’Embrasement II', levelRequired: 16, coinCost: 800, ingredients: [{ itemName: 'Braise Éternelle', quantity: 3 }, { itemName: 'Corne Démoniaque', quantity: 1 }] },
  { resultItemName: 'Parchemin de Tranchant II', levelRequired: 16, coinCost: 800, ingredients: [{ itemName: 'Œil de Basilic', quantity: 2 }, { itemName: 'Corne de Minotaure', quantity: 2 }] },
  { resultItemName: 'Parchemin de Rempart II', levelRequired: 16, coinCost: 800, ingredients: [{ itemName: "Cœur d'Obsidienne", quantity: 1 }, { itemName: 'Écaille de Dragon', quantity: 2 }] },
  { resultItemName: 'Parchemin de Vitalité II', levelRequired: 16, coinCost: 800, ingredients: [{ itemName: 'Corne de Minotaure', quantity: 2 }, { itemName: 'Mousse de Troll', quantity: 5 }] },
  { resultItemName: 'Parchemin de Vampirisme', levelRequired: 20, coinCost: 1500, ingredients: [{ itemName: "Croc d'Hydre", quantity: 1 }, { itemName: 'Phylactère Brisé', quantity: 2 }, { itemName: 'Ectoplasme', quantity: 4 }] },
  { resultItemName: 'Parchemin de Sauvegarde', levelRequired: 20, coinCost: 1500, ingredients: [{ itemName: 'Cœur de Givre', quantity: 1 }, { itemName: 'Grimoire Maudit', quantity: 2 }, { itemName: 'Écaille de Dragon', quantity: 3 }] },
  { resultItemName: 'Parchemin d’Embrasement III', levelRequired: 24, coinCost: 2500, ingredients: [{ itemName: 'Cœur de Dragon', quantity: 1 }, { itemName: 'Braise Éternelle', quantity: 5 }, { itemName: 'Corne Démoniaque', quantity: 2 }] },
];
