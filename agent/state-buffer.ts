// agent/state-buffer.ts — Tick state buffering + meaningful change detection

import type { TickUpdateData, AgentSelfView, WorldEvent } from '../src/types/index.js';
import type { ChatMessageView } from '../src/types/message.js';

export interface BufferedState {
  current: TickUpdateData;
  previous: TickUpdateData | null;
  recentEvents: WorldEvent[];
  recentMessages: ChatMessageView[];
  ticksSinceLastAction: number;
  ticksSinceLastDecision: number;
  currentPlan: string | null;
}

const MAX_BUFFER_SIZE = 10;

export class StateBuffer {
  private buffer: TickUpdateData[] = [];
  private lastActionTick = 0;
  private lastDecisionTick = 0;
  currentPlan: string | null = null;

  push(update: TickUpdateData): void {
    this.buffer.push(update);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  getBuffered(): BufferedState | null {
    if (this.buffer.length === 0) return null;

    const current = this.buffer[this.buffer.length - 1];
    const previous = this.buffer.length > 1
      ? this.buffer[this.buffer.length - 2]
      : null;

    // Collect recent events across buffered ticks
    const recentEvents: WorldEvent[] = [];
    const recentMessages: ChatMessageView[] = [];
    for (const update of this.buffer) {
      recentEvents.push(...update.events);
      recentMessages.push(...update.messages);
    }

    return {
      current,
      previous,
      recentEvents,
      recentMessages,
      ticksSinceLastAction: current.tick - this.lastActionTick,
      ticksSinceLastDecision: current.tick - this.lastDecisionTick,
      currentPlan: this.currentPlan,
    };
  }

  shouldTriggerDecision(): boolean {
    if (this.buffer.length === 0) return false;

    const current = this.buffer[this.buffer.length - 1];
    const previous = this.buffer.length > 1
      ? this.buffer[this.buffer.length - 2]
      : null;

    // First tick — always decide
    if (!previous) return true;

    // Health changed (took damage or healed)
    if (current.self.health !== previous.self.health) return true;

    // Status changed (arrived at destination, finished gathering, etc.)
    if (current.self.status !== previous.self.status) return true;

    // New entities appeared nearby
    if (entitiesChanged(current, previous)) return true;

    // Received messages
    if (current.messages.length > 0) return true;

    // Received events
    if (current.events.length > 0) return true;

    // Idle timeout — no action for N ticks
    const ticksSinceAction = current.tick - this.lastActionTick;
    if (ticksSinceAction >= 5) return true;

    return false;
  }

  recordAction(tick: number): void {
    this.lastActionTick = tick;
  }

  recordDecision(tick: number): void {
    this.lastDecisionTick = tick;
  }

  getCurrentTick(): number {
    if (this.buffer.length === 0) return 0;
    return this.buffer[this.buffer.length - 1].tick;
  }

  getLastDecisionTick(): number {
    return this.lastDecisionTick;
  }
}

function entitiesChanged(current: TickUpdateData, previous: TickUpdateData): boolean {
  // Check if nearby agent count changed
  if (current.nearby.agents.length !== previous.nearby.agents.length) return true;

  // Check if agent IDs changed
  const currentIds = new Set(current.nearby.agents.map(a => a.id));
  const previousIds = new Set(previous.nearby.agents.map(a => a.id));
  for (const id of currentIds) {
    if (!previousIds.has(id)) return true;
  }
  for (const id of previousIds) {
    if (!currentIds.has(id)) return true;
  }

  // Check nearby monster count changed
  if (current.nearby.monsters.length !== previous.nearby.monsters.length) return true;

  // Check nearby resource count changed
  if (current.nearby.resources.length !== previous.nearby.resources.length) return true;

  return false;
}
