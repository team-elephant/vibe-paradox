// pipeline/planner.ts — Stage 5: The single LLM call
//
// Only fires when the router says INTERRUPT, PLAN_COMPLETE, or PLAN_EMPTY.
// Assembles a compact prompt from agent state, drives, nearby entities, and memory.
// Returns a multi-step plan (5-20 actions). Tracks cost per call.

import type { TickUpdateData, MonsterView, ResourceView } from '../../src/types/protocol.js';
import type { AgentPublicView } from '../../src/types/agent.js';
import type { Drives } from './drives.js';
import { describeDrives } from './drives.js';
import type { PipelineMemory } from './memory.js';
import type { Plan, PlanStep } from './router.js';

// --- Types ---

export interface PlannerInput {
  state: TickUpdateData;
  drives: Drives;
  memory: PipelineMemory;
  lastPlanOutcome: string | null;
  interruptReason: string | null;
}

export interface PlannerResult {
  plan: Plan;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type LlmCreateFn = (params: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  temperature: number;
}) => Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}>;

// --- Constants ---

export const MAX_PLAN_STEPS = 20;
export const MIN_PLAN_STEPS = 5;
export const MAX_NEARBY_ENTITIES = 10;

// --- Cooldown tracking ---

export class PlannerCooldown {
  private planTimestamps: number[] = [];
  private readonly maxPerMinute: number;

  constructor(maxPerMinute = 3) {
    this.maxPerMinute = maxPerMinute;
  }

  canPlan(nowMs: number): boolean {
    // Remove timestamps older than 60 seconds
    this.planTimestamps = this.planTimestamps.filter((t) => nowMs - t < 60_000);
    return this.planTimestamps.length < this.maxPerMinute;
  }

  recordPlan(nowMs: number): void {
    this.planTimestamps.push(nowMs);
  }
}

// --- Main function ---

export async function generatePlan(
  input: PlannerInput,
  llmCall: LlmCreateFn,
  model: string,
  maxTokens = 512,
  temperature = 0.7,
): Promise<PlannerResult> {
  const { system, user } = assemblePrompt(input);

  const result = await llmCall({
    system,
    user,
    model,
    maxTokens,
    temperature,
  });

  const plan = parsePlanResponse(result.text, input.state.tick);

  return {
    plan,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  };
}

// --- Prompt assembly ---

export function assemblePrompt(input: PlannerInput): { system: string; user: string } {
  const { state, drives, memory, lastPlanOutcome, interruptReason } = input;
  const self = state.self;

  const system = buildSystemPrompt(self.role);
  const user = buildUserPrompt(state, drives, memory, lastPlanOutcome, interruptReason);

  return { system, user };
}

function buildSystemPrompt(role: string): string {
  return (
    `You are an AI agent playing as a ${role} in Vibe Paradox, an MMORPG.\n` +
    `You make plans of 5-20 sequential actions to achieve your goals.\n` +
    `Respond ONLY with valid JSON. No explanation outside the JSON.`
  );
}

function buildUserPrompt(
  state: TickUpdateData,
  drives: Drives,
  memory: PipelineMemory,
  lastPlanOutcome: string | null,
  interruptReason: string | null,
): string {
  const self = state.self;
  const lines: string[] = [];

  // Agent header
  lines.push(`You are ${self.name}, a ${self.role}.`);
  lines.push(`Stats: HP ${self.health}/${self.maxHealth} | ATK ${self.attack} | DEF ${self.defense} | Gold ${self.gold}`);
  lines.push(`Position: (${self.position.x}, ${self.position.y}) | Status: ${self.status}`);

  // Inventory
  if (self.inventory.length > 0) {
    const items = self.inventory.map((i) => `${i.quantity}x ${i.id}`).join(', ');
    lines.push(`Inventory: ${items}`);
  } else {
    lines.push(`Inventory: empty`);
  }

  // Equipment
  const eq = [self.equipment.weapon, self.equipment.armor, self.equipment.tool].filter(Boolean);
  if (eq.length > 0) {
    lines.push(`Equipment: ${eq.join(', ')}`);
  }

  lines.push('');

  // Drives
  lines.push('Your drives:');
  lines.push(describeDrives(drives));
  lines.push('');

  // Nearby entities (capped)
  lines.push('Nearby:');
  const nearbyLines = buildNearbySection(state);
  if (nearbyLines.length > 0) {
    lines.push(...nearbyLines);
  } else {
    lines.push('  Nothing visible nearby.');
  }
  lines.push('');

  // Last plan outcome
  if (interruptReason) {
    lines.push(`Last plan was INTERRUPTED: ${interruptReason}`);
  } else if (lastPlanOutcome) {
    lines.push(`Last plan: ${lastPlanOutcome}`);
  } else {
    lines.push('No previous plan.');
  }

  // Memory summary
  const memorySummary = memory.getSummary();
  lines.push(`Memory: ${memorySummary}`);
  lines.push('');

  // Instructions
  lines.push('Create a plan of 5-20 sequential actions. Each action must be one of:');
  lines.push('- move <x> <y>');
  lines.push('- gather');
  lines.push('- attack <target_id>');
  lines.push('- craft <recipe>');
  lines.push('- trade <target_id> <offer_item> <request_item>');
  lines.push('- rest');
  lines.push('- chat <target_id> <message>');
  lines.push('- idle');
  lines.push('');
  lines.push('Respond with JSON:');
  lines.push('{"reasoning": "brief strategy", "steps": [{"action": "move", "params": {"x": 400, "y": 300}, "description": "Move to forest", "expectedTicks": 30}]}');

  return lines.join('\n');
}

