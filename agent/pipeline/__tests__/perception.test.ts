import { describe, it, expect } from 'vitest';
import { perceive, type Perception, type PlanStepContext } from '../perception.js';
import type { TickUpdateData } from '../../../src/types/protocol.js';
import type { AgentSelfView } from '../../../src/types/agent.js';
import type { WorldEvent } from '../../../src/types/world.js';

// --- Test helpers ---

function makeSelf(overrides: Partial<AgentSelfView> = {}): AgentSelfView {
  return {
    id: 'agent_1',
    name: 'TestAgent',
    role: 'fighter',
    position: { x: 100, y: 100 },
    status: 'idle',
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 5,
    speed: 3,
    gold: 50,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    evolutionStage: 0,
    actionCooldown: 0,
    ...overrides,
  };
}

function makeTick(overrides: Partial<TickUpdateData> = {}): TickUpdateData {
  return {
    tick: 1,
    self: makeSelf(),
    nearby: {
      agents: [],
      resources: [],
      monsters: [],
      behemoths: [],
      structures: [],
    },
    messages: [],
    events: [],
    ...overrides,
  };
}

// --- Tests ---

describe('perceive', () => {
  describe('first tick (no previous state)', () => {
    it('returns empty array when nothing nearby', () => {
      const curr = makeTick();
      const result = perceive({ prev: null, curr });
      expect(result).toEqual([]);
    });

    it('detects threats on first tick', () => {
      const curr = makeTick({
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'patrol' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev: null, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'threat_appeared',
        details: expect.objectContaining({ monsterId: 'goblin_1', monsterType: 'goblin' }),
      }));
    });

    it('detects nearby agents on first tick', () => {
      const curr = makeTick({
        nearby: {
          agents: [
            { id: 'agent_2', name: 'Merchant1', role: 'merchant', position: { x: 120, y: 100 }, status: 'idle', health: 80, maxHealth: 80, alliance: null, evolutionStage: 0 },
          ],
          resources: [],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev: null, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'agent_nearby',
        details: expect.objectContaining({ agentId: 'agent_2', name: 'Merchant1', role: 'merchant' }),
      }));
    });

    it('detects nearby available resources on first tick', () => {
      const curr = makeTick({
        nearby: {
          agents: [],
          resources: [
            { id: 'tree_1', type: 'tree', position: { x: 105, y: 100 }, remaining: 3, state: 'available' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev: null, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'resource_nearby',
        details: expect.objectContaining({ resourceId: 'tree_1', type: 'tree' }),
      }));
    });

    it('ignores depleted resources on first tick', () => {
      const curr = makeTick({
        nearby: {
          agents: [],
          resources: [
            { id: 'tree_1', type: 'tree', position: { x: 105, y: 100 }, remaining: 0, state: 'depleted' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev: null, curr });
      expect(result.find((p) => p.type === 'resource_nearby')).toBeUndefined();
    });
  });

  describe('hp_changed', () => {
    it('detects HP decrease (took damage)', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ health: 100 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ health: 70 }) });
      const result = perceive({ prev, curr });
      const hp = result.find((p) => p.type === 'hp_changed');
      expect(hp).toBeDefined();
      expect(hp!.details.from).toBe(100);
      expect(hp!.details.to).toBe(70);
      expect(hp!.details.delta).toBe(-30);
    });

    it('detects HP increase (healed)', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ health: 50 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ health: 80 }) });
      const result = perceive({ prev, curr });
      const hp = result.find((p) => p.type === 'hp_changed');
      expect(hp).toBeDefined();
      expect(hp!.details.delta).toBe(30);
    });

    it('returns nothing when HP unchanged', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({ tick: 2 });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'hp_changed')).toBeUndefined();
    });
  });

  describe('got_attacked', () => {
    it('detects combat_hit event targeting self', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        self: makeSelf({ health: 70 }),
        events: [
          { type: 'combat_hit', attackerId: 'goblin_1', targetId: 'agent_1', damage: 30, targetHealthAfter: 70 },
        ],
      });
      const result = perceive({ prev, curr });
      const attacked = result.find((p) => p.type === 'got_attacked');
      expect(attacked).toBeDefined();
      expect(attacked!.details.attackerId).toBe('goblin_1');
      expect(attacked!.details.damage).toBe(30);
    });

    it('ignores combat_hit targeting someone else', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'combat_hit', attackerId: 'goblin_1', targetId: 'agent_2', damage: 15, targetHealthAfter: 65 },
        ],
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'got_attacked')).toBeUndefined();
    });
  });

  describe('entity_died', () => {
    it('detects death of another entity', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'death', entityId: 'goblin_1', killedBy: 'agent_1', droppedGold: 10, droppedItems: ['wood'] },
        ],
      });
      const result = perceive({ prev, curr });
      const died = result.find((p) => p.type === 'entity_died');
      expect(died).toBeDefined();
      expect(died!.details.entityId).toBe('goblin_1');
      expect(died!.details.isSelf).toBe(false);
      expect(died!.details.droppedGold).toBe(10);
    });

    it('detects self-death', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'death', entityId: 'agent_1', killedBy: 'goblin_1', droppedGold: 20, droppedItems: [] },
        ],
      });
      const result = perceive({ prev, curr });
      const died = result.find((p) => p.type === 'entity_died');
      expect(died).toBeDefined();
      expect(died!.details.isSelf).toBe(true);
    });
  });

  describe('inventory_changed', () => {
    it('detects gained items', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ inventory: [] }) });
      const curr = makeTick({
        tick: 2,
        self: makeSelf({ inventory: [{ id: 'wood', quantity: 3 }] }),
      });
      const result = perceive({ prev, curr });
      const inv = result.find((p) => p.type === 'inventory_changed');
      expect(inv).toBeDefined();
      expect(inv!.details.gained).toContainEqual({ id: 'wood', quantity: 3 });
    });

    it('detects lost items', () => {
      const prev = makeTick({
        tick: 1,
        self: makeSelf({ inventory: [{ id: 'wood', quantity: 5 }] }),
      });
      const curr = makeTick({
        tick: 2,
        self: makeSelf({ inventory: [{ id: 'wood', quantity: 2 }] }),
      });
      const result = perceive({ prev, curr });
      const inv = result.find((p) => p.type === 'inventory_changed');
      expect(inv).toBeDefined();
      expect(inv!.details.lost).toContainEqual({ id: 'wood', quantity: 3 });
    });

    it('detects gold change', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ gold: 50 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ gold: 80 }) });
      const result = perceive({ prev, curr });
      const inv = result.find((p) => p.type === 'inventory_changed');
      expect(inv).toBeDefined();
      expect(inv!.details.goldDelta).toBe(30);
    });

    it('returns nothing when inventory and gold unchanged', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ gold: 50, inventory: [{ id: 'wood', quantity: 2 }] }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ gold: 50, inventory: [{ id: 'wood', quantity: 2 }] }) });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'inventory_changed')).toBeUndefined();
    });

    it('detects item fully consumed (removed from inventory)', () => {
      const prev = makeTick({
        tick: 1,
        self: makeSelf({ inventory: [{ id: 'potion', quantity: 1 }] }),
      });
      const curr = makeTick({
        tick: 2,
        self: makeSelf({ inventory: [] }),
      });
      const result = perceive({ prev, curr });
      const inv = result.find((p) => p.type === 'inventory_changed');
      expect(inv).toBeDefined();
      expect(inv!.details.lost).toContainEqual({ id: 'potion', quantity: 1 });
    });
  });

  describe('threat_appeared / threat_gone', () => {
    it('detects new threat appearing', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'chase' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'threat_appeared',
        details: expect.objectContaining({ monsterId: 'goblin_1' }),
      }));
    });

    it('detects threat leaving range', () => {
      const prev = makeTick({
        tick: 1,
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'patrol' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const curr = makeTick({ tick: 2 });
      const result = perceive({ prev, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'threat_gone',
        details: expect.objectContaining({ monsterId: 'goblin_1' }),
      }));
    });

    it('ignores dead monsters as threats', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 0, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'dead' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'threat_appeared')).toBeUndefined();
    });

    it('does not fire when same threats persist', () => {
      const monsters = [
        { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true as const, status: 'patrol' },
      ];
      const prev = makeTick({
        tick: 1,
        nearby: { agents: [], resources: [], monsters, behemoths: [], structures: [] },
      });
      const curr = makeTick({
        tick: 2,
        nearby: { agents: [], resources: [], monsters, behemoths: [], structures: [] },
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'threat_appeared')).toBeUndefined();
      expect(result.find((p) => p.type === 'threat_gone')).toBeUndefined();
    });
  });

  describe('agent_nearby', () => {
    it('detects new agent appearing', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        nearby: {
          agents: [
            { id: 'agent_2', name: 'Fighter1', role: 'fighter', position: { x: 120, y: 100 }, status: 'idle', health: 90, maxHealth: 100, alliance: null, evolutionStage: 0 },
          ],
          resources: [],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'agent_nearby',
        details: expect.objectContaining({ agentId: 'agent_2', role: 'fighter' }),
      }));
    });

    it('does not fire for agents already nearby', () => {
      const agents = [
        { id: 'agent_2', name: 'Fighter1', role: 'fighter' as const, position: { x: 120, y: 100 }, status: 'idle' as const, health: 90, maxHealth: 100, alliance: null, evolutionStage: 0 },
      ];
      const prev = makeTick({
        tick: 1,
        nearby: { agents, resources: [], monsters: [], behemoths: [], structures: [] },
      });
      const curr = makeTick({
        tick: 2,
        nearby: { agents, resources: [], monsters: [], behemoths: [], structures: [] },
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'agent_nearby')).toBeUndefined();
    });
  });

  describe('resource_nearby', () => {
    it('detects new available resource', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        nearby: {
          agents: [],
          resources: [
            { id: 'gold_1', type: 'gold_vein', position: { x: 115, y: 100 }, remaining: 5, state: 'available' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'resource_nearby',
        details: expect.objectContaining({ resourceId: 'gold_1', type: 'gold_vein' }),
      }));
    });

    it('ignores depleted resources', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        nearby: {
          agents: [],
          resources: [
            { id: 'tree_1', type: 'tree', position: { x: 115, y: 100 }, remaining: 0, state: 'depleted' },
          ],
          monsters: [],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'resource_nearby')).toBeUndefined();
    });
  });

  describe('trade_offered', () => {
    it('detects trade proposed to self (as seller)', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          {
            type: 'trade_proposed',
            tradeId: 'trade_1',
            buyer: 'agent_2',
            seller: 'agent_1',
            offered: [{ itemId: 'gold_ore', quantity: 2 }],
            requested: [{ itemId: 'wood', quantity: 3 }],
          },
        ],
      });
      const result = perceive({ prev, curr });
      const trade = result.find((p) => p.type === 'trade_offered');
      expect(trade).toBeDefined();
      expect(trade!.details.buyer).toBe('agent_2');
    });

    it('ignores trades not involving self', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          {
            type: 'trade_proposed',
            tradeId: 'trade_1',
            buyer: 'agent_2',
            seller: 'agent_3',
            offered: [{ itemId: 'gold_ore', quantity: 2 }],
            requested: [{ itemId: 'wood', quantity: 3 }],
          },
        ],
      });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'trade_offered')).toBeUndefined();
    });
  });

  describe('message_received', () => {
    it('detects incoming messages', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        messages: [
          { id: 'msg_1', senderId: 'agent_2', senderName: 'Merchant1', mode: 'local', content: 'Hello there!', tick: 2 },
        ],
      });
      const result = perceive({ prev, curr });
      const msg = result.find((p) => p.type === 'message_received');
      expect(msg).toBeDefined();
      expect(msg!.details.senderName).toBe('Merchant1');
      expect(msg!.details.content).toBe('Hello there!');
    });

    it('returns nothing when no messages', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({ tick: 2 });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'message_received')).toBeUndefined();
    });
  });

  describe('level_up (evolution stage)', () => {
    it('detects evolution stage increase', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ evolutionStage: 0 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ evolutionStage: 1 }) });
      const result = perceive({ prev, curr });
      const lvl = result.find((p) => p.type === 'level_up');
      expect(lvl).toBeDefined();
      expect(lvl!.details.from).toBe(0);
      expect(lvl!.details.to).toBe(1);
    });

    it('returns nothing when stage unchanged', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ evolutionStage: 1 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ evolutionStage: 1 }) });
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'level_up')).toBeUndefined();
    });
  });

  describe('plan_step_completed', () => {
    it('detects move step completed (within 5 units of target)', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ position: { x: 90, y: 100 } }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ position: { x: 398, y: 301 } }) });
      const planStep: PlanStepContext = {
        action: 'move',
        params: { x: 400, y: 300 },
        description: 'Move to forest',
        expectedTicks: 30,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'move' }),
      }));
    });

    it('does not complete move when still far from target', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ position: { x: 90, y: 100 } }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ position: { x: 200, y: 200 } }) });
      const planStep: PlanStepContext = {
        action: 'move',
        params: { x: 400, y: 300 },
        description: 'Move to forest',
        expectedTicks: 30,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result.find((p) => p.type === 'plan_step_completed')).toBeUndefined();
    });

    it('detects gather step completed via event', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'resource_gathered', agentId: 'agent_1', resourceId: 'tree_1', item: 'wood', quantity: 1 },
        ],
      });
      const planStep: PlanStepContext = {
        action: 'gather',
        params: {},
        description: 'Gather wood',
        expectedTicks: 5,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'gather' }),
      }));
    });

    it('detects attack step completed when target dies', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'death', entityId: 'goblin_1', killedBy: 'agent_1', droppedGold: 5, droppedItems: [] },
        ],
      });
      const planStep: PlanStepContext = {
        action: 'attack',
        params: { targetId: 'goblin_1' },
        description: 'Attack goblin',
        expectedTicks: 10,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'attack', targetDied: true }),
      }));
    });

    it('detects craft step completed via event', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          { type: 'craft_complete', agentId: 'agent_1', recipeId: 'sword', item: 'iron_sword' },
        ],
      });
      const planStep: PlanStepContext = {
        action: 'craft',
        params: { recipeId: 'sword' },
        description: 'Craft iron sword',
        expectedTicks: 10,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'craft' }),
      }));
    });

    it('detects trade step completed via event', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({
        tick: 2,
        events: [
          {
            type: 'trade_complete',
            buyer: 'agent_1',
            seller: 'agent_2',
            offered: [{ itemId: 'gold_ore', quantity: 2 }],
            received: [{ itemId: 'wood', quantity: 5 }],
          },
        ],
      });
      const planStep: PlanStepContext = {
        action: 'trade',
        params: { targetAgentId: 'agent_2' },
        description: 'Trade with merchant',
        expectedTicks: 5,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'trade' }),
      }));
    });

    it('detects rest step completed when HP full', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ health: 80, maxHealth: 100 }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ health: 100, maxHealth: 100 }) });
      const planStep: PlanStepContext = {
        action: 'rest',
        params: {},
        description: 'Rest until healed',
        expectedTicks: 20,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_completed',
        details: expect.objectContaining({ action: 'rest' }),
      }));
    });
  });

  describe('plan_step_failed', () => {
    it('detects attack target out of range', () => {
      const prev = makeTick({
        tick: 1,
        nearby: {
          agents: [],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 110, y: 100 }, type: 'goblin', health: 30, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'flee' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const curr = makeTick({ tick: 2 }); // goblin no longer nearby
      const planStep: PlanStepContext = {
        action: 'attack',
        params: { targetId: 'goblin_1' },
        description: 'Attack goblin',
        expectedTicks: 10,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_failed',
        details: expect.objectContaining({ reason: 'target_out_of_range' }),
      }));
    });

    it('detects plan step failure on agent death', () => {
      const prev = makeTick({ tick: 1, self: makeSelf({ status: 'fighting' }) });
      const curr = makeTick({ tick: 2, self: makeSelf({ status: 'dead' }) });
      const planStep: PlanStepContext = {
        action: 'attack',
        params: { targetId: 'goblin_1' },
        description: 'Attack goblin',
        expectedTicks: 10,
      };
      const result = perceive({ prev, curr, currentPlanStep: planStep });
      expect(result).toContainEqual(expect.objectContaining({
        type: 'plan_step_failed',
        details: expect.objectContaining({ reason: 'agent_died' }),
      }));
    });
  });

  describe('nothing changed', () => {
    it('returns empty array when nothing changed between ticks', () => {
      const state = makeTick({ tick: 1 });
      const next = makeTick({ tick: 2 });
      const result = perceive({ prev: state, curr: next });
      expect(result).toEqual([]);
    });
  });

  describe('multiple perceptions in one tick', () => {
    it('detects multiple events simultaneously', () => {
      const prev = makeTick({
        tick: 1,
        self: makeSelf({ health: 100, gold: 50 }),
      });
      const curr = makeTick({
        tick: 2,
        self: makeSelf({ health: 70, gold: 60 }),
        events: [
          { type: 'combat_hit', attackerId: 'goblin_1', targetId: 'agent_1', damage: 30, targetHealthAfter: 70 },
        ],
        nearby: {
          agents: [
            { id: 'agent_2', name: 'Healer', role: 'merchant', position: { x: 120, y: 100 }, status: 'idle', health: 80, maxHealth: 80, alliance: null, evolutionStage: 0 },
          ],
          resources: [],
          monsters: [
            { id: 'goblin_1', position: { x: 105, y: 100 }, type: 'goblin', health: 20, maxHealth: 30, evolutionStage: 0, isNpc: true, status: 'attack' },
          ],
          behemoths: [],
          structures: [],
        },
      });
      const result = perceive({ prev, curr });

      const types = result.map((p) => p.type);
      expect(types).toContain('hp_changed');
      expect(types).toContain('got_attacked');
      expect(types).toContain('inventory_changed'); // gold changed
      expect(types).toContain('agent_nearby');
      expect(types).toContain('threat_appeared');
    });
  });

  describe('edge cases', () => {
    it('handles no plan step context gracefully', () => {
      const prev = makeTick({ tick: 1 });
      const curr = makeTick({ tick: 2 });
      // No currentPlanStep provided — should not crash
      const result = perceive({ prev, curr });
      expect(result.find((p) => p.type === 'plan_step_completed')).toBeUndefined();
      expect(result.find((p) => p.type === 'plan_step_failed')).toBeUndefined();
    });

    it('sets correct tick on all perceptions', () => {
      const prev = makeTick({ tick: 41 });
      const curr = makeTick({
        tick: 42,
        self: makeSelf({ health: 50 }),
        messages: [
          { id: 'msg_1', senderId: 'agent_2', senderName: 'X', mode: 'local', content: 'Hi', tick: 42 },
        ],
      });
      const result = perceive({ prev, curr });
      for (const p of result) {
        expect(p.tick).toBe(42);
      }
    });
  });
});
