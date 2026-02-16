// agent/prompt-assembler.ts — Builds system + user prompts from BufferedState

import type { AgentRole } from '../src/types/index.js';
import type { BufferedState } from './state-buffer.js';
import type { AgentConfig } from './config.js';
import type { AgentMemory } from './memory.js';
import { BASE_SYSTEM_PROMPT } from './prompts/system.js';
import { FIGHTER_PROMPT } from './prompts/fighter.js';
import { MERCHANT_PROMPT } from './prompts/merchant.js';
import { MONSTER_PROMPT } from './prompts/monster.js';

const ROLE_PROMPTS: Record<AgentRole, string> = {
  fighter: FIGHTER_PROMPT,
  merchant: MERCHANT_PROMPT,
  monster: MONSTER_PROMPT,
};

export function assemblePrompt(
  state: BufferedState,
  config: AgentConfig,
  memory?: AgentMemory,
): { system: string; user: string } {
  const system = `${BASE_SYSTEM_PROMPT}\n\n${ROLE_PROMPTS[config.role]}`;

  const { current, recentEvents, recentMessages, currentPlan } = state;
  const self = current.self;

  // Build compact user prompt
  const parts: string[] = [];

  // Status line
  parts.push(`T${current.tick} | ${self.status} | HP:${self.health}/${self.maxHealth} | ATK:${self.attack} DEF:${self.defense} | Gold:${self.gold} | Pos:(${Math.round(self.position.x)},${Math.round(self.position.y)})`);

  // Inventory (compact)
  if (self.inventory.length > 0) {
    const items = self.inventory.map(i => `${i.id}:${i.quantity}`).join(', ');
    parts.push(`INV: ${items}`);
  }

  // Equipment
  const eq = self.equipment;
  const equipped = [
    eq.weapon ? `W:${eq.weapon}` : null,
    eq.armor ? `A:${eq.armor}` : null,
    eq.tool ? `T:${eq.tool}` : null,
  ].filter(Boolean).join(' ');
  if (equipped) parts.push(`EQ: ${equipped}`);

  // Nearby entities (truncated)
  const nearby = current.nearby;
  if (nearby.agents.length > 0) {
    const agents = nearby.agents.slice(0, 5).map(a => {
      const dist = Math.round(Math.sqrt(
        (a.position.x - self.position.x) ** 2 + (a.position.y - self.position.y) ** 2
      ));
      return `[ID: ${a.id}] ${a.name} (${a.role}) HP: ${a.health}/${a.maxHealth} Distance: ${dist} Alliance: ${a.alliance ?? 'none'}`;
    }).join('; ');
    parts.push(`AGENTS: ${agents}`);
  }

  if (nearby.monsters.length > 0) {
    const monsters = nearby.monsters.slice(0, 5).map(m => {
      const dist = Math.round(Math.sqrt(
        (m.position.x - self.position.x) ** 2 + (m.position.y - self.position.y) ** 2
      ));
      return `[ID: ${m.id}] ${m.type} HP: ${m.health}/${m.maxHealth} Distance: ${dist}${m.isNpc ? ' (npc)' : ''}`;
    }).join('; ');
    parts.push(`MONSTERS: ${monsters}`);
  }

  if (nearby.resources.length > 0) {
    const resources = nearby.resources.slice(0, 5).map(r =>
      `${r.id}(${r.type},${r.state},${Math.round(r.position.x)},${Math.round(r.position.y)})`
    ).join('; ');
    parts.push(`RESOURCES: ${resources}`);
  }

  if (nearby.behemoths.length > 0) {
    const behemoths = nearby.behemoths.slice(0, 3).map(b =>
      `${b.id}(${b.type},${b.status},HP:${b.health}/${b.maxHealth}${b.oreAvailable ? ',ore!' : ''})`
    ).join('; ');
    parts.push(`BEHEMOTHS: ${behemoths}`);
  }

  // Recent events (limited)
  const eventsToShow = recentEvents.slice(-config.maxEventsInPrompt);
  if (eventsToShow.length > 0) {
    const eventLines = eventsToShow.map(e => formatEvent(e)).join('; ');
    parts.push(`EVENTS: ${eventLines}`);
  }

  // Recent messages (limited)
  const msgsToShow = recentMessages.slice(-config.maxMessagesInPrompt);
  if (msgsToShow.length > 0) {
    const msgLines = msgsToShow.map(m =>
      `[${m.mode}] ${m.senderName}: ${m.content}`
    ).join('; ');
    parts.push(`MSGS: ${msgLines}`);
  }

  // Current plan
  if (currentPlan) {
    parts.push(`PLAN: ${currentPlan}`);
  }

  // Memory section
  if (memory) {
    const memParts: string[] = [];

    // Known agents (limit to 10)
    if (memory.knownAgents.size > 0) {
      const agents = Array.from(memory.knownAgents.values())
        .sort((a, b) => b.lastSeenTick - a.lastSeenTick)
        .slice(0, 10)
        .map(a => `${a.name}(${a.role}${a.alliance ? ',' + a.alliance : ''})`)
        .join(', ');
      memParts.push(`Known agents: ${agents}`);
    }

    // Known resources (limit to 10)
    if (memory.knownResources.length > 0) {
      const resources = memory.knownResources
        .sort((a, b) => b.lastSeenTick - a.lastSeenTick)
        .slice(0, 10)
        .map(r => `${r.type}@(${Math.round(r.position.x)},${Math.round(r.position.y)})`)
        .join(', ');
      memParts.push(`Known resources: ${resources}`);
    }

    // Threats (limit to 5)
    if (memory.threats.length > 0) {
      const threats = memory.threats
        .slice(-5)
        .map(t => `${t.attackerName}(${t.attackerRole})@(${Math.round(t.position.x)},${Math.round(t.position.y)}):${t.outcome}`)
        .join(', ');
      memParts.push(`Threats: ${threats}`);
    }

    // Trades (limit to 5)
    if (memory.trades.length > 0) {
      const trades = memory.trades
        .slice(-5)
        .map(t => `${t.partnerName}:gave=${t.gave},got=${t.received}`)
        .join(', ');
      memParts.push(`Trades: ${trades}`);
    }

    // Deaths
    if (memory.deaths.length > 0) {
      const deaths = memory.deaths.map(d =>
        `died@(${Math.round(d.position.x)},${Math.round(d.position.y)})${d.killerName ? ' by ' + d.killerName : ''}`
      ).join(', ');
      memParts.push(`Deaths: ${deaths} — AVOID these areas`);
    }

    // Recent decision outcomes (last 5)
    const recentDecisions = memory.decisions.slice(-5);
    if (recentDecisions.length > 0) {
      const outcomes = recentDecisions.map(d =>
        `${d.action}:${d.outcome}${d.rejectionReason ? '(' + d.rejectionReason + ')' : ''}`
      ).join(', ');
      memParts.push(`Recent outcomes: ${outcomes}`);
    }

    if (memParts.length > 0) {
      parts.push(`MEMORY: ${memParts.join(' | ')}`);
    }
  }

  const user = parts.join('\n');
  return { system, user };
}

function formatEvent(e: { type: string; [key: string]: unknown }): string {
  switch (e.type) {
    case 'combat_hit':
      return `hit ${e.targetId} for ${e.damage}dmg(HP:${e.targetHealthAfter})`;
    case 'death':
      return `${e.entityId} died`;
    case 'resource_gathered':
      return `gathered ${e.quantity}x ${e.item}`;
    case 'resource_depleted':
      return `resource depleted`;
    case 'trade_complete':
      return `trade done with ${e.buyer}`;
    case 'craft_complete':
      return `crafted ${e.item}`;
    case 'evolution':
      return `evolved to stage ${e.toStage}`;
    default:
      return e.type;
  }
}
