// pipeline/executor.ts — Action execution (state mutations)

import type {
  EntityId,
  Tick,
  ValidatedAction,
  ActionParams,
  Agent,
  Alliance,
  ChatMessage,
  CombatPair,
  StateChange,
  SpawnEvent,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import { SPAWN_POINT, WORLD_SIZE } from '../shared/constants.js';
import { generateMessageId } from '../shared/utils.js';

export interface ExecutionResult {
  stateChanges: StateChange[];
  spawns: SpawnEvent[];
}

interface SingleExecutionResult {
  changes: StateChange[];
  spawns: SpawnEvent[];
}

export class ActionExecutor {
  /** Active combat pairs tracked across ticks */
  readonly combatPairs: CombatPair[] = [];

  executeBatch(
    actions: ValidatedAction[],
    world: WorldState,
    tick: Tick,
  ): ExecutionResult {
    const stateChanges: StateChange[] = [];
    const spawns: SpawnEvent[] = [];

    for (const action of actions) {
      const result = this.executeSingle(action, world, tick);
      stateChanges.push(...result.changes);
      spawns.push(...result.spawns);
    }

    return { stateChanges, spawns };
  }

  processContinuous(world: WorldState, tick: Tick): void {
    // Movement: advance all moving agents toward destination
    for (const [, agent] of world.agents) {
      if (agent.status === 'moving' && agent.destination) {
        this.advanceMovement(agent, world);
      }
    }

    // Gathering progress is handled by resource-processor (Phase 3)
    // Combat resolution is handled by combat-resolver (Phase 3)
    // Crafting progress is handled by economy-processor (Phase 3)
    // Sapling growth is handled by resource-processor (Phase 3)
  }

  processRespawns(world: WorldState, tick: Tick): void {
    for (const [, agent] of world.agents) {
      if (agent.status === 'dead' && agent.respawnTick !== null && tick >= agent.respawnTick) {
        this.respawnAgent(agent, world, tick);
      }
    }
  }

  private executeSingle(
    action: ValidatedAction,
    world: WorldState,
    tick: Tick,
  ): SingleExecutionResult {
    const agent = world.agents.get(action.agentId);
    if (!agent) return { changes: [], spawns: [] };

    switch (action.params.type) {
      case 'move':
        return this.executeMove(action.params, agent, world, tick);
      case 'gather':
        return this.executeGather(action.params, agent, world, tick);
      case 'attack':
        return this.executeAttack(action.params, agent, world, tick);
      case 'talk':
        return this.executeTalk(action.params, agent, world, tick);
      case 'idle':
        return this.executeIdle(agent);
      case 'form_alliance':
        return this.executeFormAlliance(action.params, agent, world, tick);
      case 'join_alliance':
        return this.executeJoinAlliance(action.params, agent, world, tick);
      case 'leave_alliance':
        return this.executeLeaveAlliance(agent, world, tick);
      default:
        // Other actions (craft, trade, plant, water, feed, climb,
        // inspect) are handled by their respective Phase 3 processors.
        return { changes: [], spawns: [] };
    }
  }

  private executeMove(
    params: Extract<ActionParams, { type: 'move' }>,
    agent: Agent,
    world: WorldState,
    _tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const oldStatus = agent.status;
    const oldDest = agent.destination;

    // Clamp destination to world bounds
    const destX = Math.max(0, Math.min(WORLD_SIZE - 1, params.x));
    const destY = Math.max(0, Math.min(WORLD_SIZE - 1, params.y));

    agent.destination = { x: destX, y: destY };
    agent.status = 'moving';

    changes.push({
      entityId: agent.id,
      field: 'status',
      oldValue: oldStatus,
      newValue: 'moving',
    });
    changes.push({
      entityId: agent.id,
      field: 'destination',
      oldValue: oldDest,
      newValue: agent.destination,
    });

    return { changes, spawns: [] };
  }

  private executeGather(
    params: Extract<ActionParams, { type: 'gather' }>,
    agent: Agent,
    world: WorldState,
    _tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const resource = world.resources.get(params.targetId);
    if (!resource) return { changes: [], spawns: [] };

    const oldStatus = agent.status;
    agent.status = 'gathering';

    // Mark resource as being gathered
    const oldResourceState = resource.state;
    resource.state = 'being_gathered';

    changes.push({
      entityId: agent.id,
      field: 'status',
      oldValue: oldStatus,
      newValue: 'gathering',
    });
    changes.push({
      entityId: resource.id,
      field: 'state',
      oldValue: oldResourceState,
      newValue: 'being_gathered',
    });

    return { changes, spawns: [] };
  }

  private executeAttack(
    params: Extract<ActionParams, { type: 'attack' }>,
    agent: Agent,
    world: WorldState,
    tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const oldStatus = agent.status;
    agent.status = 'fighting';

    // Create combat pair
    const pair: CombatPair = {
      attackerId: agent.id,
      targetId: params.targetId,
      startTick: tick,
      active: true,
    };
    this.combatPairs.push(pair);

    changes.push({
      entityId: agent.id,
      field: 'status',
      oldValue: oldStatus,
      newValue: 'fighting',
    });

    return { changes, spawns: [] };
  }

  private executeTalk(
    params: Extract<ActionParams, { type: 'talk' }>,
    agent: Agent,
    world: WorldState,
    tick: Tick,
  ): SingleExecutionResult {
    const msg: ChatMessage = {
      id: generateMessageId(),
      tick,
      senderId: agent.id,
      senderName: agent.name,
      mode: params.mode,
      content: params.message,
      targetId: params.targetId ?? null,
      position: { ...agent.position },
      recipients: [], // Will be set by chat processor or broadcaster
    };

    // Basic recipient logic (chat processor in Phase 3 will refine this)
    if (params.mode === 'broadcast') {
      msg.recipients = 'all';
    } else if (params.mode === 'whisper' && params.targetId) {
      msg.recipients = [agent.id, params.targetId];
    } else {
      // Local: recipients will be determined by chat processor
      // For now just add to tick messages
      msg.recipients = [];
    }

    world.tickMessages.push(msg);

    return { changes: [], spawns: [] };
  }

  private executeIdle(_agent: Agent): SingleExecutionResult {
    // No-op
    return { changes: [], spawns: [] };
  }

  private executeFormAlliance(
    params: Extract<ActionParams, { type: 'form_alliance' }>,
    agent: Agent,
    world: WorldState,
    tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const alliance: Alliance = {
      name: params.name,
      founder: agent.id,
      members: new Set([agent.id]),
      createdAt: tick,
    };

    world.alliances.set(params.name, alliance);

    const oldAlliance = agent.alliance;
    agent.alliance = params.name;

    changes.push({
      entityId: agent.id,
      field: 'alliance',
      oldValue: oldAlliance,
      newValue: params.name,
    });

    world.tickEvents.push({
      type: 'alliance_formed',
      name: params.name,
      founder: agent.id,
    });

    return { changes, spawns: [] };
  }

  private executeJoinAlliance(
    params: Extract<ActionParams, { type: 'join_alliance' }>,
    agent: Agent,
    world: WorldState,
    tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const alliance = world.alliances.get(params.name);
    if (!alliance) return { changes: [], spawns: [] };

    alliance.members.add(agent.id);

    const oldAlliance = agent.alliance;
    agent.alliance = params.name;

    changes.push({
      entityId: agent.id,
      field: 'alliance',
      oldValue: oldAlliance,
      newValue: params.name,
    });

    world.tickEvents.push({
      type: 'alliance_joined',
      name: params.name,
      agentId: agent.id,
    });

    return { changes, spawns: [] };
  }

  private executeLeaveAlliance(
    agent: Agent,
    world: WorldState,
    _tick: Tick,
  ): SingleExecutionResult {
    const changes: StateChange[] = [];

    const allianceName = agent.alliance;
    if (!allianceName) return { changes: [], spawns: [] };

    const alliance = world.alliances.get(allianceName);
    if (alliance) {
      alliance.members.delete(agent.id);
      // If alliance is empty, remove it
      if (alliance.members.size === 0) {
        world.alliances.delete(allianceName);
      }
    }

    agent.alliance = null;

    changes.push({
      entityId: agent.id,
      field: 'alliance',
      oldValue: allianceName,
      newValue: null,
    });

    return { changes, spawns: [] };
  }

  private advanceMovement(agent: Agent, world: WorldState): void {
    if (!agent.destination) return;

    const step = agent.stats.speed;
    const remaining = distance(agent.position, agent.destination);

    if (remaining <= step) {
      // Arrived
      const newPos = { ...agent.destination };
      world.moveAgent(agent.id, newPos);
      agent.destination = null;
      agent.status = 'idle';
    } else {
      // Move toward destination
      const dx = agent.destination.x - agent.position.x;
      const dy = agent.destination.y - agent.position.y;
      const norm = Math.sqrt(dx * dx + dy * dy);
      const newX = agent.position.x + (dx / norm) * step;
      const newY = agent.position.y + (dy / norm) * step;
      world.moveAgent(agent.id, { x: newX, y: newY });
    }
  }

  private respawnAgent(agent: Agent, world: WorldState, tick: Tick): void {
    // Monster permadeath: don't respawn monsters
    if (agent.role === 'monster') return;

    const oldPos = { ...agent.position };

    agent.status = 'idle';
    agent.stats.health = agent.stats.maxHealth;
    agent.destination = null;
    agent.respawnTick = null;

    world.moveAgent(agent.id, { x: SPAWN_POINT.x, y: SPAWN_POINT.y });

    world.tickEvents.push({
      type: 'respawn',
      agentId: agent.id,
      position: { ...SPAWN_POINT },
    });
  }
}
