// pipeline/combat-resolver.ts — Combat math per tick

import type {
  EntityId,
  Tick,
  Agent,
  NpcMonster,
  Behemoth,
  CombatPair,
  CombatStats,
  InventoryItem,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import {
  ATTACK_RANGE,
  RESPAWN_TICKS,
  DEATH_LOSS_PERCENT,
  SPAWN_POINT,
  EVOLUTION_THRESHOLDS,
} from '../shared/constants.js';

/**
 * CombatResolver processes all active combat pairs each tick.
 * It handles damage, death, monster eating, and evolution.
 */
export class CombatResolver {
  resolveCombat(
    combatPairs: CombatPair[],
    world: WorldState,
    tick: Tick,
  ): void {
    for (const pair of combatPairs) {
      if (!pair.active) continue;

      const attackerAgent = world.agents.get(pair.attackerId);
      const attackerNpc = world.npcMonsters.get(pair.attackerId);
      const defenderAgent = world.agents.get(pair.targetId);
      const defenderNpc = world.npcMonsters.get(pair.targetId);
      const defenderBehemoth = world.behemoths.get(pair.targetId);

      const attacker = attackerAgent ?? attackerNpc;
      const defender = defenderAgent ?? defenderNpc ?? defenderBehemoth;

      if (!attacker || !defender) {
        pair.active = false;
        continue;
      }

      // Guard: skip if either combatant is already dead
      if (this.isDead(attackerAgent, attackerNpc) || this.isDead(defenderAgent, defenderNpc)) {
        pair.active = false;
        if (attackerAgent && attackerAgent.status === 'fighting') {
          attackerAgent.status = 'idle';
        }
        if (defenderAgent && defenderAgent.status === 'fighting') {
          defenderAgent.status = 'idle';
        }
        continue;
      }

      // Check range — end combat if out of range
      if (distance(attacker.position, defender.position) > ATTACK_RANGE) {
        pair.active = false;
        if (attackerAgent && attackerAgent.status === 'fighting') {
          attackerAgent.status = 'idle';
        }
        if (defenderAgent && defenderAgent.status === 'fighting') {
          defenderAgent.status = 'idle';
        }
        continue;
      }

      // Attacker hits defender
      const attackerStats = this.getEffectiveStats(attackerAgent, attackerNpc);
      const defenderStats = this.getEffectiveStats(defenderAgent, defenderNpc, defenderBehemoth);

      const dmg = Math.max(1, attackerStats.attack - defenderStats.defense);
      this.applyDamage(defenderAgent, defenderNpc, defenderBehemoth, dmg);

      const defenderHealthAfter = this.getHealth(defenderAgent, defenderNpc, defenderBehemoth);

      world.tickEvents.push({
        type: 'combat_hit',
        attackerId: pair.attackerId,
        targetId: pair.targetId,
        damage: dmg,
        targetHealthAfter: defenderHealthAfter,
      });

      // Check defender death (behemoths don't die through combat — handled by behemoth-processor TASK-017)
      if (defenderHealthAfter <= 0 && !defenderBehemoth) {
        this.handleDeath(
          pair.targetId,
          defenderAgent,
          defenderNpc,
          pair.attackerId,
          attackerAgent,
          world,
          tick,
        );
        pair.active = false;
        if (attackerAgent && attackerAgent.status === 'fighting') {
          attackerAgent.status = 'idle';
        }
        continue;
      }

      // Counter-attack: defender fights back if fighter or monster (NOT merchant, NOT behemoth)
      if (!defenderBehemoth && this.canCounterAttack(defenderAgent, defenderNpc)) {
        const counterDmg = Math.max(1, defenderStats.attack - attackerStats.defense);
        this.applyDamage(attackerAgent, attackerNpc, undefined, counterDmg);

        const attackerHealthAfter = this.getHealth(attackerAgent, attackerNpc);

        world.tickEvents.push({
          type: 'combat_hit',
          attackerId: pair.targetId,
          targetId: pair.attackerId,
          damage: counterDmg,
          targetHealthAfter: attackerHealthAfter,
        });

        // Check attacker death from counter
        if (attackerHealthAfter <= 0) {
          this.handleDeath(
            pair.attackerId,
            attackerAgent,
            attackerNpc,
            pair.targetId,
            defenderAgent,
            world,
            tick,
          );
          pair.active = false;
          if (defenderAgent && defenderAgent.status === 'fighting') {
            defenderAgent.status = 'idle';
          }
          continue;
        }
      }
    }
  }

  private isDead(
    agentRef: Agent | undefined,
    npcRef: NpcMonster | undefined,
  ): boolean {
    if (agentRef) {
      return agentRef.status === 'dead' || !agentRef.isAlive;
    }
    if (npcRef) {
      return npcRef.health <= 0;
    }
    return false;
  }

  private getHealth(
    agentRef: Agent | undefined,
    npcRef: NpcMonster | undefined,
    behemothRef?: Behemoth | undefined,
  ): number {
    if (agentRef) return agentRef.stats.health;
    if (npcRef) return npcRef.health;
    if (behemothRef) return behemothRef.health;
    return 0;
  }

  private getEffectiveStats(
    agentRef: Agent | undefined,
    npcRef: NpcMonster | undefined,
    behemothRef?: Behemoth | undefined,
  ): { attack: number; defense: number } {
    if (agentRef) {
      // Equipment bonuses will be handled when items system is wired (TASK-018)
      return {
        attack: agentRef.stats.attack,
        defense: agentRef.stats.defense,
      };
    }
    if (npcRef) {
      return {
        attack: npcRef.attack,
        defense: npcRef.defense,
      };
    }
    if (behemothRef) {
      return {
        attack: behemothRef.attack,
        defense: behemothRef.defense,
      };
    }
    return { attack: 0, defense: 0 };
  }

  private applyDamage(
    agentRef: Agent | undefined,
    npcRef: NpcMonster | undefined,
    behemothRef: Behemoth | undefined,
    damage: number,
  ): void {
    if (agentRef) {
      agentRef.stats.health -= damage;
    } else if (npcRef) {
      npcRef.health -= damage;
    } else if (behemothRef) {
      behemothRef.health -= damage;
    }
  }

  private canCounterAttack(
    agentRef: Agent | undefined,
    npcRef: NpcMonster | undefined,
  ): boolean {
    if (agentRef) {
      return agentRef.role !== 'merchant';
    }
    // NPC monsters can always fight back
    if (npcRef) return true;
    return false;
  }

  private handleDeath(
    deadId: EntityId,
    deadAgent: Agent | undefined,
    deadNpc: NpcMonster | undefined,
    killerId: EntityId,
    killerAgent: Agent | undefined,
    world: WorldState,
    tick: Tick,
  ): void {
    if (deadNpc) {
      // NPC monster: drop gold to killer, remove from world
      const goldDrop = deadNpc.goldDrop;
      if (killerAgent) {
        killerAgent.gold += goldDrop;
      }

      world.tickEvents.push({
        type: 'death',
        entityId: deadId,
        killedBy: killerId,
        droppedGold: goldDrop,
        droppedItems: [],
      });

      world.removeNpcMonster(deadId);

      // If killer is a player monster, track kills and check eat
      if (killerAgent?.role === 'monster') {
        killerAgent.kills++;
        this.monsterEat(killerAgent, deadNpc, world);
        this.checkEvolution(killerAgent, world);
      }

      return;
    }

    if (deadAgent) {
      if (deadAgent.role === 'monster') {
        // Player monster: PERMADEATH
        deadAgent.status = 'dead';
        deadAgent.isAlive = false;
        deadAgent.stats.health = 0;

        // Calculate gold dropped
        const droppedGold = deadAgent.gold;
        if (killerAgent) {
          killerAgent.gold += droppedGold;
        }
        deadAgent.gold = 0;

        world.tickEvents.push({
          type: 'death',
          entityId: deadId,
          killedBy: killerId,
          droppedGold,
          droppedItems: [],
        });

        // If killer is a player monster, track kills and check eat
        if (killerAgent?.role === 'monster' && killerAgent.id !== deadId) {
          killerAgent.kills++;
          this.monsterEatAgent(killerAgent, deadAgent, world);
          this.checkEvolution(killerAgent, world);
        }
      } else {
        // Merchant or Fighter: lose 20% gold + inventory, respawn at spawn
        const droppedGold = Math.floor(deadAgent.gold * DEATH_LOSS_PERCENT);
        const droppedItems = this.dropRandomItems(deadAgent.inventory, DEATH_LOSS_PERCENT);

        deadAgent.gold = deadAgent.gold - droppedGold;
        deadAgent.status = 'dead';
        deadAgent.stats.health = 0;
        deadAgent.respawnTick = tick + RESPAWN_TICKS;
        deadAgent.destination = null;

        // Move to spawn point
        world.moveAgent(deadId, { x: SPAWN_POINT.x, y: SPAWN_POINT.y });

        // Give dropped gold to killer
        if (killerAgent) {
          killerAgent.gold += droppedGold;
        }

        world.tickEvents.push({
          type: 'death',
          entityId: deadId,
          killedBy: killerId,
          droppedGold,
          droppedItems,
        });

        // If killer is a monster, track kills + evolution
        if (killerAgent?.role === 'monster') {
          killerAgent.kills++;
          this.checkEvolution(killerAgent, world);
        }
      }
    }
  }

  private monsterEat(
    eater: Agent,
    eaten: NpcMonster,
    world: WorldState,
  ): void {
    const statGain: Partial<CombatStats> = {
      maxHealth: Math.floor(eaten.maxHealth * 0.1),
      attack: Math.floor(eaten.attack * 0.1),
      defense: Math.floor(eaten.defense * 0.1),
    };

    eater.stats.maxHealth += statGain.maxHealth!;
    eater.stats.health += statGain.maxHealth!; // heal on eat
    eater.stats.attack += statGain.attack!;
    eater.stats.defense += statGain.defense!;
    eater.monsterEats++;

    world.tickEvents.push({
      type: 'monster_eat',
      eaterId: eater.id,
      eatenId: eaten.id,
      statsGained: statGain,
    });
  }

  private monsterEatAgent(
    eater: Agent,
    eaten: Agent,
    world: WorldState,
  ): void {
    const statGain: Partial<CombatStats> = {
      maxHealth: Math.floor(eaten.stats.maxHealth * 0.1),
      attack: Math.floor(eaten.stats.attack * 0.1),
      defense: Math.floor(eaten.stats.defense * 0.1),
    };

    eater.stats.maxHealth += statGain.maxHealth!;
    eater.stats.health += statGain.maxHealth!; // heal on eat
    eater.stats.attack += statGain.attack!;
    eater.stats.defense += statGain.defense!;
    eater.monsterEats++;

    world.tickEvents.push({
      type: 'monster_eat',
      eaterId: eater.id,
      eatenId: eaten.id,
      statsGained: statGain,
    });
  }

  private checkEvolution(
    monster: Agent,
    world: WorldState,
  ): void {
    if (monster.role !== 'monster') return;

    for (const threshold of EVOLUTION_THRESHOLDS) {
      if (monster.evolutionStage >= threshold.stage) continue;

      // Check if monster meets either kills OR eats requirement
      if (monster.kills >= threshold.kills || monster.monsterEats >= threshold.eats) {
        const fromStage = monster.evolutionStage;
        monster.evolutionStage = threshold.stage;

        // Scale stats from previous stage multiplier to new stage multiplier.
        // This preserves bonuses accumulated from eating.
        const prevThreshold = EVOLUTION_THRESHOLDS.find(t => t.stage === fromStage);
        const prevAttackMult = prevThreshold?.attackMult ?? 1;
        const prevHealthMult = prevThreshold?.healthMult ?? 1;

        const attackScale = threshold.attackMult / prevAttackMult;
        const healthScale = threshold.healthMult / prevHealthMult;

        monster.stats.attack = Math.floor(monster.stats.attack * attackScale);
        monster.stats.maxHealth = Math.floor(monster.stats.maxHealth * healthScale);

        // Heal to new max on evolution
        monster.stats.health = monster.stats.maxHealth;

        world.tickEvents.push({
          type: 'evolution',
          monsterId: monster.id,
          fromStage,
          toStage: threshold.stage,
        });

        // Only evolve one stage at a time
        break;
      }
    }
  }

  private dropRandomItems(
    inventory: InventoryItem[],
    lossPercent: number,
  ): string[] {
    const dropped: string[] = [];
    for (const item of inventory) {
      const lostQty = Math.floor(item.quantity * lossPercent);
      if (lostQty > 0) {
        item.quantity -= lostQty;
        for (let i = 0; i < lostQty; i++) {
          dropped.push(item.id);
        }
      }
    }
    // Remove empty stacks
    for (let i = inventory.length - 1; i >= 0; i--) {
      if (inventory[i].quantity <= 0) {
        inventory.splice(i, 1);
      }
    }
    return dropped;
  }
}
