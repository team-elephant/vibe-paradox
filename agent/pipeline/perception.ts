// pipeline/perception.ts — Stage 1: Delta detection between ticks
//
// Compares previous and current TickUpdateData to detect what changed.
// Returns a list of Perception objects for downstream stages.
// Pure function — no side effects, no LLM calls.

import type { EntityId, Tick } from '../../src/types/core.js';
import type { AgentRole } from '../../src/types/agent.js';
import type {
  TickUpdateData,
  MonsterView,
} from '../../src/types/protocol.js';
import type { WorldEvent } from '../../src/types/world.js';

// --- Types ---

export type PerceptionType =
  | 'threat_appeared'
  | 'threat_gone'
  | 'hp_changed'
  | 'inventory_changed'
  | 'resource_nearby'
  | 'agent_nearby'
  | 'plan_step_completed'
  | 'plan_step_failed'
  | 'got_attacked'
  | 'entity_died'
  | 'trade_offered'
  | 'message_received'
  | 'level_up'
  | 'nothing';

export interface Perception {
  type: PerceptionType;
  details: Record<string, unknown>;
  tick: Tick;
}

export interface PlanStepContext {
  action: string;
  params: Record<string, unknown>;
  description: string;
  expectedTicks: number;
}

export interface PerceptionInput {
  prev: TickUpdateData | null;
  curr: TickUpdateData;
  currentPlanStep?: PlanStepContext | null;
}

// --- Helpers ---

function isThreat(monster: MonsterView): boolean {
  return monster.health > 0 && monster.status !== 'dead';
}

function entitySetDiff(
  prevIds: Set<EntityId>,
  currIds: Set<EntityId>,
): { appeared: EntityId[]; gone: EntityId[] } {
  const appeared: EntityId[] = [];
  const gone: EntityId[] = [];
  for (const id of currIds) {
    if (!prevIds.has(id)) appeared.push(id);
  }
  for (const id of prevIds) {
    if (!currIds.has(id)) gone.push(id);
  }
  return { appeared, gone };
}

// --- Main perceive function ---

export function perceive(input: PerceptionInput): Perception[] {
  const { prev, curr, currentPlanStep } = input;
  const tick = curr.tick;
  const perceptions: Perception[] = [];

  // First tick — no previous state to compare
  if (prev === null) {
    return detectFirstTick(curr, tick);
  }

  // HP changes
  detectHpChanged(prev, curr, tick, perceptions);

  // Got attacked (from events)
  detectGotAttacked(curr, tick, perceptions);

  // Entity died (from events)
  detectEntityDied(curr, tick, perceptions);

  // Inventory changes
  detectInventoryChanged(prev, curr, tick, perceptions);

  // Threat appeared / gone
  detectThreats(prev, curr, tick, perceptions);

  // New agents nearby
  detectAgentsNearby(prev, curr, tick, perceptions);

  // New resources nearby
  detectResourcesNearby(prev, curr, tick, perceptions);

  // Trade offered (from events)
  detectTradeOffered(curr, tick, perceptions);

  // Messages received
  detectMessages(curr, tick, perceptions);

  // Level up
  detectLevelUp(prev, curr, tick, perceptions);

  // Plan step completion/failure
  detectPlanStepStatus(prev, curr, currentPlanStep ?? null, tick, perceptions);

  return perceptions;
}

// --- Detection functions ---

function detectFirstTick(curr: TickUpdateData, tick: Tick): Perception[] {
  const perceptions: Perception[] = [];

  // Report threats if any
  const threats = curr.nearby.monsters.filter(isThreat);
  for (const t of threats) {
    perceptions.push({
      type: 'threat_appeared',
      details: { monsterId: t.id, monsterType: t.type, health: t.health, maxHealth: t.maxHealth },
      tick,
    });
  }

  // Report nearby agents
  for (const a of curr.nearby.agents) {
    perceptions.push({
      type: 'agent_nearby',
      details: { agentId: a.id, name: a.name, role: a.role },
      tick,
    });
  }

  // Report nearby resources
  for (const r of curr.nearby.resources) {
    if (r.state === 'available') {
      perceptions.push({
        type: 'resource_nearby',
        details: { resourceId: r.id, type: r.type, remaining: r.remaining },
        tick,
      });
    }
  }

  return perceptions;
}