function buildNearbySection(state: TickUpdateData): string[] {
  const lines: string[] = [];
  const selfPos = state.self.position;
  let count = 0;

  // Agents
  const agents = [...state.nearby.agents]
    .sort((a, b) => distTo(selfPos, a.position) - distTo(selfPos, b.position))
    .slice(0, 5);
  for (const a of agents) {
    if (count >= MAX_NEARBY_ENTITIES) break;
    const d = Math.round(distTo(selfPos, a.position));
    lines.push(`  Agent: ${a.name} (${a.role}) at (${a.position.x},${a.position.y}) d=${d} HP:${a.health}/${a.maxHealth}`);
    count++;
  }

  // Monsters
  const monsters = [...state.nearby.monsters]
    .filter((m) => m.health > 0)
    .sort((a, b) => distTo(selfPos, a.position) - distTo(selfPos, b.position))
    .slice(0, 5);
  for (const m of monsters) {
    if (count >= MAX_NEARBY_ENTITIES) break;
    const d = Math.round(distTo(selfPos, m.position));
    lines.push(`  Monster: ${m.type} [${m.id}] at (${m.position.x},${m.position.y}) d=${d} HP:${m.health}/${m.maxHealth}`);
    count++;
  }

  // Resources
  const resources = [...state.nearby.resources]
    .filter((r) => r.state === 'available')
    .sort((a, b) => distTo(selfPos, a.position) - distTo(selfPos, b.position))
    .slice(0, 5);
  for (const r of resources) {
    if (count >= MAX_NEARBY_ENTITIES) break;
    const d = Math.round(distTo(selfPos, r.position));
    lines.push(`  Resource: ${r.type} [${r.id}] at (${r.position.x},${r.position.y}) d=${d} remaining:${r.remaining}`);
    count++;
  }

  // Behemoths
  for (const b of state.nearby.behemoths) {
    if (count >= MAX_NEARBY_ENTITIES) break;
    const d = Math.round(distTo(selfPos, b.position));
    lines.push(`  Behemoth: ${b.type} [${b.id}] at (${b.position.x},${b.position.y}) d=${d} status:${b.status}`);
    count++;
  }

  return lines;
}

// --- Response parsing ---

export function parsePlanResponse(text: string, tick: number): Plan {
  const parsed = extractJson(text);

  if (!parsed || !Array.isArray(parsed.steps)) {
    return fallbackPlan(tick);
  }

  let steps: PlanStep[] = parsed.steps
    .filter((s: Record<string, unknown>) => s && typeof s.action === 'string')
    .map((s: Record<string, unknown>) => ({
      action: s.action as string,
      params: (s.params as Record<string, unknown>) ?? {},
      description: (s.description as string) ?? s.action as string,
      expectedTicks: typeof s.expectedTicks === 'number' ? s.expectedTicks : 10,
    }));

  // Enforce step count bounds
  if (steps.length < MIN_PLAN_STEPS) {
    // Pad with idle steps
    while (steps.length < MIN_PLAN_STEPS) {
      steps.push({
        action: 'idle',
        params: {},
        description: 'Wait and observe',
        expectedTicks: 5,
      });
    }
  }

  if (steps.length > MAX_PLAN_STEPS) {
    steps = steps.slice(0, MAX_PLAN_STEPS);
  }

  return {
    steps,
    reasoning: (parsed.reasoning as string) ?? '',
    createdAtTick: tick,
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  // Try direct parse
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // ignore
  }

  // Try to extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  // Try to find first { ... } block
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1)) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  return null;
}

function fallbackPlan(tick: number): Plan {
  return {
    steps: [
      { action: 'idle', params: {}, description: 'Wait and observe', expectedTicks: 5 },
      { action: 'idle', params: {}, description: 'Continue waiting', expectedTicks: 5 },
      { action: 'idle', params: {}, description: 'Look around', expectedTicks: 5 },
      { action: 'idle', params: {}, description: 'Rest briefly', expectedTicks: 5 },
      { action: 'idle', params: {}, description: 'Idle', expectedTicks: 5 },
    ],
    reasoning: 'Failed to parse LLM response, defaulting to idle plan',
    createdAtTick: tick,
  };
}

// --- Helpers ---

function distTo(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
