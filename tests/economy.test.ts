// tests/economy.test.ts — Tests for Economy (Trading + Crafting)

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/pipeline/executor.js';
import { ActionValidator } from '../src/pipeline/validator.js';
import { EconomyProcessor } from '../src/pipeline/economy-processor.js';
import { WorldState } from '../src/server/world.js';
import type {
  Agent,
  ValidatedAction,
  ActionParams,
  AgentAction,
  Trade,
} from '../src/types/index.js';
import { TRADE_EXPIRE_TICKS } from '../src/shared/constants.js';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_test001',
    name: 'TestAgent',
    role: 'merchant',
    position: { x: 100, y: 100 },
    destination: null,
    status: 'idle',
    stats: {
      health: 50,
      maxHealth: 50,
      attack: 0,
      defense: 5,
      speed: 3,
      visionRadius: 80,
    },
    gold: 0,
    inventory: [],
    equipment: { weapon: null, armor: null, tool: null },
    alliance: null,
    kills: 0,
    monsterEats: 0,
    evolutionStage: 1,
    actionCooldown: 0,
    respawnTick: null,
    connectedAt: 0,
    lastActionTick: 0,
    isAlive: true,
    isConnected: true,
    ...overrides,
  };
}

function makeValidatedAction(
  agentId: string,
  params: ActionParams,
): ValidatedAction {
  return {
    agentId,
    action: params.type,
    params,
    valid: true,
  };
}

function makeAgentAction(
  agentId: string,
  params: ActionParams,
): AgentAction {
  return {
    agentId,
    action: params.type,
    params,
    receivedTick: 0,
    serverTick: 1,
  };
}

