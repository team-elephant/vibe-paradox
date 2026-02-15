// types/action.ts — Actions, validation results

import type { EntityId, Tick } from './core.js';

export type ActionType =
  | 'move'
  | 'gather'
  | 'craft'
  | 'attack'
  | 'talk'
  | 'inspect'
  | 'trade'
  | 'plant'
  | 'water'
  | 'feed'
  | 'climb'
  | 'form_alliance'
  | 'join_alliance'
  | 'leave_alliance'
  | 'idle';

export interface RawAction {
  action: ActionType;
  params: Record<string, unknown>;
  tick: Tick;
}

export interface AgentAction {
  agentId: EntityId;
  action: ActionType;
  params: ActionParams;
  receivedTick: Tick;
  serverTick: Tick;
}

export type ActionParams =
  | { type: 'move'; x: number; y: number }
  | { type: 'gather'; targetId: EntityId }
  | { type: 'craft'; recipeId: string }
  | { type: 'attack'; targetId: EntityId }
  | { type: 'talk'; mode: 'whisper' | 'local' | 'broadcast'; message: string; targetId?: EntityId }
  | { type: 'inspect'; targetId: EntityId }
  | { type: 'trade'; targetAgentId: EntityId; offer: TradeItem[]; request: TradeItem[] }
  | { type: 'plant'; seedId: string; x: number; y: number }
  | { type: 'water'; x: number; y: number }
  | { type: 'feed'; behemothId: EntityId; itemId: string }
  | { type: 'climb'; behemothId: EntityId }
  | { type: 'form_alliance'; name: string }
  | { type: 'join_alliance'; name: string }
  | { type: 'leave_alliance' }
  | { type: 'idle' };

export interface TradeItem {
  itemId: string;
  quantity: number;
}

export interface ValidatedAction {
  agentId: EntityId;
  action: ActionType;
  params: ActionParams;
  valid: true;
}

export interface RejectedAction {
  agentId: EntityId;
  action: ActionType;
  reason: string;
}
