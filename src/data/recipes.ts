// data/recipes.ts — All crafting recipes from ARCHITECTURE.md Section 17

import type { CraftRecipe } from '../types/index.js';

export const RECIPES: CraftRecipe[] = [
  // Weapons (sold to fighters)
  {
    id: 'iron_sword',
    name: 'Iron Sword',
    ingredients: [{ itemId: 'iron_ore', qty: 3 }, { itemId: 'log', qty: 1 }],
    craftTicks: 10,
    output: { itemId: 'iron_sword', qty: 1 },
    stats: { attack: 5 },
  },
  {
    id: 'iron_armor',
    name: 'Iron Armor',
    ingredients: [{ itemId: 'iron_ore', qty: 5 }],
    craftTicks: 15,
    output: { itemId: 'iron_armor', qty: 1 },
    stats: { defense: 5 },
  },
  {
    id: 'copper_sword',
    name: 'Copper Sword',
    ingredients: [{ itemId: 'copper_ore', qty: 3 }, { itemId: 'log', qty: 1 }],
    craftTicks: 10,
    output: { itemId: 'copper_sword', qty: 1 },
    stats: { attack: 3 },
  },
  {
    id: 'silver_blade',
    name: 'Silver Blade',
    ingredients: [{ itemId: 'silver_ore', qty: 5 }, { itemId: 'log', qty: 2 }],
    craftTicks: 20,
    output: { itemId: 'silver_blade', qty: 1 },
    stats: { attack: 10 },
  },
  {
    id: 'mithril_sword',
    name: 'Mithril Sword',
    ingredients: [{ itemId: 'mithril_ore', qty: 5 }, { itemId: 'log', qty: 2 }],
    craftTicks: 30,
    output: { itemId: 'mithril_sword', qty: 1 },
    stats: { attack: 15 },
  },
  {
    id: 'obsidian_blade',
    name: 'Obsidian Blade',
    ingredients: [{ itemId: 'obsidian_ore', qty: 8 }, { itemId: 'log', qty: 3 }],
    craftTicks: 40,
    output: { itemId: 'obsidian_blade', qty: 1 },
    stats: { attack: 25 },
  },

  // Tools (improve gathering)
  {
    id: 'iron_axe',
    name: 'Iron Axe',
    ingredients: [{ itemId: 'iron_ore', qty: 2 }, { itemId: 'log', qty: 2 }],
    craftTicks: 8,
    output: { itemId: 'iron_axe', qty: 1 },
    stats: { gatherSpeedBonus: 1.5 },
  },
  {
    id: 'iron_pickaxe',
    name: 'Iron Pickaxe',
    ingredients: [{ itemId: 'iron_ore', qty: 3 }, { itemId: 'log', qty: 1 }],
    craftTicks: 8,
    output: { itemId: 'iron_pickaxe', qty: 1 },
    stats: { mineSpeedBonus: 1.5 },
  },

  // Healing
  {
    id: 'healing_salve',
    name: 'Healing Salve',
    ingredients: [{ itemId: 'log', qty: 2 }],
    craftTicks: 5,
    output: { itemId: 'healing_salve', qty: 3 },
    stats: { healAmount: 25 },
  },

  // Seeds (renewable forestry)
  {
    id: 'seed_bundle',
    name: 'Seed Bundle',
    ingredients: [{ itemId: 'log', qty: 5 }],
    craftTicks: 5,
    output: { itemId: 'tree_seed', qty: 3 },
  },

  // Building materials
  {
    id: 'wooden_wall',
    name: 'Wooden Wall',
    ingredients: [{ itemId: 'log', qty: 10 }],
    craftTicks: 20,
    output: { itemId: 'wooden_wall', qty: 1 },
  },
  {
    id: 'stone_wall',
    name: 'Stone Wall',
    ingredients: [{ itemId: 'iron_ore', qty: 5 }, { itemId: 'log', qty: 5 }],
    craftTicks: 30,
    output: { itemId: 'stone_wall', qty: 1 },
  },
];

const RECIPE_MAP = new Map<string, CraftRecipe>();
for (const recipe of RECIPES) {
  RECIPE_MAP.set(recipe.id, recipe);
}

export function getRecipe(id: string): CraftRecipe | undefined {
  return RECIPE_MAP.get(id);
}