function detectHpChanged(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  if (curr.self.health !== prev.self.health) {
    out.push({
      type: 'hp_changed',
      details: {
        from: prev.self.health,
        to: curr.self.health,
        maxHealth: curr.self.maxHealth,
        delta: curr.self.health - prev.self.health,
      },
      tick,
    });
  }
}

function detectGotAttacked(
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  for (const event of curr.events) {
    if (event.type === 'combat_hit' && event.targetId === curr.self.id) {
      out.push({
        type: 'got_attacked',
        details: {
          attackerId: event.attackerId,
          damage: event.damage,
          healthAfter: event.targetHealthAfter,
        },
        tick,
      });
    }
  }
}

function detectEntityDied(
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  for (const event of curr.events) {
    if (event.type === 'death') {
      out.push({
        type: 'entity_died',
        details: {
          entityId: event.entityId,
          killedBy: event.killedBy,
          isSelf: event.entityId === curr.self.id,
          droppedGold: event.droppedGold,
          droppedItems: event.droppedItems,
        },
        tick,
      });
    }
  }
}

function detectInventoryChanged(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  const prevItems = new Map(prev.self.inventory.map((i) => [i.id, i.quantity]));
  const currItems = new Map(curr.self.inventory.map((i) => [i.id, i.quantity]));

  const gained: Array<{ id: string; quantity: number }> = [];
  const lost: Array<{ id: string; quantity: number }> = [];

  // Check for new or increased items
  for (const [id, qty] of currItems) {
    const prevQty = prevItems.get(id) ?? 0;
    if (qty > prevQty) gained.push({ id, quantity: qty - prevQty });
  }

  // Check for removed or decreased items
  for (const [id, qty] of prevItems) {
    const currQty = currItems.get(id) ?? 0;
    if (currQty < qty) lost.push({ id, quantity: qty - currQty });
  }

  // Also check gold
  const goldChanged = curr.self.gold !== prev.self.gold;

  if (gained.length > 0 || lost.length > 0 || goldChanged) {
    out.push({
      type: 'inventory_changed',
      details: {
        gained,
        lost,
        goldDelta: goldChanged ? curr.self.gold - prev.self.gold : 0,
      },
      tick,
    });
  }
}

function detectThreats(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  const prevThreatIds = new Set(prev.nearby.monsters.filter(isThreat).map((m) => m.id));
  const currThreatIds = new Set(curr.nearby.monsters.filter(isThreat).map((m) => m.id));
  const currMonsters = new Map(curr.nearby.monsters.map((m) => [m.id, m]));

  const { appeared, gone } = entitySetDiff(prevThreatIds, currThreatIds);

  for (const id of appeared) {
    const m = currMonsters.get(id)!;
    out.push({
      type: 'threat_appeared',
      details: { monsterId: id, monsterType: m.type, health: m.health, maxHealth: m.maxHealth },
      tick,
    });
  }

  for (const id of gone) {
    out.push({
      type: 'threat_gone',
      details: { monsterId: id },
      tick,
    });
  }
}

function detectAgentsNearby(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  const prevAgentIds = new Set(prev.nearby.agents.map((a) => a.id));

  for (const agent of curr.nearby.agents) {
    if (!prevAgentIds.has(agent.id)) {
      out.push({
        type: 'agent_nearby',
        details: { agentId: agent.id, name: agent.name, role: agent.role },
        tick,
      });
    }
  }
}

function detectResourcesNearby(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  const prevResourceIds = new Set(
    prev.nearby.resources.filter((r) => r.state === 'available').map((r) => r.id),
  );

  for (const resource of curr.nearby.resources) {
    if (resource.state === 'available' && !prevResourceIds.has(resource.id)) {
      out.push({
        type: 'resource_nearby',
        details: { resourceId: resource.id, type: resource.type, remaining: resource.remaining },
        tick,
      });
    }
  }
}

