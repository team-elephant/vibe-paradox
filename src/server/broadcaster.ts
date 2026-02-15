// server/broadcaster.ts — Per-agent state computation & broadcast

import type {
  EntityId,
  Agent,
  AgentSelfView,
  AgentPublicView,
  ChatMessage,
  ChatMessageView,
  WorldEvent,
  TickResult,
  TickUpdateData,
  ResourceView,
  MonsterView,
  BehemothView,
  StructureView,
  Resource,
  NpcMonster,
  Behemoth,
  Structure,
  ServerMessage,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from './world.js';
import type { GameWebSocketServer } from './ws-server.js';

export class StateBroadcaster {

  broadcastTick(world: WorldState, tickResult: TickResult, wsServer: GameWebSocketServer): void {
    for (const [agentId, agent] of world.agents) {
      if (!agent.isConnected) continue;

      const update: TickUpdateData = {
        tick: world.tick,
        self: this.buildSelfView(agent, world),
        nearby: {
          agents: this.getNearbyAgents(agent, world),
          resources: this.getResourcesInRadius(agent, world),
          monsters: this.getMonstersInRadius(agent, world),
          behemoths: this.getBehemothsInRadius(agent, world),
          structures: this.getStructuresInRadius(agent, world),
        },
        messages: this.filterMessages(agent, world.tickMessages),
        events: this.filterEvents(agent, tickResult.events, world),
      };

      wsServer.sendToAgent(agentId, { type: 'tick_update', data: update });

      // Send rejections for this agent
      for (const rejected of tickResult.rejected) {
        if (rejected.agentId === agentId) {
          wsServer.sendToAgent(agentId, {
            type: 'action_rejected',
            action: rejected.action,
            reason: rejected.reason,
          });
        }
      }
    }
  }

  private buildSelfView(agent: Agent, world: WorldState): AgentSelfView {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      position: agent.position,
      status: agent.status,
      health: agent.stats.health,
      maxHealth: agent.stats.maxHealth,
      attack: agent.stats.attack,
      defense: agent.stats.defense,
      speed: agent.stats.speed,
      gold: agent.gold,
      inventory: agent.inventory,
      equipment: agent.equipment,
      alliance: agent.alliance,
      kills: agent.kills,
      evolutionStage: agent.evolutionStage,
      actionCooldown: Math.max(0, agent.actionCooldown - world.tick),
    };
  }

  private getNearbyAgents(agent: Agent, world: WorldState): AgentPublicView[] {
    const radius = agent.stats.visionRadius;
    const nearby = world.getEntitiesNear(agent.position, radius);

    return nearby.agents
      .filter(a => a.id !== agent.id)
      .map(a => this.toPublicView(a));
  }

  private toPublicView(agent: Agent): AgentPublicView {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      position: agent.position,
      status: agent.status,
      health: agent.stats.health,
      maxHealth: agent.stats.maxHealth,
      alliance: agent.alliance,
      evolutionStage: agent.evolutionStage,
    };
  }

  private getResourcesInRadius(agent: Agent, world: WorldState): ResourceView[] {
    const radius = agent.stats.visionRadius;
    const nearby = world.getEntitiesNear(agent.position, radius);

    return nearby.resources.map(r => this.toResourceView(r));
  }

  private toResourceView(resource: Resource): ResourceView {
    return {
      id: resource.id,
      type: resource.type,
      position: resource.position,
      remaining: resource.remaining,
      state: resource.state,
    };
  }

  private getMonstersInRadius(agent: Agent, world: WorldState): MonsterView[] {
    const radius = agent.stats.visionRadius;
    const nearby = world.getEntitiesNear(agent.position, radius);

    // NPC monsters
    const npcViews: MonsterView[] = nearby.monsters.map(m => ({
      id: m.id,
      position: m.position,
      type: m.template,
      health: m.health,
      maxHealth: m.maxHealth,
      evolutionStage: 1,
      isNpc: true,
      status: m.status,
    }));

    // Player monsters (agents with role 'monster') that are nearby
    // These are already in nearby.agents but we also include them as monsters
    const playerMonsters: MonsterView[] = nearby.agents
      .filter(a => a.role === 'monster' && a.id !== agent.id)
      .map(a => ({
        id: a.id,
        position: a.position,
        type: 'player_monster',
        health: a.stats.health,
        maxHealth: a.stats.maxHealth,
        evolutionStage: a.evolutionStage,
        isNpc: false,
        status: a.status,
      }));

    return [...npcViews, ...playerMonsters];
  }

  private getBehemothsInRadius(agent: Agent, world: WorldState): BehemothView[] {
    const radius = agent.stats.visionRadius;
    const nearby = world.getEntitiesNear(agent.position, radius);

    return nearby.behemoths.map(b => this.toBehemothView(b, world));
  }

  private toBehemothView(behemoth: Behemoth, world: WorldState): BehemothView {
    let unconsciousTicksRemaining = 0;
    if (behemoth.status === 'unconscious' && behemoth.unconsciousUntilTick !== null) {
      unconsciousTicksRemaining = Math.max(0, behemoth.unconsciousUntilTick - world.tick);
    }

    return {
      id: behemoth.id,
      position: behemoth.position,
      type: behemoth.type,
      status: behemoth.status,
      oreAvailable: behemoth.oreAmount > 0,
      health: behemoth.health,
      maxHealth: behemoth.maxHealth,
      unconsciousTicksRemaining,
    };
  }

  private getStructuresInRadius(agent: Agent, world: WorldState): StructureView[] {
    const radius = agent.stats.visionRadius;
    const nearby = world.getEntitiesNear(agent.position, radius);

    return nearby.structures.map(s => ({
      id: s.id,
      type: s.type,
      position: s.position,
      owner: s.owner,
      alliance: s.alliance,
    }));
  }

  private filterMessages(agent: Agent, messages: ChatMessage[]): ChatMessageView[] {
    return messages
      .filter(msg => {
        if (msg.recipients === 'all') return true;
        return msg.recipients.includes(agent.id);
      })
      .map(msg => ({
        id: msg.id,
        mode: msg.mode,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        tick: msg.tick,
      }));
  }

  private filterEvents(agent: Agent, events: WorldEvent[], world: WorldState): WorldEvent[] {
    const visionRadius = agent.stats.visionRadius;

    return events.filter(event => {
      // Events about self always visible
      if (this.eventInvolvesSelf(event, agent.id)) return true;

      // Events involving entities within vision radius
      return this.eventInVisionRange(event, agent, world);
    });
  }

  private eventInvolvesSelf(event: WorldEvent, agentId: EntityId): boolean {
    switch (event.type) {
      case 'combat_hit':
        return event.attackerId === agentId || event.targetId === agentId;
      case 'death':
        return event.entityId === agentId || event.killedBy === agentId;
      case 'respawn':
        return event.agentId === agentId;
      case 'evolution':
        return event.monsterId === agentId;
      case 'resource_gathered':
        return event.agentId === agentId;
      case 'tree_planted':
        return event.agentId === agentId;
      case 'trade_proposed':
        return event.buyer === agentId || event.seller === agentId;
      case 'trade_complete':
        return event.buyer === agentId || event.seller === agentId;
      case 'craft_complete':
        return event.agentId === agentId;
      case 'alliance_formed':
        return event.founder === agentId;
      case 'alliance_joined':
        return event.agentId === agentId;
      case 'monster_eat':
        return event.eaterId === agentId || event.eatenId === agentId;
      case 'behemoth_knockout':
        return event.attackers.includes(agentId);
      case 'behemoth_wake':
        return event.thrownOff.includes(agentId);
      default:
        return false;
    }
  }

  private eventInVisionRange(event: WorldEvent, agent: Agent, world: WorldState): boolean {
    const radius = agent.stats.visionRadius;
    const eventPos = this.getEventPosition(event, world);
    if (!eventPos) return false;

    return distance(agent.position, eventPos) <= radius;
  }

  private getEventPosition(event: WorldEvent, world: WorldState): { x: number; y: number } | null {
    switch (event.type) {
      case 'combat_hit': {
        const target = world.agents.get(event.targetId)
          || world.npcMonsters.get(event.targetId)
          || world.behemoths.get(event.targetId);
        return target ? target.position : null;
      }
      case 'death': {
        const entity = world.agents.get(event.entityId)
          || world.npcMonsters.get(event.entityId);
        return entity ? entity.position : null;
      }
      case 'respawn':
        return event.position;
      case 'evolution': {
        const monster = world.agents.get(event.monsterId);
        return monster ? monster.position : null;
      }
      case 'resource_depleted':
        return event.position;
      case 'resource_gathered': {
        const resource = world.resources.get(event.resourceId);
        return resource ? resource.position : null;
      }
      case 'tree_planted':
        return event.position;
      case 'tree_grown':
        return event.position;
      case 'behemoth_knockout': {
        const behemoth = world.behemoths.get(event.behemothId);
        return behemoth ? behemoth.position : null;
      }
      case 'behemoth_wake': {
        const behemoth = world.behemoths.get(event.behemothId);
        return behemoth ? behemoth.position : null;
      }
      case 'trade_complete': {
        const buyer = world.agents.get(event.buyer);
        return buyer ? buyer.position : null;
      }
      case 'craft_complete': {
        const crafter = world.agents.get(event.agentId);
        return crafter ? crafter.position : null;
      }
      case 'alliance_formed': {
        const founder = world.agents.get(event.founder);
        return founder ? founder.position : null;
      }
      case 'alliance_joined': {
        const joiner = world.agents.get(event.agentId);
        return joiner ? joiner.position : null;
      }
      case 'npc_spawn':
        return event.position;
      case 'monster_eat': {
        const eater = world.agents.get(event.eaterId);
        return eater ? eater.position : null;
      }
      default:
        return null;
    }
  }
}
