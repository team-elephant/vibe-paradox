// pipeline/validator.ts — Action validation (role checks, range, cooldowns)

import type {
  AgentAction,
  ValidatedAction,
  RejectedAction,
  Agent,
  ActionParams,
} from '../types/index.js';
import { distance } from '../types/index.js';
import type { WorldState } from '../server/world.js';
import {
  GATHER_RANGE,
  ATTACK_RANGE,
  TRADE_RANGE,
  CLIMB_RANGE,
  WORLD_SIZE,
} from '../shared/constants.js';

export class ActionValidator {
  validateBatch(
    actions: AgentAction[],
    world: WorldState,
  ): { validated: ValidatedAction[]; rejected: RejectedAction[] } {
    const validated: ValidatedAction[] = [];
    const rejected: RejectedAction[] = [];

    for (const action of actions) {
      const result = this.validateSingle(action, world);
      if ('valid' in result && result.valid) {
        validated.push(result);
      } else {
        rejected.push(result as RejectedAction);
      }
    }

    return { validated, rejected };
  }

  private validateSingle(
    action: AgentAction,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const agent = world.agents.get(action.agentId);
    if (!agent) return this.reject(action, 'Agent not found');
    if (!agent.isAlive) return this.reject(action, 'Agent is dead');
    if (agent.status === 'dead') return this.reject(action, 'Agent is dead');
    if (world.tick < agent.actionCooldown) return this.reject(action, 'On cooldown');

    switch (action.params.type) {
      case 'move':
        return this.validateMove(action, agent, world);
      case 'gather':
        return this.validateGather(action, agent, world);
      case 'attack':
        return this.validateAttack(action, agent, world);
      case 'craft':
        return this.validateCraft(action, agent, world);
      case 'talk':
        return this.validateTalk(action, agent, world);
      case 'trade':
        return this.validateTrade(action, agent, world);
      case 'plant':
        return this.validatePlant(action, agent, world);
      case 'water':
        return this.validateWater(action, agent, world);
      case 'feed':
        return this.validateFeed(action, agent, world);
      case 'climb':
        return this.validateClimb(action, agent, world);
      case 'form_alliance':
        return this.validateFormAlliance(action, agent, world);
      case 'join_alliance':
        return this.validateJoinAlliance(action, agent, world);
      case 'inspect':
        return this.approve(action);
      case 'idle':
        return this.approve(action);
      default:
        return this.reject(action, 'Unknown action type');
    }
  }

