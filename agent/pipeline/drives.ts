// pipeline/drives.ts — Stage 3: Deterministic drive system
//
// Maintains floating-point drive values [0.0, 1.0] updated every tick.
// Pure math — no LLM, no side effects. Inspired by ALIVE's hypothalamus.
// Drives are passed to the planner as natural language context so the LLM
// knows what the agent "wants."

import type { TickUpdateData } from '../../src/types/protocol.js';
import type { Perception } from './perception.js';

// --- Types ---

export interface Drives {
  survival: number;   // f(HP ratio, nearby threat count)
  greed: number;      // f(gold amount, nearby resources, inventory fullness)
  ambition: number;   // f(kills, evolution stage, nearby monsters)
  social: number;     // f(nearby agents, recent messages, recent trades)
  caution: number;    // f(HP ratio, recent damage taken)
}

export interface DrivesContext {
  recentDamageTaken: number;
  ticksSinceLastTrade: number;
  ticksSinceLastMessage: number;
  deathCount: number;
}

// --- Constants ---

const DEFAULT_DRIVES: Drives = {
  survival: 0.5,
  greed: 0.5,
  ambition: 0.5,
  social: 0.3,
  caution: 0.3,
};

const INVENTORY_CAPACITY = 20;
const GOLD_SATIATION = 200;

// Smoothing factor: blend previous drives with new computed values.
// 0 = fully new, 1 = fully previous. 0.3 gives responsive but smooth changes.
const SMOOTHING = 0.3;

// --- Helper ---

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// --- Main function ---

export function updateDrives(
  prev: Drives | null,
  state: TickUpdateData,
  perceptions: Perception[],
  context: DrivesContext,
): Drives {
  const base = prev ?? DEFAULT_DRIVES;

  const survival = computeSurvival(state, perceptions);
  const greed = computeGreed(state);
  const ambition = computeAmbition(state);
  const social = computeSocial(state, perceptions, context);
  const caution = computeCaution(state, context);

  // Smooth transitions: blend with previous values
  return {
    survival: clamp(SMOOTHING * base.survival + (1 - SMOOTHING) * survival),
    greed: clamp(SMOOTHING * base.greed + (1 - SMOOTHING) * greed),
    ambition: clamp(SMOOTHING * base.ambition + (1 - SMOOTHING) * ambition),
    social: clamp(SMOOTHING * base.social + (1 - SMOOTHING) * social),
    caution: clamp(SMOOTHING * base.caution + (1 - SMOOTHING) * caution),
  };
}

export function getDefaultDrives(): Drives {
  return { ...DEFAULT_DRIVES };
}

// --- Drive computation functions ---

function computeSurvival(state: TickUpdateData, perceptions: Perception[]): number {
  const hpRatio = state.self.maxHealth > 0
    ? state.self.health / state.self.maxHealth
    : 1;

  // Low HP increases survival drive
  const hpComponent = 1.0 - hpRatio;

  // Nearby threats increase survival drive
  const threatCount = state.nearby.monsters.filter((m) => m.health > 0).length;
  const threatComponent = Math.min(1, threatCount * 0.25);

  // Got attacked this tick strongly increases survival
  const attacked = perceptions.some((p) => p.type === 'got_attacked');
  const attackBonus = attacked ? 0.3 : 0;

  return clamp(hpComponent * 0.5 + threatComponent * 0.3 + attackBonus + 0.1);
}

function computeGreed(state: TickUpdateData): number {
  // More gold = less greed (satiation)
  const goldSatiation = Math.min(1, state.self.gold / GOLD_SATIATION);
  const goldComponent = 1.0 - goldSatiation;

  // Nearby available resources increase greed
  const availableResources = state.nearby.resources.filter(
    (r) => r.state === 'available',
  ).length;
  const resourceComponent = Math.min(1, availableResources * 0.15);

  // Inventory fullness decreases greed (can't carry more)
  const totalItems = state.self.inventory.reduce((sum, i) => sum + i.quantity, 0);
  const inventoryFullness = Math.min(1, totalItems / INVENTORY_CAPACITY);
  const inventoryComponent = 1.0 - inventoryFullness;

  return clamp(goldComponent * 0.4 + resourceComponent * 0.3 + inventoryComponent * 0.2 + 0.1);
}

function computeAmbition(state: TickUpdateData): number {
  // Evolution stage progress (monsters evolve, others have kills)
  const stageComponent = Math.max(0, 1.0 - state.self.evolutionStage * 0.2);

  // Nearby monsters = XP opportunities
  const monsterCount = state.nearby.monsters.filter((m) => m.health > 0).length;
  const opportunityComponent = Math.min(1, monsterCount * 0.2);

  // Kill count gives diminishing returns on ambition
  const killSatiation = Math.min(1, state.self.kills * 0.05);
  const killComponent = 1.0 - killSatiation * 0.5;

  return clamp(stageComponent * 0.3 + opportunityComponent * 0.3 + killComponent * 0.2 + 0.1);
}

function computeSocial(
  state: TickUpdateData,
  perceptions: Perception[],
  context: DrivesContext,
): number {
  // Nearby agents increase social drive
  const nearbyAgents = state.nearby.agents.length;
  const agentComponent = Math.min(1, nearbyAgents * 0.2);

  // Recent messages decrease social drive (already interacting)
  const hasMessages = perceptions.some((p) => p.type === 'message_received');
  const messageComponent = hasMessages ? -0.2 : 0;

  // Time since last trade increases social drive
  const tradeLoneliness = Math.min(1, context.ticksSinceLastTrade / 200);

  // Time since last message increases social drive
  const messageLoneliness = Math.min(1, context.ticksSinceLastMessage / 100);

  return clamp(
    agentComponent * 0.3 +
    tradeLoneliness * 0.25 +
    messageLoneliness * 0.25 +
    messageComponent +
    0.1,
  );
}

function computeCaution(state: TickUpdateData, context: DrivesContext): number {
  const hpRatio = state.self.maxHealth > 0
    ? state.self.health / state.self.maxHealth
    : 1;

  // Low HP increases caution
  const hpComponent = 1.0 - hpRatio;

  // Recent damage increases caution
  const damageComponent = Math.min(1, context.recentDamageTaken / state.self.maxHealth);

  // Death count increases baseline caution
  const deathComponent = Math.min(1, context.deathCount * 0.15);

  return clamp(hpComponent * 0.4 + damageComponent * 0.3 + deathComponent * 0.2 + 0.1);
}

// --- Natural language descriptions for planner context ---

export function describeDrives(drives: Drives): string {
  const lines: string[] = [];

  lines.push(`Survival: ${describeLevel(drives.survival)} (${drives.survival.toFixed(2)})`);
  lines.push(`Greed: ${describeLevel(drives.greed)} (${drives.greed.toFixed(2)})`);
  lines.push(`Ambition: ${describeLevel(drives.ambition)} (${drives.ambition.toFixed(2)})`);
  lines.push(`Social: ${describeLevel(drives.social)} (${drives.social.toFixed(2)})`);
  lines.push(`Caution: ${describeLevel(drives.caution)} (${drives.caution.toFixed(2)})`);

  return lines.join('\n');
}

function describeLevel(value: number): string {
  if (value >= 0.8) return 'very high';
  if (value >= 0.6) return 'high';
  if (value >= 0.4) return 'moderate';
  if (value >= 0.2) return 'low';
  return 'very low';
}
