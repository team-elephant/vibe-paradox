// types/economy.ts — Crafting recipes, trade offers

import type { TradeItem } from './action.js';
import type { EntityId } from './core.js';

export interface CraftRecipeIngredient {
  itemId: string;
  qty: number;
}

export interface CraftRecipeOutput {
  itemId: string;
  qty: number;
}

export interface CraftRecipeStats {
  attack?: number;
  defense?: number;
  gatherSpeedBonus?: number;
  mineSpeedBonus?: number;
  healAmount?: number;
}

export interface CraftRecipe {
  id: string;
  name: string;
  ingredients: CraftRecipeIngredient[];
  craftTicks: number;
  output: CraftRecipeOutput;
  stats?: CraftRecipeStats;
}

export interface TradeOffer {
  tradeId: string;
  fromAgentId: EntityId;
  toAgentId: EntityId;
  offer: TradeItem[];
  request: TradeItem[];
  expiresAtTick: number;
}
