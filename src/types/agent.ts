// types/agent.ts — Agent, roles, stats, views

import type { EntityId, Position, Tick } from './core.js';

export type AgentRole = 'merchant' | 'fighter' | 'monster';

export type AgentStatus =
  | 'idle'
  | 'moving'
  | 'gathering'
  | 'crafting'
  | 'fighting'
  | 'dead'
  | 'climbing'
  | 'trading';

export interface CombatStats {
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  visionRadius: number;
}

export interface InventoryItem {
  id: string;
  quantity: number;
  metadata?: Record<string, unknown>;
}

export interface Equipment {
  weapon: string | null;
  armor: string | null;
  tool: string | null;
}

export interface Agent {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  destination: Position | null;
  status: AgentStatus;
  stats: CombatStats;
  gold: number;
  inventory: InventoryItem[];
  equipment: Equipment;
  alliance: string | null;

  // Monster-specific
  kills: number;
  monsterEats: number;
  evolutionStage: number;

  // Timing
  actionCooldown: Tick;
  respawnTick: Tick | null;
  connectedAt: Tick;
  lastActionTick: Tick;

  // Persistence flags
  isAlive: boolean;
  isConnected: boolean;
}

export interface AgentSelfView {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  status: AgentStatus;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  gold: number;
  inventory: InventoryItem[];
  equipment: Equipment;
  alliance: string | null;
  kills: number;
  evolutionStage: number;
  actionCooldown: number;
}

export interface AgentPublicView {
  id: EntityId;
  name: string;
  role: AgentRole;
  position: Position;
  status: AgentStatus;
  health: number;
  maxHealth: number;
  alliance: string | null;
  evolutionStage: number;
}
