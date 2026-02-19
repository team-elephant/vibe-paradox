// pipeline/memory.ts — Stage 6: Lightweight event log + periodic reflection
//
// Logs significant events as MemoryEntry objects. Provides a compact summary
// for the planner's context window. Generates periodic reflections via LLM.
// Inspired by Stanford's memory stream but much simpler.

import type { Perception } from './perception.js';

// --- Types ---

export interface MemoryEntry {
  tick: number;
  type: 'action' | 'observation' | 'reflection';
  content: string;
  importance: number; // 1-10
}

export type LlmCallFn = (prompt: string) => Promise<string>;

// --- Constants ---

export const MEMORY_CAP = 100;
export const REFLECTION_INTERVAL_PLANS = 10;

// --- Class ---

export class PipelineMemory {
  private entries: MemoryEntry[] = [];
  private reflections: string[] = [];
  private planCount: number = 0;
  private lastReflectionAtPlan: number = 0;

  getEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  getReflections(): readonly string[] {
    return this.reflections;
  }

  getPlanCount(): number {
    return this.planCount;
  }

  log(entry: MemoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MEMORY_CAP) {
      this.prune();
    }
  }

  logPerceptions(perceptions: Perception[], tick: number): void {
    for (const p of perceptions) {
      const importance = perceptionImportance(p);
      if (importance >= 3) {
        this.log({
          tick,
          type: 'observation',
          content: describePerception(p),
          importance,
        });
      }
    }
  }

  logPlanCreated(reasoning: string, stepCount: number, tick: number): void {
    this.planCount++;
    this.log({
      tick,
      type: 'action',
      content: `Created plan (${stepCount} steps): ${reasoning}`,
      importance: 5,
    });
  }

  logPlanOutcome(outcome: 'completed' | 'interrupted' | 'failed', reason: string, tick: number): void {
    this.log({
      tick,
      type: 'observation',
      content: `Plan ${outcome}: ${reason}`,
      importance: outcome === 'failed' ? 7 : outcome === 'interrupted' ? 6 : 4,
    });
  }

  shouldReflect(): boolean {
    return this.planCount > 0 &&
      this.planCount - this.lastReflectionAtPlan >= REFLECTION_INTERVAL_PLANS;
  }

  async reflect(llmCall: LlmCallFn): Promise<string> {
    const recentEntries = this.entries.slice(-20);
    const entrySummary = recentEntries
      .map((e) => `[T${e.tick}] ${e.content}`)
      .join('\n');

    const prompt =
      `You are an AI agent reflecting on recent experiences in a game world.\n\n` +
      `Recent events:\n${entrySummary}\n\n` +
      `Based on these experiences, write a brief reflection (1-2 sentences) about ` +
      `what you've learned, patterns you've noticed, or strategies that worked/failed. ` +
      `Be concise and actionable.`;

    const reflection = await llmCall(prompt);

    this.reflections.push(reflection);
    this.lastReflectionAtPlan = this.planCount;

    this.log({
      tick: recentEntries.length > 0 ? recentEntries[recentEntries.length - 1].tick : 0,
      type: 'reflection',
      content: reflection,
      importance: 8,
    });

    return reflection;
  }

  getSummary(): string {
    const lines: string[] = [];

    // Last 5 significant events (highest importance first, then most recent)
    const significant = [...this.entries]
      .sort((a, b) => b.importance - a.importance || b.tick - a.tick)
      .slice(0, 5);

    if (significant.length > 0) {
      for (const e of significant) {
        lines.push(`[T${e.tick}] ${e.content}`);
      }
    }

    // Latest reflection
    if (this.reflections.length > 0) {
      lines.push(`Reflection: ${this.reflections[this.reflections.length - 1]}`);
    }

    return lines.length > 0 ? lines.join('\n') : 'No memories yet.';
  }

  private prune(): void {
    // Keep reflections and high-importance entries, drop the lowest importance oldest entries
    this.entries.sort((a, b) => {
      // Reflections stay
      if (a.type === 'reflection' && b.type !== 'reflection') return -1;
      if (b.type === 'reflection' && a.type !== 'reflection') return 1;
      // Higher importance stays
      if (a.importance !== b.importance) return b.importance - a.importance;
      // More recent stays
      return b.tick - a.tick;
    });

    this.entries = this.entries.slice(0, MEMORY_CAP);

    // Re-sort by tick for chronological access
    this.entries.sort((a, b) => a.tick - b.tick);
  }

  toJSON(): { entries: MemoryEntry[]; reflections: string[]; planCount: number; lastReflectionAtPlan: number } {
    return {
      entries: this.entries,
      reflections: this.reflections,
      planCount: this.planCount,
      lastReflectionAtPlan: this.lastReflectionAtPlan,
    };
  }

  static fromJSON(data: { entries: MemoryEntry[]; reflections: string[]; planCount: number; lastReflectionAtPlan: number }): PipelineMemory {
    const mem = new PipelineMemory();
    mem.entries = data.entries ?? [];
    mem.reflections = data.reflections ?? [];
    mem.planCount = data.planCount ?? 0;
    mem.lastReflectionAtPlan = data.lastReflectionAtPlan ?? 0;
    return mem;
  }
}

