// agent/brain.ts — AgentBrain with decision loop, LLM call via Anthropic SDK

import Anthropic from '@anthropic-ai/sdk';
import { join } from 'node:path';
import type { TickUpdateData, ActionType } from '../src/types/index.js';
import type { AgentConfig } from './config.js';
import { StateBuffer } from './state-buffer.js';
import { assemblePrompt } from './prompt-assembler.js';
import { parseDecision } from './action-parser.js';
import { AgentMemory } from './memory.js';

export interface BrainAction {
  action: ActionType;
  params: Record<string, unknown>;
  tick: number;
}

// --- Cost Tracking (Sonnet pricing) ---
const COST_PER_MTOK = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.30,
  cacheWrite: 3.75,
} as const;

const COST_LOG_INTERVAL = 20;

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  decisions: number;
}

function estimateCost(t: UsageTotals): number {
  return (
    (t.inputTokens / 1_000_000) * COST_PER_MTOK.input +
    (t.outputTokens / 1_000_000) * COST_PER_MTOK.output +
    (t.cacheReadTokens / 1_000_000) * COST_PER_MTOK.cacheRead +
    (t.cacheWriteTokens / 1_000_000) * COST_PER_MTOK.cacheWrite
  );
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// Global registry so exit handler can log all agents
const activeAgents = new Map<string, { name: string; usage: UsageTotals }>();
let exitHandlerRegistered = false;

function registerExitHandler(): void {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;

  const logFinalTotals = (): void => {
    if (activeAgents.size === 0) return;
    process.stderr.write('\n=== LLM Cost Summary ===\n');
    let grandTotal = 0;
    for (const [, agent] of activeAgents) {
      const cost = estimateCost(agent.usage);
      grandTotal += cost;
      process.stderr.write(
        `[${agent.name}] ${agent.usage.decisions} decisions | ` +
        `input: ${formatNum(agent.usage.inputTokens)} | ` +
        `output: ${formatNum(agent.usage.outputTokens)} | ` +
        `cache read: ${formatNum(agent.usage.cacheReadTokens)} | ` +
        `cache write: ${formatNum(agent.usage.cacheWriteTokens)} | ` +
        `est cost: $${cost.toFixed(4)}\n`,
      );
    }
    if (activeAgents.size > 1) {
      process.stderr.write(`Total est cost: $${grandTotal.toFixed(4)}\n`);
    }
    process.stderr.write('========================\n');
  };

  process.on('SIGINT', () => {
    logFinalTotals();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    logFinalTotals();
    process.exit(0);
  });
  process.on('exit', () => {
    logFinalTotals();
  });
}

export class AgentBrain {
  private stateBuffer: StateBuffer;
  private client: Anthropic;
  private decisionInFlight = false;
  private sendAction: (action: BrainAction) => void;
  private config: AgentConfig;
  private memory: AgentMemory;
  private memoryPath: string;
  private lastSentAction: { action: string; params: Record<string, unknown>; plan: string; sentTick: number } | null = null;
  private static readonly CONFIRM_TIMEOUT_TICKS = 5;
  private previousHealth: number | null = null;
  private usage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    decisions: 0,
  };

  constructor(config: AgentConfig, sendAction: (action: BrainAction) => void) {
    this.config = config;
    this.sendAction = sendAction;
    this.stateBuffer = new StateBuffer();
    this.client = new Anthropic({ apiKey: config.apiKey });

    // Load persistent memory
    this.memoryPath = join('data', `${config.name}.memory.json`);
    this.memory = AgentMemory.load(this.memoryPath);

    // Register for cost tracking on exit
    activeAgents.set(config.name, { name: config.name, usage: this.usage });
    registerExitHandler();
  }

  async onTickUpdate(update: TickUpdateData): Promise<void> {
    this.stateBuffer.push(update);

    // Update memory from tick data
    this.updateMemoryFromTick(update);

    // Dead agents don't decide — skip LLM call entirely
    if (update.self.health <= 0) return;

    // Don't stack LLM calls
    if (this.decisionInFlight) return;

    // Check decision cooldown
    const ticksSinceDecision = update.tick - this.stateBuffer.getLastDecisionTick();
    if (ticksSinceDecision < this.config.decisionCooldown) return;

    // Check if something meaningful changed
    if (!this.stateBuffer.shouldTriggerDecision()) return;

    const state = this.stateBuffer.getBuffered();
    if (!state) return;

    this.decisionInFlight = true;
    try {
      const { system, user } = assemblePrompt(state, this.config, this.memory);

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
      });

      // Track token usage
      const u = response.usage;
      this.usage.inputTokens += u.input_tokens;
      this.usage.outputTokens += u.output_tokens;
      this.usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      this.usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      this.usage.decisions++;

      // Log cost summary every COST_LOG_INTERVAL decisions
      if (this.usage.decisions % COST_LOG_INTERVAL === 0) {
        const cost = estimateCost(this.usage);
        process.stderr.write(
          `[${this.config.name}] ${this.usage.decisions} decisions | ` +
          `input: ${formatNum(this.usage.inputTokens)} tokens | ` +
          `output: ${formatNum(this.usage.outputTokens)} tokens | ` +
          `cache hits: ${formatNum(this.usage.cacheReadTokens)} | ` +
          `est cost: $${cost.toFixed(4)}\n`,
        );
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');

      const decision = parseDecision(text);
      const tick = this.stateBuffer.getCurrentTick();

      if (decision) {
        this.stateBuffer.currentPlan = decision.plan || null;
        this.stateBuffer.recordAction(tick);
        this.lastSentAction = {
          action: decision.action,
          params: decision.params,
          plan: decision.plan,
          sentTick: tick,
        };
        this.memory.recordDecisionWithTick(tick, decision.action, decision.params, decision.plan, 'pending');
        this.sendAction({
          action: decision.action,
          params: decision.params,
          tick,
        });
      } else {
        // Parse failed — send idle
        this.lastSentAction = { action: 'idle', params: {}, plan: '', sentTick: tick };
        this.memory.recordDecisionWithTick(tick, 'idle', {}, '', 'pending');
        this.sendAction({ action: 'idle', params: {}, tick });
      }

      this.stateBuffer.recordDecision(tick);

      // Save memory after each decision
      this.memory.save(this.memoryPath);
    } catch (err) {
      process.stderr.write(`LLM error: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      this.decisionInFlight = false;
    }
  }

  private updateMemoryFromTick(update: TickUpdateData): void {
    const tick = update.tick;
    const selfId = update.self.id;
    const selfPos = update.self.position;

    // Record agents met
    for (const agent of update.nearby.agents) {
      this.memory.recordAgentMet(
        agent.name,
        agent.role,
        agent.alliance,
        tick,
        agent.position,
      );
    }

    // Record resources found
    for (const resource of update.nearby.resources) {
      if (resource.state !== 'depleted') {
        this.memory.recordResourceFound(resource.position, resource.type, tick);
      }
    }

    // Check for damage taken (threat)
    if (this.previousHealth !== null && update.self.health < this.previousHealth) {
      // Find who attacked us from events
      for (const event of update.events) {
        if (event.type === 'combat_hit' && event.targetId === selfId) {
          const attackerAgent = update.nearby.agents.find(a => a.id === event.attackerId);
          const attackerMonster = update.nearby.monsters.find(m => m.id === event.attackerId);
          const attackerName = attackerAgent?.name ?? attackerMonster?.type ?? event.attackerId;
          const attackerRole = attackerAgent?.role ?? (attackerMonster ? 'npc' : 'unknown');
          this.memory.recordThreat(attackerName, attackerRole, selfPos, tick, 'survived');
        }
      }
    }
    this.previousHealth = update.self.health;

    // Check for our death
    for (const event of update.events) {
      if (event.type === 'death' && event.entityId === selfId) {
        const killerAgent = update.nearby.agents.find(a => a.id === event.killedBy);
        const killerMonster = update.nearby.monsters.find(m => m.id === event.killedBy);
        const killerName = killerAgent?.name ?? killerMonster?.type ?? (event.killedBy ? String(event.killedBy) : null);
        this.memory.recordDeath(selfPos, killerName, tick);
      }
    }

    // Check for trade completions
    for (const event of update.events) {
      if (event.type === 'trade_complete') {
        const isBuyer = event.buyer === selfId;
        const isSeller = event.seller === selfId;
        if (isBuyer || isSeller) {
          const partnerId = isBuyer ? event.seller : event.buyer;
          const partnerAgent = update.nearby.agents.find(a => a.id === partnerId);
          const partnerName = partnerAgent?.name ?? String(partnerId);
          const gave = isBuyer ? formatTradeItems(event.offered) : formatTradeItems(event.received);
          const received = isBuyer ? formatTradeItems(event.received) : formatTradeItems(event.offered);
          this.memory.recordTrade(partnerName, gave, received, tick);
        }
      }
    }

    // Resolve pending action outcome based on confirming events or timeout
    if (this.lastSentAction) {
      const confirmed = this.hasConfirmingEvent(update, selfId);
      if (confirmed) {
        this.memory.resolvePendingDecision('success');
        this.lastSentAction = null;
      } else if (tick - this.lastSentAction.sentTick >= AgentBrain.CONFIRM_TIMEOUT_TICKS) {
        // No confirmation within 5 ticks — mark as unknown
        this.memory.resolvePendingDecision('unknown');
        this.lastSentAction = null;
      }
    }
  }

  /** Check if this tick's events confirm the last sent action succeeded */
  private hasConfirmingEvent(update: TickUpdateData, selfId: string): boolean {
    if (!this.lastSentAction) return false;
    const action = this.lastSentAction.action;

    for (const event of update.events) {
      switch (event.type) {
        case 'resource_gathered':
          if (action === 'gather' && event.agentId === selfId) return true;
          break;
        case 'trade_complete':
          if (action === 'trade' && (event.buyer === selfId || event.seller === selfId)) return true;
          break;
        case 'combat_hit':
          if (action === 'attack' && event.attackerId === selfId) return true;
          break;
        case 'craft_complete':
          if (action === 'craft' && event.agentId === selfId) return true;
          break;
        case 'tree_planted':
          if (action === 'plant' && event.agentId === selfId) return true;
          break;
        case 'alliance_formed':
          if (action === 'form_alliance' && event.founder === selfId) return true;
          break;
        case 'alliance_joined':
          if (action === 'join_alliance' && event.agentId === selfId) return true;
          break;
      }
    }

    // For move/idle/talk/inspect — confirm if status changed as expected
    if (action === 'move' && update.self.status === 'moving') return true;
    if (action === 'idle') return true; // idle always succeeds

    return false;
  }

  /** Called when the server rejects an action — records rejection in memory */
  onActionRejected(action: string, reason: string): void {
    // Resolve the pending decision as rejected with original params/plan
    const resolved = this.memory.resolvePendingDecision('rejected', reason);
    if (!resolved) {
      // No pending decision found — record standalone rejection
      const prev = this.lastSentAction;
      this.memory.recordDecisionWithTick(
        this.stateBuffer.getCurrentTick(),
        action,
        prev?.params ?? {},
        prev?.plan ?? '',
        'rejected',
        reason,
      );
    }
    this.lastSentAction = null;
    this.memory.save(this.memoryPath);
  }
}

function formatTradeItems(items: Array<{ itemId: string; quantity: number }>): string {
  return items.map(i => `${i.quantity}x${i.itemId}`).join('+');
}