function detectTradeOffered(
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  for (const event of curr.events) {
    if (event.type === 'trade_proposed' && event.seller === curr.self.id) {
      out.push({
        type: 'trade_offered',
        details: {
          tradeId: event.tradeId,
          buyer: event.buyer,
          offered: event.offered,
          requested: event.requested,
        },
        tick,
      });
    }
  }
}

function detectMessages(
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  for (const msg of curr.messages) {
    out.push({
      type: 'message_received',
      details: {
        senderId: msg.senderId,
        senderName: msg.senderName,
        mode: msg.mode,
        content: msg.content,
      },
      tick,
    });
  }
}

function detectLevelUp(
  prev: TickUpdateData,
  curr: TickUpdateData,
  tick: Tick,
  out: Perception[],
): void {
  // AgentSelfView doesn't have a level field in the current types,
  // but evolutionStage is used for monsters. Check evolution stage change.
  if (curr.self.evolutionStage !== prev.self.evolutionStage) {
    out.push({
      type: 'level_up',
      details: {
        from: prev.self.evolutionStage,
        to: curr.self.evolutionStage,
      },
      tick,
    });
  }
}

function detectPlanStepStatus(
  prev: TickUpdateData,
  curr: TickUpdateData,
  planStep: PlanStepContext | null,
  tick: Tick,
  out: Perception[],
): void {
  if (!planStep) return;

  const action = planStep.action;

  // Check for failure first: agent died while executing plan step (supersedes all)
  if (prev.self.status !== 'dead' && curr.self.status === 'dead') {
    out.push({
      type: 'plan_step_failed',
      details: { action, description: planStep.description, reason: 'agent_died' },
      tick,
    });
    return;
  }

  // Check for completion based on action type
  if (action === 'move') {
    const targetX = planStep.params.x as number;
    const targetY = planStep.params.y as number;
    if (targetX !== undefined && targetY !== undefined) {
      const dx = curr.self.position.x - targetX;
      const dy = curr.self.position.y - targetY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 5) {
        out.push({
          type: 'plan_step_completed',
          details: { action, description: planStep.description },
          tick,
        });
        return;
      }
    }
  }

  if (action === 'gather') {
    // Check if a resource_gathered event exists for us
    const gathered = curr.events.some(
      (e) => e.type === 'resource_gathered' && e.agentId === curr.self.id,
    );
    if (gathered) {
      out.push({
        type: 'plan_step_completed',
        details: { action, description: planStep.description },
        tick,
      });
      return;
    }
  }

  if (action === 'attack') {
    const targetId = planStep.params.targetId as string | undefined;
    if (targetId) {
      // Target died
      const targetDied = curr.events.some(
        (e) => e.type === 'death' && e.entityId === targetId,
      );
      if (targetDied) {
        out.push({
          type: 'plan_step_completed',
          details: { action, description: planStep.description, targetDied: true },
          tick,
        });
        return;
      }
      // Target no longer in range (fled or we moved away)
      const targetInRange =
        curr.nearby.monsters.some((m) => m.id === targetId) ||
        curr.nearby.agents.some((a) => a.id === targetId);
      if (!targetInRange) {
        out.push({
          type: 'plan_step_failed',
          details: { action, description: planStep.description, reason: 'target_out_of_range' },
          tick,
        });
        return;
      }
    }
  }

  if (action === 'craft') {
    const crafted = curr.events.some(
      (e) => e.type === 'craft_complete' && e.agentId === curr.self.id,
    );
    if (crafted) {
      out.push({
        type: 'plan_step_completed',
        details: { action, description: planStep.description },
        tick,
      });
      return;
    }
  }

  if (action === 'trade') {
    const tradeComplete = curr.events.some(
      (e) =>
        e.type === 'trade_complete' &&
        (e.buyer === curr.self.id || e.seller === curr.self.id),
    );
    if (tradeComplete) {
      out.push({
        type: 'plan_step_completed',
        details: { action, description: planStep.description },
        tick,
      });
      return;
    }
  }

  if (action === 'rest') {
    // Rest completes when HP is full
    if (curr.self.health >= curr.self.maxHealth) {
      out.push({
        type: 'plan_step_completed',
        details: { action, description: planStep.description },
        tick,
      });
      return;
    }
  }

}
