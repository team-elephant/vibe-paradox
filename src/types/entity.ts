// types/entity.ts — Resources, NPCs, behemoths, structures, alliances, trades, crafting

import type { EntityId, Position, Tick } from './core.js';
import type { TradeItem } from './action.js';

export type ResourceType = 'tree' | 'gold_vein' | 'sapling';
export type ResourceState = 'available' | 'being_gathered' | 'depleted' | 'growing';

export interface Resource {
  id: EntityId;
  type: ResourceType;
  position: Position;
  remaining: number;
  maxCapacity: number;
  state: ResourceState;
  growthStartTick: Tick | null;
  growthCompleteTick: Tick | null;
  createdAt: Tick;
}

export type NpcBehavior = 'patrol' | 'chase' | 'attack' | 'flee' | 'idle';

export interface NpcMonster {
  id: EntityId;
  template: string;
  position: Position;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  status: string;
  behavior: NpcBehavior;
  patrolOrigin: Position;
  patrolRadius: number;
  targetId: EntityId | null;
  goldDrop: number;
  createdAt: Tick;
}

export type BehemothStatus = 'roaming' | 'unconscious' | 'waking';

export interface Behemoth {
  id: EntityId;
  type: string;
  position: Position;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  status: BehemothStatus;
  oreAmount: number;
  oreMax: number;
  fedAmount: number;
  unconsciousUntilTick: Tick | null;
  route: Position[];
  currentWaypoint: number;
}

export interface Structure {
  id: EntityId;
  type: string;
  position: Position;
  owner: EntityId;
  alliance: string | null;
  createdAt: Tick;
}

export interface Alliance {
  name: string;
  founder: EntityId;
  members: Set<EntityId>;
  createdAt: Tick;
}

export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface Trade {
  id: EntityId;
  tick: Tick;
  buyerId: EntityId;
  sellerId: EntityId;
  offered: TradeItem[];
  requested: TradeItem[];
  status: TradeStatus;
  createdAt: Tick;
  resolvedAt: Tick | null;
}

export interface CraftingJob {
  id: string;
  agentId: EntityId;
  recipeId: string;
  startTick: Tick;
  completeTick: Tick;
  status: 'in_progress' | 'completed';
}
