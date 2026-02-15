// data/items.ts — Item definitions (weapons, armor, tools, materials, healing items)

export interface ItemDefinition {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'tool' | 'material' | 'consumable' | 'building' | 'seed';
  stackable: boolean;
  stats?: {
    attack?: number;
    defense?: number;
    gatherSpeedBonus?: number;
    mineSpeedBonus?: number;
    healAmount?: number;
  };
}

export const ITEMS: Map<string, ItemDefinition> = new Map();

// --- Materials ---
const materials: ItemDefinition[] = [
  { id: 'log', name: 'Log', type: 'material', stackable: true },
  { id: 'iron_ore', name: 'Iron Ore', type: 'material', stackable: true },
  { id: 'copper_ore', name: 'Copper Ore', type: 'material', stackable: true },
  { id: 'silver_ore', name: 'Silver Ore', type: 'material', stackable: true },
  { id: 'mithril_ore', name: 'Mithril Ore', type: 'material', stackable: true },
  { id: 'obsidian_ore', name: 'Obsidian Ore', type: 'material', stackable: true },
];

// --- Weapons ---
const weapons: ItemDefinition[] = [
  { id: 'iron_sword', name: 'Iron Sword', type: 'weapon', stackable: false, stats: { attack: 5 } },
  { id: 'copper_sword', name: 'Copper Sword', type: 'weapon', stackable: false, stats: { attack: 3 } },
  { id: 'silver_blade', name: 'Silver Blade', type: 'weapon', stackable: false, stats: { attack: 10 } },
  { id: 'mithril_sword', name: 'Mithril Sword', type: 'weapon', stackable: false, stats: { attack: 15 } },
  { id: 'obsidian_blade', name: 'Obsidian Blade', type: 'weapon', stackable: false, stats: { attack: 25 } },
];

// --- Armor ---
const armor: ItemDefinition[] = [
  { id: 'iron_armor', name: 'Iron Armor', type: 'armor', stackable: false, stats: { defense: 5 } },
];

// --- Tools ---
const tools: ItemDefinition[] = [
  { id: 'iron_axe', name: 'Iron Axe', type: 'tool', stackable: false, stats: { gatherSpeedBonus: 1.5 } },
  { id: 'iron_pickaxe', name: 'Iron Pickaxe', type: 'tool', stackable: false, stats: { mineSpeedBonus: 1.5 } },
];

// --- Consumables ---
const consumables: ItemDefinition[] = [
  { id: 'healing_salve', name: 'Healing Salve', type: 'consumable', stackable: true, stats: { healAmount: 25 } },
];

// --- Seeds ---
const seeds: ItemDefinition[] = [
  { id: 'tree_seed', name: 'Tree Seed', type: 'seed', stackable: true },
];

// --- Building materials ---
const building: ItemDefinition[] = [
  { id: 'wooden_wall', name: 'Wooden Wall', type: 'building', stackable: true },
  { id: 'stone_wall', name: 'Stone Wall', type: 'building', stackable: true },
];

// Register all items
for (const list of [materials, weapons, armor, tools, consumables, seeds, building]) {
  for (const item of list) {
    ITEMS.set(item.id, item);
  }
}

export function getItem(id: string): ItemDefinition | undefined {
  return ITEMS.get(id);
}
