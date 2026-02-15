// pipeline/action-queue.ts — Per-agent action buffering between ticks

import type {
  EntityId,
  Tick,
  RawAction,
  AgentAction,
  ActionParams,
  ActionType,
  TradeItem,
} from '../types/index.js';
const VALID_ACTION_TYPES: ReadonlySet<string> = new Set<ActionType>([
  'move', 'gather', 'craft', 'attack', 'talk', 'inspect',
  'trade', 'trade_respond', 'plant', 'water', 'feed', 'climb',
  'form_alliance', 'join_alliance', 'leave_alliance', 'idle',
]);

export class ActionQueue {
  private queues: Map<EntityId, AgentAction> = new Map();

  enqueue(agentId: EntityId, raw: RawAction, serverTick: Tick): void {
    const parsed = this.parseAction(agentId, raw, serverTick);
    if (!parsed) return;

    // 1 action per agent per tick, last-write-wins
    this.queues.set(agentId, parsed);
  }

  drainAll(): AgentAction[] {
    const all: AgentAction[] = [];
    for (const [, action] of this.queues) {
      all.push(action);
    }
    this.queues.clear();
    return all;
  }

  private parseAction(agentId: EntityId, raw: RawAction, serverTick: Tick): AgentAction | null {
    if (!raw || typeof raw.action !== 'string') return null;
    if (!VALID_ACTION_TYPES.has(raw.action)) return null;
    if (typeof raw.tick !== 'number') return null;

    const params = this.parseParams(raw.action as ActionType, raw.params);
    if (!params) return null;

    return {
      agentId,
      action: raw.action as ActionType,
      params,
      receivedTick: raw.tick,
      serverTick,
    };
  }

  private parseParams(action: ActionType, raw: Record<string, unknown>): ActionParams | null {
    if (!raw || typeof raw !== 'object') {
      // idle doesn't need params
      if (action === 'idle') return { type: 'idle' };
      return null;
    }

    switch (action) {
      case 'move':
        return this.parseMoveParams(raw);
      case 'gather':
        return this.parseGatherParams(raw);
      case 'craft':
        return this.parseCraftParams(raw);
      case 'attack':
        return this.parseAttackParams(raw);
      case 'talk':
        return this.parseTalkParams(raw);
      case 'inspect':
        return this.parseInspectParams(raw);
      case 'trade':
        return this.parseTradeParams(raw);
      case 'trade_respond':
        return this.parseTradeRespondParams(raw);
      case 'plant':
        return this.parsePlantParams(raw);
      case 'water':
        return this.parseWaterParams(raw);
      case 'feed':
        return this.parseFeedParams(raw);
      case 'climb':
        return this.parseClimbParams(raw);
      case 'form_alliance':
        return this.parseFormAllianceParams(raw);
      case 'join_alliance':
        return this.parseJoinAllianceParams(raw);
      case 'leave_alliance':
        return { type: 'leave_alliance' };
      case 'idle':
        return { type: 'idle' };
      default:
        return null;
    }
  }

  private parseMoveParams(raw: Record<string, unknown>): ActionParams | null {
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { type: 'move', x, y };
  }

  private parseGatherParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.targetId !== 'string' || raw.targetId === '') return null;
    return { type: 'gather', targetId: raw.targetId };
  }

  private parseCraftParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.recipeId !== 'string' || raw.recipeId === '') return null;
    return { type: 'craft', recipeId: raw.recipeId };
  }

  private parseAttackParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.targetId !== 'string' || raw.targetId === '') return null;
    return { type: 'attack', targetId: raw.targetId };
  }

  private parseTalkParams(raw: Record<string, unknown>): ActionParams | null {
    const mode = raw.mode;
    if (mode !== 'whisper' && mode !== 'local' && mode !== 'broadcast') return null;
    if (typeof raw.message !== 'string' || raw.message === '') return null;
    const result: ActionParams = { type: 'talk', mode, message: raw.message };
    if (mode === 'whisper') {
      if (typeof raw.targetId !== 'string' || raw.targetId === '') return null;
      return { type: 'talk', mode, message: raw.message, targetId: raw.targetId };
    }
    return result;
  }

  private parseInspectParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.targetId !== 'string' || raw.targetId === '') return null;
    return { type: 'inspect', targetId: raw.targetId };
  }

  private parseTradeParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.targetAgentId !== 'string' || raw.targetAgentId === '') return null;
    if (!Array.isArray(raw.offer) || !Array.isArray(raw.request)) return null;

    const offer = this.parseTradeItems(raw.offer);
    const request = this.parseTradeItems(raw.request);
    if (!offer || !request) return null;

    return { type: 'trade', targetAgentId: raw.targetAgentId, offer, request };
  }

  private parseTradeItems(items: unknown[]): TradeItem[] | null {
    const result: TradeItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      if (typeof obj.itemId !== 'string' || obj.itemId === '') return null;
      const quantity = Number(obj.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      result.push({ itemId: obj.itemId, quantity });
    }
    return result;
  }

  private parseTradeRespondParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.tradeId !== 'string' || raw.tradeId === '') return null;
    if (typeof raw.accept !== 'boolean') return null;
    return { type: 'trade_respond', tradeId: raw.tradeId, accept: raw.accept };
  }

  private parsePlantParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.seedId !== 'string' || raw.seedId === '') return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { type: 'plant', seedId: raw.seedId, x, y };
  }

  private parseWaterParams(raw: Record<string, unknown>): ActionParams | null {
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { type: 'water', x, y };
  }

  private parseFeedParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.behemothId !== 'string' || raw.behemothId === '') return null;
    if (typeof raw.itemId !== 'string' || raw.itemId === '') return null;
    return { type: 'feed', behemothId: raw.behemothId, itemId: raw.itemId };
  }

  private parseClimbParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.behemothId !== 'string' || raw.behemothId === '') return null;
    return { type: 'climb', behemothId: raw.behemothId };
  }

  private parseFormAllianceParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.name !== 'string' || raw.name === '') return null;
    return { type: 'form_alliance', name: raw.name };
  }

  private parseJoinAllianceParams(raw: Record<string, unknown>): ActionParams | null {
    if (typeof raw.name !== 'string' || raw.name === '') return null;
    return { type: 'join_alliance', name: raw.name };
  }
}
