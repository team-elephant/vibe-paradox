// agent/memory.ts — Persistent memory across agent decisions

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRole } from '../src/types/index.js';

export interface DecisionRecord {
  tick: number;
  action: string;
  params: Record<string, unknown>;
  plan: string;
  outcome: 'success' | 'rejected' | 'unknown' | 'pending';
  rejectionReason?: string;
}

export interface KnownAgent {
  name: string;
  role: AgentRole;
  alliance: string | null;
  lastSeenTick: number;
  lastSeenPosition: { x: number; y: number };
}

export interface KnownResource {
  position: { x: number; y: number };
  type: string;
  lastSeenTick: number;
}

export interface ThreatRecord {
  attackerName: string;
  attackerRole: string;
  position: { x: number; y: number };
  tick: number;
  outcome: 'survived' | 'died' | 'fled';
}

export interface TradeRecord {
  partnerName: string;
  gave: string;
  received: string;
  tick: number;
}

export interface DeathRecord {
  position: { x: number; y: number };
  killerName: string | null;
  tick: number;
}

export interface MemoryData {
  decisions: DecisionRecord[];
  knownAgents: Map<string, KnownAgent>;
  knownResources: KnownResource[];
  threats: ThreatRecord[];
  trades: TradeRecord[];
  deaths: DeathRecord[];
}

const MAX_DECISIONS = 20;
const MAX_RESOURCES = 50;
const MAX_THREATS = 20;
const MAX_TRADES = 20;
const MAX_DEATHS = 10;

export class AgentMemory {
  decisions: DecisionRecord[] = [];
  knownAgents: Map<string, KnownAgent> = new Map();
  knownResources: KnownResource[] = [];
  threats: ThreatRecord[] = [];
  trades: TradeRecord[] = [];
  deaths: DeathRecord[] = [];

  recordDecisionWithTick(tick: number, action: string, params: Record<string, unknown>, plan: string, outcome: 'success' | 'rejected' | 'unknown' | 'pending', rejectionReason?: string): void {
    this.decisions.push({
      tick,
      action,
      params,
      plan,
      outcome,
      rejectionReason,
    });
    if (this.decisions.length > MAX_DECISIONS) {
      this.decisions = this.decisions.slice(-MAX_DECISIONS);
    }
  }

  /** Update the most recent pending decision to a final outcome */
  resolvePendingDecision(outcome: 'success' | 'rejected' | 'unknown', rejectionReason?: string): boolean {
    for (let i = this.decisions.length - 1; i >= 0; i--) {
      if (this.decisions[i].outcome === 'pending') {
        this.decisions[i].outcome = outcome;
        if (rejectionReason) {
          this.decisions[i].rejectionReason = rejectionReason;
        }
        return true;
      }
    }
    return false;
  }

  recordAgentMet(name: string, role: AgentRole, alliance: string | null, tick: number, position: { x: number; y: number }): void {
    this.knownAgents.set(name, {
      name,
      role,
      alliance,
      lastSeenTick: tick,
      lastSeenPosition: { ...position },
    });
  }

  recordResourceFound(position: { x: number; y: number }, type: string, tick: number): void {
    // Update existing or add new
    const existing = this.knownResources.find(
      r => r.type === type && Math.abs(r.position.x - position.x) < 5 && Math.abs(r.position.y - position.y) < 5
    );
    if (existing) {
      existing.lastSeenTick = tick;
      existing.position = { ...position };
    } else {
      this.knownResources.push({
        position: { ...position },
        type,
        lastSeenTick: tick,
      });
      if (this.knownResources.length > MAX_RESOURCES) {
        // Remove oldest
        this.knownResources.sort((a, b) => b.lastSeenTick - a.lastSeenTick);
        this.knownResources = this.knownResources.slice(0, MAX_RESOURCES);
      }
    }
  }

  recordThreat(attackerName: string, attackerRole: string, position: { x: number; y: number }, tick: number, outcome: 'survived' | 'died' | 'fled'): void {
    this.threats.push({
      attackerName,
      attackerRole,
      position: { ...position },
      tick,
      outcome,
    });
    if (this.threats.length > MAX_THREATS) {
      this.threats = this.threats.slice(-MAX_THREATS);
    }
  }

  recordTrade(partnerName: string, gave: string, received: string, tick: number): void {
    this.trades.push({ partnerName, gave, received, tick });
    if (this.trades.length > MAX_TRADES) {
      this.trades = this.trades.slice(-MAX_TRADES);
    }
  }

  recordDeath(position: { x: number; y: number }, killerName: string | null, tick: number): void {
    this.deaths.push({
      position: { ...position },
      killerName,
      tick,
    });
    if (this.deaths.length > MAX_DEATHS) {
      this.deaths = this.deaths.slice(-MAX_DEATHS);
    }
  }

  serialize(): string {
    return JSON.stringify({
      decisions: this.decisions,
      knownAgents: Array.from(this.knownAgents.values()),
      knownResources: this.knownResources,
      threats: this.threats,
      trades: this.trades,
      deaths: this.deaths,
    }, null, 2);
  }

  static fromSerialized(json: string): AgentMemory {
    const memory = new AgentMemory();
    const data = JSON.parse(json) as {
      decisions: DecisionRecord[];
      knownAgents: KnownAgent[];
      knownResources: KnownResource[];
      threats: ThreatRecord[];
      trades: TradeRecord[];
      deaths: DeathRecord[];
    };

    memory.decisions = data.decisions ?? [];
    memory.knownResources = data.knownResources ?? [];
    memory.threats = data.threats ?? [];
    memory.trades = data.trades ?? [];
    memory.deaths = data.deaths ?? [];

    if (Array.isArray(data.knownAgents)) {
      for (const agent of data.knownAgents) {
        memory.knownAgents.set(agent.name, agent);
      }
    }

    return memory;
  }

  static load(filePath: string): AgentMemory {
    if (!existsSync(filePath)) {
      return new AgentMemory();
    }
    const json = readFileSync(filePath, 'utf-8');
    return AgentMemory.fromSerialized(json);
  }

  save(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, this.serialize(), 'utf-8');
  }
}