describe('Economy — Crafting', () => {
  let executor: ActionExecutor;
  let economyProcessor: EconomyProcessor;
  let world: WorldState;

  beforeEach(() => {
    executor = new ActionExecutor();
    economyProcessor = new EconomyProcessor();
    world = new WorldState(42);
  });

  it('should start crafting iron_sword when merchant has ingredients', () => {
    const merchant = createAgent({
      inventory: [
        { id: 'iron_ore', quantity: 5 },
        { id: 'log', quantity: 3 },
      ],
    });
    world.addAgent(merchant);

    const action = makeValidatedAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });

    executor.executeBatch([action], world, 1);

    const updated = world.agents.get('agent_test001')!;
    expect(updated.status).toBe('crafting');

    // Ingredients consumed
    const ironOre = updated.inventory.find((i) => i.id === 'iron_ore');
    const log = updated.inventory.find((i) => i.id === 'log');
    expect(ironOre?.quantity).toBe(2); // 5 - 3
    expect(log?.quantity).toBe(2); // 3 - 1

    // Crafting job created
    expect(world.craftingQueue.size).toBe(1);
    const job = [...world.craftingQueue.values()][0]!;
    expect(job.recipeId).toBe('iron_sword');
    expect(job.agentId).toBe('agent_test001');
    expect(job.startTick).toBe(1);
    expect(job.completeTick).toBe(11); // 1 + 10 craftTicks
    expect(job.status).toBe('in_progress');
  });

  it('should complete crafting after craftTicks and add item to inventory', () => {
    const merchant = createAgent({
      status: 'crafting',
      inventory: [],
    });
    world.addAgent(merchant);

    // Manually add a crafting job
    world.craftingQueue.set('craft_test001', {
      id: 'craft_test001',
      agentId: 'agent_test001',
      recipeId: 'iron_sword',
      startTick: 1,
      completeTick: 11,
      status: 'in_progress',
    });

    // Process at tick 10 — not done yet
    const notDone = economyProcessor.processCrafting(world, 10);
    executor.applyCraftCompletion(notDone, world);
    expect(world.craftingQueue.size).toBe(1);
    expect(merchant.status).toBe('crafting');

    // Process at tick 11 — done
    const done = economyProcessor.processCrafting(world, 11);
    executor.applyCraftCompletion(done, world);
    expect(world.craftingQueue.size).toBe(0);
    expect(merchant.status).toBe('idle');

    const sword = merchant.inventory.find((i) => i.id === 'iron_sword');
    expect(sword).toBeDefined();
    expect(sword!.quantity).toBe(1);

    // Check craft_complete event
    const craftEvent = world.tickEvents.find((e) => e.type === 'craft_complete');
    expect(craftEvent).toBeDefined();
    if (craftEvent?.type === 'craft_complete') {
      expect(craftEvent.agentId).toBe('agent_test001');
      expect(craftEvent.recipeId).toBe('iron_sword');
      expect(craftEvent.item).toBe('iron_sword');
    }
  });

  it('should produce multiple items for recipes with qty > 1', () => {
    const merchant = createAgent({
      status: 'crafting',
      inventory: [],
    });
    world.addAgent(merchant);

    // healing_salve produces qty: 3
    world.craftingQueue.set('craft_test002', {
      id: 'craft_test002',
      agentId: 'agent_test001',
      recipeId: 'healing_salve',
      startTick: 1,
      completeTick: 6,
      status: 'in_progress',
    });

    const result = economyProcessor.processCrafting(world, 6);
    executor.applyCraftCompletion(result, world);

    const salve = merchant.inventory.find((i) => i.id === 'healing_salve');
    expect(salve).toBeDefined();
    expect(salve!.quantity).toBe(3);
  });

  it('should reject crafting with insufficient materials via validator', () => {
    const merchant = createAgent({
      inventory: [
        { id: 'iron_ore', quantity: 1 }, // Need 3
        { id: 'log', quantity: 1 },
      ],
    });
    world.addAgent(merchant);
    world.tick = 1;

    const validator = new ActionValidator();
    const action = makeAgentAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });

    const { validated, rejected } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('Insufficient materials');
  });

  it('should reject crafting for non-merchant', () => {
    const fighter = createAgent({
      role: 'fighter',
      inventory: [
        { id: 'iron_ore', quantity: 5 },
        { id: 'log', quantity: 3 },
      ],
    });
    world.addAgent(fighter);
    world.tick = 1;

    const validator = new ActionValidator();
    const action = makeAgentAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only merchants can craft');
  });

  it('should reject crafting with unknown recipe', () => {
    const merchant = createAgent({
      inventory: [{ id: 'iron_ore', quantity: 10 }],
    });
    world.addAgent(merchant);
    world.tick = 1;

    const validator = new ActionValidator();
    const action = makeAgentAction('agent_test001', {
      type: 'craft',
      recipeId: 'nonexistent_recipe',
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Recipe not found');
  });

  it('should reject crafting when agent is already crafting (EDGE-2)', () => {
    const merchant = createAgent({
      status: 'crafting',
      inventory: [
        { id: 'iron_ore', quantity: 5 },
        { id: 'log', quantity: 3 },
      ],
    });
    world.addAgent(merchant);
    world.tick = 1;

    const validator = new ActionValidator();
    const action = makeAgentAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Already crafting');
  });

  it('should not lose ingredients on partial failure (BUG-2 atomic check)', () => {
    const merchant = createAgent({
      inventory: [
        { id: 'iron_ore', quantity: 3 },
        // Missing 'log' entirely
      ],
    });
    world.addAgent(merchant);

    const action = makeValidatedAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });

    executor.executeBatch([action], world, 1);

    // Agent should still be idle — craft didn't start
    const updated = world.agents.get('agent_test001')!;
    expect(updated.status).toBe('idle');

    // iron_ore should NOT have been consumed
    const ironOre = updated.inventory.find((i) => i.id === 'iron_ore');
    expect(ironOre?.quantity).toBe(3);

    // No crafting job created
    expect(world.craftingQueue.size).toBe(0);
  });
});

