// pipeline/economy-processor.ts — Trade resolution, crafting queue processing
// Returns result objects. Does NOT mutate WorldState directly.

import type {
  Tick,
  InventoryItem,
  EntityId,
  WorldEvent,
  Trade,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import { TRADE_EXPIRE_TICKS, TRADE_RANGE } from '../shared/constants.js';
import { getRecipe } from '../data/recipes.js';
import type { TradeItem } from '../types/action.js';

// --- Result types returned to executor/tick-loop for application ---

export interface TradeExpiryResult {
  tradeId: string;
  status: 'expired';
  resolvedAt: Tick;
}

export interface CraftCompletionResult {
  jobId: string;
  agentId: EntityId;
  recipeId: string;
  outputItemId: string;
  outputQty: number;
  event: WorldEvent;
}

export interface TradeResolveAcceptResult {
  accepted: true;
  tradeId: string;
  buyerId: EntityId;
  sellerId: EntityId;
  offered: TradeItem[];
  requested: TradeItem[];
  resolvedAt: Tick;
  event: WorldEvent;
}

export interface TradeResolveRejectResult {
  accepted: false;
  tradeId: string;
  resolvedAt: Tick;
}

export type TradeResolveResult =
  | TradeResolveAcceptResult
  | TradeResolveRejectResult
  | null; // null = failed (out of range, missing items/agents)

export interface ProcessTradesResult {
  expired: TradeExpiryResult[];
}

export interface ProcessCraftingResult {
  completed: CraftCompletionResult[];
  removedJobIds: string[];
}

export class EconomyProcessor {
  /**
   * Identify expired trades. Returns list of trade IDs to expire.
   * Does NOT mutate WorldState.
   */
  processTrades(world: WorldState, tick: Tick): ProcessTradesResult {
    const expired: TradeExpiryResult[] = [];

    for (const [tradeId, trade] of world.pendingTrades) {
      if (trade.status !== 'pending') continue;

      if (tick - trade.createdAt >= TRADE_EXPIRE_TICKS) {
        expired.push({ tradeId, status: 'expired', resolvedAt: tick });
      }
    }

    return { expired };
  }

  /**
   * Identify completed crafting jobs. Returns list of completions to apply.
   * Does NOT mutate WorldState.
   */
  processCrafting(world: WorldState, tick: Tick): ProcessCraftingResult {
    const completed: CraftCompletionResult[] = [];
    const removedJobIds: string[] = [];

    for (const [jobId, job] of world.craftingQueue) {
      if (job.status !== 'in_progress') continue;

      if (tick >= job.completeTick) {
        const agent = world.agents.get(job.agentId);
        if (!agent) {
          removedJobIds.push(jobId);
          continue;
        }

        const recipe = getRecipe(job.recipeId);
        if (!recipe) {
          removedJobIds.push(jobId);
          continue;
        }

        completed.push({
          jobId,
          agentId: job.agentId,
          recipeId: job.recipeId,
          outputItemId: recipe.output.itemId,
          outputQty: recipe.output.qty,
          event: {
            type: 'craft_complete',
            agentId: agent.id,
            recipeId: job.recipeId,
            item: recipe.output.itemId,
          },
        });

        removedJobIds.push(jobId);
      }
    }

    return { completed, removedJobIds };
  }

  /**
   * Evaluate a trade response (accept/reject). Returns a result object
   * describing what should happen. Does NOT mutate WorldState.
   */
  resolveTrade(tradeId: string, accept: boolean, world: WorldState, tick: Tick): TradeResolveResult {
    const trade = world.pendingTrades.get(tradeId);
    if (!trade || trade.status !== 'pending') return null;

    if (!accept) {
      return {
        accepted: false,
        tradeId,
        resolvedAt: tick,
      };
    }

    // Validate both agents still exist and are in range
    const buyer = world.agents.get(trade.buyerId);
    const seller = world.agents.get(trade.sellerId);
    if (!buyer || !seller) return null;
    if (distance(buyer.position, seller.position) > TRADE_RANGE) return null;

    // Verify buyer still has offered items/gold
    for (const item of trade.offered) {
      if (item.itemId === 'gold') {
        if (buyer.gold < item.quantity) return null;
      } else {
        if (!hasItem(buyer.inventory, item.itemId, item.quantity)) return null;
      }
    }

    // Verify seller still has requested items/gold
    for (const item of trade.requested) {
      if (item.itemId === 'gold') {
        if (seller.gold < item.quantity) return null;
      } else {
        if (!hasItem(seller.inventory, item.itemId, item.quantity)) return null;
      }
    }

    return {
      accepted: true,
      tradeId,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      offered: trade.offered,
      requested: trade.requested,
      resolvedAt: tick,
      event: {
        type: 'trade_complete',
        buyer: trade.buyerId,
        seller: trade.sellerId,
        offered: trade.offered,
        received: trade.requested,
      },
    };
  }
}

// --- Inventory helpers ---

function hasItem(inventory: InventoryItem[], itemId: string, quantity: number): boolean {
  const item = inventory.find((i) => i.id === itemId);
  return item !== undefined && item.quantity >= quantity;
}

export function addItemToInventory(inventory: InventoryItem[], itemId: string, quantity: number): void {
  const existing = inventory.find((i) => i.id === itemId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    inventory.push({ id: itemId, quantity });
  }
}

export function removeItemFromInventory(inventory: InventoryItem[], itemId: string, quantity: number): boolean {
  const idx = inventory.findIndex((i) => i.id === itemId);
  if (idx === -1) return false;
  const item = inventory[idx]!;
  if (item.quantity < quantity) return false;
  item.quantity -= quantity;
  if (item.quantity <= 0) {
    inventory.splice(idx, 1);
  }
  return true;
}