// --- Helpers ---

function perceptionImportance(p: Perception): number {
  switch (p.type) {
    case 'got_attacked': return 9;
    case 'entity_died': return 8;
    case 'plan_step_failed': return 7;
    case 'hp_changed': return 6;
    case 'trade_offered': return 6;
    case 'level_up': return 7;
    case 'threat_appeared': return 5;
    case 'inventory_changed': return 4;
    case 'plan_step_completed': return 3;
    case 'message_received': return 5;
    case 'agent_nearby': return 2;
    case 'resource_nearby': return 2;
    case 'threat_gone': return 3;
    case 'nothing': return 0;
    default: return 1;
  }
}

function describePerception(p: Perception): string {
  const d = p.details;
  switch (p.type) {
    case 'got_attacked':
      return `Attacked by ${d.attackerId} for ${d.damage} damage`;
    case 'hp_changed':
      return `HP changed from ${d.from} to ${d.to} (${(d.delta as number) > 0 ? '+' : ''}${d.delta})`;
    case 'entity_died':
      return (d.isSelf as boolean)
        ? `Died (killed by ${d.killedBy ?? 'unknown'})`
        : `${d.entityId} died (killed by ${d.killedBy ?? 'unknown'})`;
    case 'threat_appeared':
      return `Threat appeared: ${d.monsterType} (${d.monsterId})`;
    case 'threat_gone':
      return `Threat gone: ${d.monsterId}`;
    case 'inventory_changed': {
      const parts: string[] = [];
      const gained = d.gained as Array<{ id: string; quantity: number }>;
      const lost = d.lost as Array<{ id: string; quantity: number }>;
      if (gained?.length) parts.push(`gained ${gained.map((g) => `${g.quantity}x ${g.id}`).join(', ')}`);
      if (lost?.length) parts.push(`lost ${lost.map((l) => `${l.quantity}x ${l.id}`).join(', ')}`);
      if (d.goldDelta) parts.push(`gold ${(d.goldDelta as number) > 0 ? '+' : ''}${d.goldDelta}`);
      return `Inventory: ${parts.join('; ') || 'changed'}`;
    }
    case 'plan_step_completed':
      return `Completed: ${d.description ?? d.action}`;
    case 'plan_step_failed':
      return `Failed: ${d.description ?? d.action} (${d.reason})`;
    case 'trade_offered':
      return `Trade offer from ${d.buyer}`;
    case 'message_received':
      return `Message from ${d.senderName}: "${d.content}"`;
    case 'level_up':
      return `Evolved from stage ${d.from} to ${d.to}`;
    case 'agent_nearby':
      return `${d.name} (${d.role}) nearby`;
    case 'resource_nearby':
      return `${d.type} resource nearby (${d.resourceId})`;
    default:
      return `${p.type}`;
  }
}
