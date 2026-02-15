// types/world.ts — World events, state changes, spawns

import type { EntityId, Position, Tick } from './core.js';
import type { CombatStats } from './agent.js';
import type { TradeItem } from './action.js';

export type WorldEvent =
  | { type: 'combat_hit'; attackerId: EntityId; targetId: EntityId; damage: number; targetHealthAfter: number }
  | { type: 'death'; entityId: EntityId; killedBy: EntityId | null; droppedGold: number; droppedItems: string[] }
  | { type: 'respawn'; agentId: EntityId; position: Position }
  | { type: 'evolution'; monsterId: EntityId; fromStage: number; toStage: number }
  | { type: 'resource_depleted'; resourceId: EntityId; position: Position }
  | { type: 'resource_gathered'; agentId: EntityId; resourceId: EntityId; item: string; quantity: number }
  | { type: 'tree_planted'; agentId: EntityId; position: Position }
  | { type: 'tree_grown'; position: Position }
  | { type: 'behemoth_knockout'; behemothId: EntityId; attackers: EntityId[] }
  | { type: 'behemoth_wake'; behemothId: EntityId; thrownOff: EntityId[] }
  | { type: 'trade_proposed'; tradeId: string; buyer: EntityId; seller: EntityId; offered: TradeItem[]; requested: TradeItem[] }
  | { type: 'trade_complete'; buyer: EntityId; seller: EntityId; offered: TradeItem[]; received: TradeItem[] }
  | { type: 'craft_complete'; agentId: EntityId; recipeId: string; item: string }
  | { type: 'alliance_formed'; name: string; founder: EntityId }
  | { type: 'alliance_joined'; name: string; agentId: EntityId }
  | { type: 'npc_spawn'; monsterId: EntityId; position: Position; template: string }
  | { type: 'monster_eat'; eaterId: EntityId; eatenId: EntityId; statsGained: Partial<CombatStats> };

export interface StateChange {
  entityId: EntityId;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface SpawnEvent {
  entityType: 'npc_monster' | 'tree';
  entityId: EntityId;
  position: Position;
  template?: string;
}