describe('Economy — Trading', () => {
  let executor: ActionExecutor;
  let economyProcessor: EconomyProcessor;
  let validator: ActionValidator;
  let world: WorldState;

  beforeEach(() => {
    executor = new ActionExecutor();
    economyProcessor = new EconomyProcessor();
    validator = new ActionValidator();
    world = new WorldState(42);
  });

  it('should create pending trade and emit trade_proposed event', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      name: 'Merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      name: 'Fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);

    const action = makeValidatedAction('agent_merchant', {
      type: 'trade',
      targetAgentId: 'agent_fighter',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });

    executor.executeBatch([action], world, 1);

    expect(world.pendingTrades.size).toBe(1);
    const trade = [...world.pendingTrades.values()][0]!;
    expect(trade.buyerId).toBe('agent_merchant');
    expect(trade.sellerId).toBe('agent_fighter');
    expect(trade.offered).toEqual([{ itemId: 'iron_sword', quantity: 1 }]);
    expect(trade.requested).toEqual([{ itemId: 'gold', quantity: 50 }]);
    expect(trade.status).toBe('pending');

    const updatedMerchant = world.agents.get('agent_merchant')!;
    expect(updatedMerchant.status).toBe('trading');

    // Check trade_proposed event (MISSING-2)
    const proposedEvent = world.tickEvents.find((e) => e.type === 'trade_proposed');
    expect(proposedEvent).toBeDefined();
    if (proposedEvent?.type === 'trade_proposed') {
      expect(proposedEvent.buyer).toBe('agent_merchant');
      expect(proposedEvent.seller).toBe('agent_fighter');
      expect(proposedEvent.offered).toEqual([{ itemId: 'iron_sword', quantity: 1 }]);
      expect(proposedEvent.requested).toEqual([{ itemId: 'gold', quantity: 50 }]);
    }
  });

  it('should complete trade when fighter accepts (via executor apply)', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      name: 'Merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      name: 'Fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);

    // Create pending trade
    const trade: Trade = {
      id: 'trade_test001',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    // Resolve trade (accept) — processor returns result, executor applies
    const result = economyProcessor.resolveTrade('trade_test001', true, world, 5);
    executor.applyTradeResolve(result, world);

    // Sword moves to fighter, gold moves to merchant
    const updatedMerchant = world.agents.get('agent_merchant')!;
    const updatedFighter = world.agents.get('agent_fighter')!;

    expect(updatedMerchant.inventory.find((i) => i.id === 'iron_sword')).toBeUndefined();
    expect(updatedFighter.inventory.find((i) => i.id === 'iron_sword')?.quantity).toBe(1);
    expect(updatedMerchant.gold).toBe(50);
    expect(updatedFighter.gold).toBe(50); // 100 - 50

    // Trade removed from pending
    expect(world.pendingTrades.size).toBe(0);

    // Check trade_complete event
    const tradeEvent = world.tickEvents.find((e) => e.type === 'trade_complete');
    expect(tradeEvent).toBeDefined();
    if (tradeEvent?.type === 'trade_complete') {
      expect(tradeEvent.buyer).toBe('agent_merchant');
      expect(tradeEvent.seller).toBe('agent_fighter');
    }
  });

  it('should reject trade and remove from pending', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);

    const trade: Trade = {
      id: 'trade_test002',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    const result = economyProcessor.resolveTrade('trade_test002', false, world, 5);
    executor.applyTradeResolve(result, world);

    // Items unchanged
    expect(merchant.inventory.find((i) => i.id === 'iron_sword')?.quantity).toBe(1);
    expect(fighter.gold).toBe(100);

    // Trade removed
    expect(world.pendingTrades.size).toBe(0);
  });

  it('should expire trade after TRADE_EXPIRE_TICKS', () => {
    const trade: Trade = {
      id: 'trade_expire001',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    // Not expired yet
    const notExpired = economyProcessor.processTrades(world, TRADE_EXPIRE_TICKS);
    executor.applyTradeExpiry(notExpired, world);
    expect(world.pendingTrades.size).toBe(1);

    // Expired at createdAt + TRADE_EXPIRE_TICKS
    const expired = economyProcessor.processTrades(world, 1 + TRADE_EXPIRE_TICKS);
    executor.applyTradeExpiry(expired, world);
    expect(world.pendingTrades.size).toBe(0);
  });

  it('should fail trade if agents move out of range', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      role: 'fighter',
      position: { x: 200, y: 200 }, // far away
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);

    const trade: Trade = {
      id: 'trade_range001',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    const result = economyProcessor.resolveTrade('trade_range001', true, world, 5);
    expect(result).toBeNull(); // null = failed

    // Trade stays pending (no result to apply)
    expect(world.pendingTrades.size).toBe(1);
  });

  it('should validate trade_respond correctly via validator', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      name: 'Fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);
    world.tick = 5;

    const trade: Trade = {
      id: 'trade_respond001',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    // Fighter (seller) can respond
    const action = makeAgentAction('agent_fighter', {
      type: 'trade_respond',
      tradeId: 'trade_respond001',
      accept: true,
    });

    const { validated, rejected } = validator.validateBatch([action], world);
    expect(validated).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('should reject trade_respond from wrong agent', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      name: 'Fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);
    world.tick = 5;

    const trade: Trade = {
      id: 'trade_respond002',
      tick: 1,
      buyerId: 'agent_merchant',
      sellerId: 'agent_fighter',
      offered: [{ itemId: 'iron_sword', quantity: 1 }],
      requested: [{ itemId: 'gold', quantity: 50 }],
      status: 'pending',
      createdAt: 1,
      resolvedAt: null,
    };
    world.pendingTrades.set(trade.id, trade);

    // Merchant (buyer) tries to respond — should be rejected
    const action = makeAgentAction('agent_merchant', {
      type: 'trade_respond',
      tradeId: 'trade_respond002',
      accept: true,
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Only the trade recipient can respond');
  });

  it('should handle full trade flow via executor: propose + respond', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      name: 'Merchant',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      name: 'Fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);

    // Step 1: Merchant proposes trade
    const tradeAction = makeValidatedAction('agent_merchant', {
      type: 'trade',
      targetAgentId: 'agent_fighter',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });
    executor.executeBatch([tradeAction], world, 1);

    expect(world.pendingTrades.size).toBe(1);
    const tradeId = [...world.pendingTrades.keys()][0]!;

    // Verify trade_proposed event was emitted
    expect(world.tickEvents.some((e) => e.type === 'trade_proposed')).toBe(true);

    // Step 2: Fighter accepts trade via trade_respond
    const respondAction = makeValidatedAction('agent_fighter', {
      type: 'trade_respond',
      tradeId,
      accept: true,
    });
    executor.executeBatch([respondAction], world, 2);

    // Verify swap
    const updatedMerchant = world.agents.get('agent_merchant')!;
    const updatedFighter = world.agents.get('agent_fighter')!;

    expect(updatedMerchant.inventory.find((i) => i.id === 'iron_sword')).toBeUndefined();
    expect(updatedFighter.inventory.find((i) => i.id === 'iron_sword')?.quantity).toBe(1);
    expect(updatedMerchant.gold).toBe(50);
    expect(updatedFighter.gold).toBe(50);
    expect(world.pendingTrades.size).toBe(0);
  });

  it('should validate trade offer with insufficient items', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      inventory: [], // No items
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);
    world.tick = 1;

    const action = makeAgentAction('agent_merchant', {
      type: 'trade',
      targetAgentId: 'agent_fighter',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Insufficient items for trade offer');
  });

  it('should validate trade with insufficient gold offer', () => {
    const merchant = createAgent({
      id: 'agent_merchant',
      gold: 10, // Not enough gold
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(merchant);
    world.addAgent(fighter);
    world.tick = 1;

    const action = makeAgentAction('agent_merchant', {
      type: 'trade',
      targetAgentId: 'agent_fighter',
      offer: [{ itemId: 'gold', quantity: 50 }],
      request: [],
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Insufficient gold for trade offer');
  });

  it('should reject trade from monster (EDGE-1)', () => {
    const monster = createAgent({
      id: 'agent_monster1',
      role: 'monster',
      inventory: [{ id: 'iron_sword', quantity: 1 }],
    });
    const fighter = createAgent({
      id: 'agent_fighter',
      role: 'fighter',
      position: { x: 105, y: 100 },
      gold: 100,
      stats: {
        health: 100,
        maxHealth: 100,
        attack: 15,
        defense: 10,
        speed: 4,
        visionRadius: 100,
      },
    });
    world.addAgent(monster);
    world.addAgent(fighter);
    world.tick = 1;

    const action = makeAgentAction('agent_monster1', {
      type: 'trade',
      targetAgentId: 'agent_fighter',
      offer: [{ itemId: 'iron_sword', quantity: 1 }],
      request: [{ itemId: 'gold', quantity: 50 }],
    });

    const { rejected } = validator.validateBatch([action], world);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('Monsters cannot trade');
  });
});

describe('Economy — Full crafting lifecycle', () => {
  it('should consume ingredients, craft over time, and produce output', () => {
    const executor = new ActionExecutor();
    const economyProcessor = new EconomyProcessor();
    const world = new WorldState(42);

    const merchant = createAgent({
      inventory: [
        { id: 'iron_ore', quantity: 3 },
        { id: 'log', quantity: 1 },
      ],
    });
    world.addAgent(merchant);

    // Step 1: Start crafting
    const action = makeValidatedAction('agent_test001', {
      type: 'craft',
      recipeId: 'iron_sword',
    });
    executor.executeBatch([action], world, 1);

    // Ingredients consumed
    expect(merchant.inventory.find((i) => i.id === 'iron_ore')).toBeUndefined();
    expect(merchant.inventory.find((i) => i.id === 'log')).toBeUndefined();
    expect(merchant.status).toBe('crafting');

    // Step 2: Process ticks — not done yet
    for (let t = 2; t <= 10; t++) {
      const result = economyProcessor.processCrafting(world, t);
      executor.applyCraftCompletion(result, world);
    }
    expect(world.craftingQueue.size).toBe(1);
    expect(merchant.inventory.find((i) => i.id === 'iron_sword')).toBeUndefined();

    // Step 3: Process tick 11 — done (startTick=1, craftTicks=10, completeTick=11)
    const doneResult = economyProcessor.processCrafting(world, 11);
    executor.applyCraftCompletion(doneResult, world);
    expect(world.craftingQueue.size).toBe(0);
    expect(merchant.status).toBe('idle');

    const sword = merchant.inventory.find((i) => i.id === 'iron_sword');
    expect(sword).toBeDefined();
    expect(sword!.quantity).toBe(1);
  });
});
