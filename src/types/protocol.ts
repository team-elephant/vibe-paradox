// types/protocol.ts — WebSocket JSON protocol

import type { EntityId, Position, Tick } from './core.js';
import type { AgentRole, AgentSelfView, AgentPublicView } from './agent.js';
import type { ActionType } from './action.js';
import type { WorldEvent } from './world.js';
import type { ChatMessageView } from './message.js';

// === Client → Server ===

export type ClientMessage =
  | { type: 'auth'; name: string; token?: string }
  | { type: 'select_role'; role: AgentRole }
  | { type: 'action'; action: ActionType; params: Record<string, unknown>; tick: Tick }
  | { type: 'ping' };

// === Server → Client ===

export type ServerMessage =
  | { type: 'auth_prompt' }
  | { type: 'auth_success'; agentId: EntityId }
  | { type: 'auth_error'; reason: string }
  | { type: 'role_prompt'; availableRoles: AgentRole[] }
  | { type: 'role_confirmed'; role: AgentRole; agentId: EntityId; spawnPosition: Position }
  | { type: 'tick_update'; data: TickUpdateData }
  | { type: 'action_rejected'; action: ActionType; reason: string }
  | { type: 'event'; event: WorldEvent }
  | { type: 'pong'; serverTick: Tick };

export interface TickUpdateData {
  tick: Tick;
  self: AgentSelfView;
  nearby: {
    agents: AgentPublicView[];
    resources: ResourceView[];
    monsters: MonsterView[];
    behemoths: BehemothView[];
    structures: StructureView[];
  };
  messages: ChatMessageView[];
  events: WorldEvent[];
}

export interface ResourceView {
  id: EntityId;
  type: 'tree' | 'gold_vein' | 'sapling';
  position: Position;
  remaining: number;
  state: string;
}

export interface MonsterView {
  id: EntityId;
  position: Position;
  type: string;
  health: number;
  maxHealth: number;
  evolutionStage: number;
  isNpc: boolean;
  status: string;
}

export interface BehemothView {
  id: EntityId;
  position: Position;
  type: string;
  status: 'roaming' | 'unconscious' | 'waking';
  oreAvailable: boolean;
  health: number;
  maxHealth: number;
  unconsciousTicksRemaining: number;
}

export interface StructureView {
  id: EntityId;
  type: string;
  position: Position;
  owner: EntityId;
  alliance: string | null;
}