  private validateMove(
    action: AgentAction,
    _agent: Agent,
    _world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'move' }>;
    if (params.x < 0 || params.x >= WORLD_SIZE || params.y < 0 || params.y >= WORLD_SIZE) {
      return this.reject(action, 'Destination out of bounds');
    }
    return this.approve(action);
  }

  private validateGather(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role === 'monster') return this.reject(action, 'Monsters cannot gather');

    const params = action.params as Extract<ActionParams, { type: 'gather' }>;
    const target = world.resources.get(params.targetId);
    if (!target) return this.reject(action, 'Resource not found');
    if (distance(agent.position, target.position) > GATHER_RANGE) {
      return this.reject(action, 'Too far');
    }
    if (target.state !== 'available') return this.reject(action, 'Resource unavailable');

    // Fighters can only mine gold
    if (agent.role === 'fighter' && target.type !== 'gold_vein') {
      return this.reject(action, 'Fighters can only mine gold');
    }

    // Merchants cannot mine gold
    if (agent.role === 'merchant' && target.type === 'gold_vein') {
      return this.reject(action, 'Merchants cannot mine gold');
    }

    return this.approve(action);
  }

  private validateAttack(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role === 'merchant') return this.reject(action, 'Merchants cannot attack');

    const params = action.params as Extract<ActionParams, { type: 'attack' }>;

    if (params.targetId === action.agentId) return this.reject(action, 'Cannot attack yourself');

    // Find target (could be agent, NPC monster, or behemoth)
    const targetAgent = world.agents.get(params.targetId);
    const targetNpc = world.npcMonsters.get(params.targetId);
    const targetBehemoth = world.behemoths.get(params.targetId);

    if (!targetAgent && !targetNpc && !targetBehemoth) {
      return this.reject(action, 'Target not found');
    }

    // Get target position
    let targetPos;
    if (targetAgent) targetPos = targetAgent.position;
    else if (targetNpc) targetPos = targetNpc.position;
    else targetPos = targetBehemoth!.position;

    if (distance(agent.position, targetPos) > ATTACK_RANGE) {
      return this.reject(action, 'Too far');
    }

    // Fighters cannot attack other fighters
    if (agent.role === 'fighter' && targetAgent?.role === 'fighter') {
      return this.reject(action, 'Fighters cannot attack other fighters');
    }

    // Fighters cannot attack merchants
    if (agent.role === 'fighter' && targetAgent?.role === 'merchant') {
      return this.reject(action, 'Fighters cannot attack merchants');
    }

    // Check if target agent is alive
    if (targetAgent && !targetAgent.isAlive) {
      return this.reject(action, 'Target is dead');
    }

    return this.approve(action);
  }

  private validateCraft(
    action: AgentAction,
    agent: Agent,
    _world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can craft');

    // Recipe and ingredient checks are deferred to executor/economy-processor
    // since we don't have recipe data in scope here. The validator checks role only.
    const params = action.params as Extract<ActionParams, { type: 'craft' }>;
    if (!params.recipeId) return this.reject(action, 'Recipe ID required');

    return this.approve(action);
  }

  private validateTalk(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'talk' }>;

    if (!params.message || params.message.trim() === '') {
      return this.reject(action, 'Message cannot be empty');
    }

    if (params.mode === 'whisper') {
      if (!params.targetId) return this.reject(action, 'Whisper target required');
      const target = world.agents.get(params.targetId);
      if (!target) return this.reject(action, 'Whisper target not found');
    }

    return this.approve(action);
  }

  private validateTrade(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'trade' }>;

    if (params.targetAgentId === action.agentId) return this.reject(action, 'Cannot trade with yourself');

    const targetAgent = world.agents.get(params.targetAgentId);
    if (!targetAgent) return this.reject(action, 'Trade target not found');
    if (!targetAgent.isAlive) return this.reject(action, 'Trade target is dead');
    if (distance(agent.position, targetAgent.position) > TRADE_RANGE) {
      return this.reject(action, 'Too far');
    }
    if (params.offer.length === 0 && params.request.length === 0) {
      return this.reject(action, 'Trade must include offer or request');
    }

    // Check agent has offered items
    for (const item of params.offer) {
      const inv = agent.inventory.find((i) => i.id === item.itemId);
      if (!inv || inv.quantity < item.quantity) {
        return this.reject(action, 'Insufficient items for trade offer');
      }
    }

    return this.approve(action);
  }

  private validatePlant(
    action: AgentAction,
    agent: Agent,
    _world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can plant');

    const params = action.params as Extract<ActionParams, { type: 'plant' }>;

    // Check seed in inventory
    const seed = agent.inventory.find((i) => i.id === params.seedId);
    if (!seed || seed.quantity < 1) return this.reject(action, 'No seed in inventory');

    // Check position is within world bounds
    if (params.x < 0 || params.x >= WORLD_SIZE || params.y < 0 || params.y >= WORLD_SIZE) {
      return this.reject(action, 'Position out of bounds');
    }

    return this.approve(action);
  }

  private validateWater(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can water');

    const params = action.params as Extract<ActionParams, { type: 'water' }>;

    // Find sapling at position
    let foundSapling = false;
    for (const [, resource] of world.resources) {
      if (
        resource.type === 'sapling' &&
        resource.position.x === params.x &&
        resource.position.y === params.y
      ) {
        foundSapling = true;
        break;
      }
    }
    if (!foundSapling) return this.reject(action, 'No sapling at position');

    return this.approve(action);
  }

  private validateFeed(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'feed' }>;

    // Check food item in inventory
    const food = agent.inventory.find((i) => i.id === params.itemId);
    if (!food || food.quantity < 1) return this.reject(action, 'No food item in inventory');

    // Check behemoth exists and in range
    const behemoth = world.behemoths.get(params.behemothId);
    if (!behemoth) return this.reject(action, 'Behemoth not found');
    if (distance(agent.position, behemoth.position) > CLIMB_RANGE) {
      return this.reject(action, 'Too far');
    }

    return this.approve(action);
  }

  private validateClimb(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    if (agent.role !== 'merchant') return this.reject(action, 'Only merchants can climb behemoths');

    const params = action.params as Extract<ActionParams, { type: 'climb' }>;
    const behemoth = world.behemoths.get(params.behemothId);
    if (!behemoth) return this.reject(action, 'Behemoth not found');
    if (behemoth.status !== 'unconscious') return this.reject(action, 'Behemoth is not unconscious');
    if (distance(agent.position, behemoth.position) > CLIMB_RANGE) {
      return this.reject(action, 'Too far');
    }

    return this.approve(action);
  }

  private validateFormAlliance(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'form_alliance' }>;

    // Check name not taken
    if (world.alliances.has(params.name)) {
      return this.reject(action, 'Alliance name already taken');
    }

    // Check agent not already in an alliance
    if (agent.alliance !== null) {
      return this.reject(action, 'Already in an alliance');
    }

    return this.approve(action);
  }

  private validateJoinAlliance(
    action: AgentAction,
    agent: Agent,
    world: WorldState,
  ): ValidatedAction | RejectedAction {
    const params = action.params as Extract<ActionParams, { type: 'join_alliance' }>;

    // Check alliance exists
    if (!world.alliances.has(params.name)) {
      return this.reject(action, 'Alliance not found');
    }

    // Check agent not already in an alliance
    if (agent.alliance !== null) {
      return this.reject(action, 'Already in an alliance');
    }

    return this.approve(action);
  }

  private approve(action: AgentAction): ValidatedAction {
    return {
      agentId: action.agentId,
      action: action.action,
      params: action.params,
      valid: true,
    };
  }

  private reject(action: AgentAction, reason: string): RejectedAction {
    return {
      agentId: action.agentId,
      action: action.action,
      reason,
    };
  }
}
