// pipeline/monster-processor.ts — NPC AI behavior, spawn balancing, player monster evolution

import type {
  EntityId,
  Tick,
  NpcMonster,
  Agent,
  CombatStats,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import {
  NPC_AGGRO_RANGE,
  NPC_CHASE_RANGE,
  NPC_SPAWN_RATIO,
  NPC_SPAWN_CHECK_INTERVAL,
  NPC_MAX_SPAWN_PER_CHECK,
  ATTACK_RANGE,
  WORLD_SIZE,
  SPAWN_POINT,
  SAFE_ZONE_RADIUS,
  BASE_STATS,
  EVOLUTION_THRESHOLDS,
} from '../shared/constants.js';
import { generateNpcId } from '../shared/utils.js';
import { NPC_TEMPLATES } from '../data/world-gen.js';
import type { NpcTemplate } from '../data/world-gen.js';
import { getEvolutionStage, getEvolutionMultipliers } from '../data/evolution.js';

export class MonsterProcessor {
  /** Simple seeded state for NPC patrol randomness (non-deterministic is fine for AI) */
  private rngState: number = 1;

  tick(world: WorldState, tick: Tick): void {
    // Process each NPC monster's AI behavior
    const monsters = Array.from(world.npcMonsters.values());
    for (const monster of monsters) {
      // Skip dead monsters (shouldn't be in the map, but guard)
      if (monster.health <= 0) continue;
      this.npcTick(monster, world, tick);
    }
  }

  spawnCheck(world: WorldState, tick: Tick): void {
    if (tick % NPC_SPAWN_CHECK_INTERVAL !== 0) return;

    const humanCount = this.countHumans(world);
    const npcCount = world.npcMonsters.size;

    const targetCount = Math.floor(humanCount * NPC_SPAWN_RATIO);

    if (npcCount < targetCount) {
      const toSpawn = Math.min(NPC_MAX_SPAWN_PER_CHECK, targetCount - npcCount);
      for (let i = 0; i < toSpawn; i++) {
        this.spawnNpcInDangerousZone(world, tick);
      }
    }
  }

  checkEvolution(monster: Agent, world: WorldState, tick: Tick): void {
    const newStage = getEvolutionStage(monster.kills, monster.monsterEats);
    if (newStage <= monster.evolutionStage) return;

    const oldStage = monster.evolutionStage;
    const multipliers = getEvolutionMultipliers(newStage);
    if (!multipliers) return;

    // Apply multipliers relative to base stats
    const baseStats = BASE_STATS.monster;
    monster.stats.attack = Math.floor(baseStats.attack * multipliers.attackMult);
    monster.stats.maxHealth = Math.floor(baseStats.health * multipliers.healthMult);
    monster.stats.health = monster.stats.maxHealth; // Full heal on evolution
    monster.evolutionStage = newStage;

    world.tickEvents.push({
      type: 'evolution',
      monsterId: monster.id,
      fromStage: oldStage,
      toStage: newStage,
    });

    // Stage 4 triggers a global broadcast
    if (newStage === 4) {
      // The broadcaster will pick up this event and send to all agents
    }
  }

  monsterEat(eater: Agent, eaten: Agent | NpcMonster, world: WorldState, tick: Tick): void {
    const eatenStats = this.getEntityStats(eaten);

    const statGain: Partial<CombatStats> = {
      health: Math.floor(eatenStats.maxHealth * 0.1),
      attack: Math.floor(eatenStats.attack * 0.1),
      defense: Math.floor(eatenStats.defense * 0.1),
    };

    eater.stats.maxHealth += statGain.health!;
    eater.stats.health += statGain.health!; // Heal on eat
    eater.stats.attack += statGain.attack!;
    eater.stats.defense += statGain.defense!;
    eater.monsterEats++;

    world.tickEvents.push({
      type: 'monster_eat',
      eaterId: eater.id,
      eatenId: eaten.id,
      statsGained: statGain,
    });

    this.checkEvolution(eater, world, tick);
  }

  private npcTick(monster: NpcMonster, world: WorldState, tick: Tick): void {
    switch (monster.behavior) {
      case 'patrol':
        this.npcPatrol(monster, world, tick);
        break;
      case 'chase':
        this.npcChase(monster, world, tick);
        break;
      case 'attack':
        this.npcAttack(monster, world, tick);
        break;
      default:
        // idle or flee — do nothing for now
        break;
    }
  }

  private npcPatrol(monster: NpcMonster, world: WorldState, _tick: Tick): void {
    // Check for humans in aggro range
    const nearbyTarget = this.findNearestHuman(monster, world, NPC_AGGRO_RANGE);
    if (nearbyTarget) {
      monster.behavior = 'chase';
      monster.targetId = nearbyTarget.id;
      return;
    }

    // Random walk within patrol radius
    this.patrolWalk(monster, world);
  }

  private npcChase(monster: NpcMonster, world: WorldState, _tick: Tick): void {
    if (!monster.targetId) {
      monster.behavior = 'patrol';
      return;
    }

    const target = world.agents.get(monster.targetId);
    if (!target || target.status === 'dead' || !target.isAlive) {
      // Target gone or dead, return to patrol
      monster.behavior = 'patrol';
      monster.targetId = null;
      return;
    }

    const dist = distance(monster.position, target.position);

    // If target out of chase range, return to patrol
    if (dist > NPC_CHASE_RANGE) {
      monster.behavior = 'patrol';
      monster.targetId = null;
      return;
    }

    // If in attack range, switch to attack
    if (dist <= ATTACK_RANGE) {
      monster.behavior = 'attack';
      return;
    }

    // Move toward target
    this.moveToward(monster, target.position, world);
  }

  private npcAttack(monster: NpcMonster, world: WorldState, _tick: Tick): void {
    if (!monster.targetId) {
      monster.behavior = 'patrol';
      return;
    }

    const target = world.agents.get(monster.targetId);
    if (!target || target.status === 'dead' || !target.isAlive) {
      monster.behavior = 'patrol';
      monster.targetId = null;
      return;
    }

    const dist = distance(monster.position, target.position);

    // If target moved out of attack range, chase again
    if (dist > ATTACK_RANGE) {
      monster.behavior = 'chase';
      return;
    }

    // Combat is handled by the combat-resolver via combat pairs.
    // The NPC attack behavior here just keeps the NPC locked on target.
    // The actual damage is done in combat-resolver.ts (TASK-013).
  }

  private findNearestHuman(monster: NpcMonster, world: WorldState, range: number): Agent | null {
    let nearest: Agent | null = null;
    let nearestDist = range + 1;

    // Use chunk manager for efficient spatial query
    const entityIds = world.chunkManager.getEntitiesInRadius(monster.position, range);
    for (const id of entityIds) {
      const agent = world.agents.get(id);
      if (!agent) continue;
      // Only target living human agents (merchants and fighters)
      if (agent.role === 'monster') continue;
      if (agent.status === 'dead' || !agent.isAlive) continue;

      const dist = distance(monster.position, agent.position);
      if (dist <= range && dist < nearestDist) {
        nearest = agent;
        nearestDist = dist;
      }
    }

    return nearest;
  }

  private patrolWalk(monster: NpcMonster, world: WorldState): void {
    // Simple random walk: pick a new position within patrol radius
    // Move toward it at monster speed
    const angle = this.simpleRandom() * Math.PI * 2;
    const dist = this.simpleRandom() * monster.patrolRadius;
    const targetX = monster.patrolOrigin.x + Math.cos(angle) * dist;
    const targetY = monster.patrolOrigin.y + Math.sin(angle) * dist;

    // Clamp to world bounds
    const clampedTarget = {
      x: Math.max(0, Math.min(WORLD_SIZE - 1, targetX)),
      y: Math.max(0, Math.min(WORLD_SIZE - 1, targetY)),
    };

    this.moveToward(monster, clampedTarget, world);
  }

  private moveToward(monster: NpcMonster, target: { x: number; y: number }, world: WorldState): void {
    const dx = target.x - monster.position.x;
    const dy = target.y - monster.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= monster.speed) {
      // Arrive at target
      world.moveNpcMonster(monster.id, { x: target.x, y: target.y });
    } else {
      // Move toward target by speed units
      const nx = monster.position.x + (dx / dist) * monster.speed;
      const ny = monster.position.y + (dy / dist) * monster.speed;
      world.moveNpcMonster(monster.id, { x: nx, y: ny });
    }
  }

  private countHumans(world: WorldState): number {
    let count = 0;
    for (const [, agent] of world.agents) {
      if (agent.role !== 'monster' && agent.isAlive && agent.isConnected) {
        count++;
      }
    }
    return count;
  }

  private spawnNpcInDangerousZone(world: WorldState, tick: Tick): void {
    // Pick a random position outside safe zone
    let pos = {
      x: this.simpleRandom() * (WORLD_SIZE - 1),
      y: this.simpleRandom() * (WORLD_SIZE - 1),
    };

    // Ensure not in safe zone — retry up to 10 times
    for (let i = 0; i < 10; i++) {
      if (distance(pos, SPAWN_POINT) >= SAFE_ZONE_RADIUS) break;
      pos = {
        x: this.simpleRandom() * (WORLD_SIZE - 1),
        y: this.simpleRandom() * (WORLD_SIZE - 1),
      };
    }

    const template = this.pickTemplate();
    const goldDrop = Math.floor(
      this.simpleRandom() * (template.goldDropMax - template.goldDropMin + 1) + template.goldDropMin,
    );

    const monster: NpcMonster = {
      id: generateNpcId(),
      template: template.templateId,
      position: pos,
      health: template.health,
      maxHealth: template.maxHealth,
      attack: template.attack,
      defense: template.defense,
      speed: template.speed,
      status: 'roaming',
      behavior: 'patrol',
      patrolOrigin: { x: pos.x, y: pos.y },
      patrolRadius: template.patrolRadius,
      targetId: null,
      goldDrop,
      createdAt: tick,
    };

    world.addNpcMonster(monster);

    world.tickEvents.push({
      type: 'npc_spawn',
      monsterId: monster.id,
      position: { ...pos },
      template: template.templateId,
    });
  }

  private pickTemplate(): NpcTemplate {
    const totalWeight = NPC_TEMPLATES.reduce((sum, t) => sum + t.weight, 0);
    let roll = this.simpleRandom() * totalWeight;
    for (const template of NPC_TEMPLATES) {
      roll -= template.weight;
      if (roll <= 0) return template;
    }
    return NPC_TEMPLATES[0]!;
  }

  private getEntityStats(entity: Agent | NpcMonster): { maxHealth: number; attack: number; defense: number } {
    if ('stats' in entity) {
      // Agent
      return {
        maxHealth: entity.stats.maxHealth,
        attack: entity.stats.attack,
        defense: entity.stats.defense,
      };
    }
    // NpcMonster
    return {
      maxHealth: entity.maxHealth,
      attack: entity.attack,
      defense: entity.defense,
    };
  }

  /** Simple non-seeded RNG for NPC AI (doesn't need to be deterministic) */
  private simpleRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) & 0xffffffff;
    return (this.rngState >>> 0) / 4294967296;
  }
}
