// server/world.ts — In-memory world state

import type {
  EntityId,
  Position,
  Tick,
  Agent,
  Resource,
  NpcMonster,
  Behemoth,
  Structure,
  Alliance,
  Trade,
  CraftingJob,
  ChatMessage,
  WorldEvent,
} from '../types/index.js';
import { distance } from '../types/index.js';
import { ChunkManager } from './chunk-manager.js';

export interface NearbyEntities {
  agents: Agent[];
  resources: Resource[];
  monsters: NpcMonster[];
  behemoths: Behemoth[];
  structures: Structure[];
}

export class WorldState {
  tick: Tick = 0;
  seed: number;

  agents: Map<EntityId, Agent> = new Map();
  resources: Map<EntityId, Resource> = new Map();
  npcMonsters: Map<EntityId, NpcMonster> = new Map();
  behemoths: Map<EntityId, Behemoth> = new Map();
  structures: Map<EntityId, Structure> = new Map();
  alliances: Map<string, Alliance> = new Map();

  chunkManager: ChunkManager;

  pendingTrades: Map<string, Trade> = new Map();
  craftingQueue: Map<string, CraftingJob> = new Map();

  tickMessages: ChatMessage[] = [];
  tickEvents: WorldEvent[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.chunkManager = new ChunkManager();
  }

  // --- Agent methods ---

  addAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.chunkManager.addEntity(agent.id, agent.position);
  }

  removeAgent(id: EntityId): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    this.chunkManager.removeEntity(id, agent.position);
    this.agents.delete(id);
  }

  moveAgent(id: EntityId, newPos: Position): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    const oldPos = agent.position;
    this.chunkManager.moveEntity(id, oldPos, newPos);
    agent.position = newPos;
  }

  // --- Resource methods ---

  addResource(resource: Resource): void {
    this.resources.set(resource.id, resource);
    this.chunkManager.addEntity(resource.id, resource.position);
  }

  removeResource(id: EntityId): void {
    const resource = this.resources.get(id);
    if (!resource) return;
    this.chunkManager.removeEntity(id, resource.position);
    this.resources.delete(id);
  }

  moveResource(id: EntityId, newPos: Position): void {
    const resource = this.resources.get(id);
    if (!resource) return;
    const oldPos = resource.position;
    this.chunkManager.moveEntity(id, oldPos, newPos);
    resource.position = newPos;
  }

  // --- NPC Monster methods ---

  addNpcMonster(monster: NpcMonster): void {
    this.npcMonsters.set(monster.id, monster);
    this.chunkManager.addEntity(monster.id, monster.position);
  }

  removeNpcMonster(id: EntityId): void {
    const monster = this.npcMonsters.get(id);
    if (!monster) return;
    this.chunkManager.removeEntity(id, monster.position);
    this.npcMonsters.delete(id);
  }

  moveNpcMonster(id: EntityId, newPos: Position): void {
    const monster = this.npcMonsters.get(id);
    if (!monster) return;
    const oldPos = monster.position;
    this.chunkManager.moveEntity(id, oldPos, newPos);
    monster.position = newPos;
  }

  // --- Behemoth methods ---

  addBehemoth(behemoth: Behemoth): void {
    this.behemoths.set(behemoth.id, behemoth);
    this.chunkManager.addEntity(behemoth.id, behemoth.position);
  }

  removeBehemoth(id: EntityId): void {
    const behemoth = this.behemoths.get(id);
    if (!behemoth) return;
    this.chunkManager.removeEntity(id, behemoth.position);
    this.behemoths.delete(id);
  }

  moveBehemoth(id: EntityId, newPos: Position): void {
    const behemoth = this.behemoths.get(id);
    if (!behemoth) return;
    const oldPos = behemoth.position;
    this.chunkManager.moveEntity(id, oldPos, newPos);
    behemoth.position = newPos;
  }

  // --- Structure methods ---

  addStructure(structure: Structure): void {
    this.structures.set(structure.id, structure);
    this.chunkManager.addEntity(structure.id, structure.position);
  }

  removeStructure(id: EntityId): void {
    const structure = this.structures.get(id);
    if (!structure) return;
    this.chunkManager.removeEntity(id, structure.position);
    this.structures.delete(id);
  }

  moveStructure(id: EntityId, newPos: Position): void {
    const structure = this.structures.get(id);
    if (!structure) return;
    const oldPos = structure.position;
    this.chunkManager.moveEntity(id, oldPos, newPos);
    structure.position = newPos;
  }

  // --- Spatial query ---

  getEntitiesNear(pos: Position, radius: number): NearbyEntities {
    const entityIds = this.chunkManager.getEntitiesInRadius(pos, radius);
    const idSet = new Set(entityIds);

    const agents: Agent[] = [];
    const resources: Resource[] = [];
    const monsters: NpcMonster[] = [];
    const behemoths: Behemoth[] = [];
    const structures: Structure[] = [];

    for (const id of idSet) {
      const agent = this.agents.get(id);
      if (agent && distance(pos, agent.position) <= radius) {
        agents.push(agent);
        continue;
      }

      const resource = this.resources.get(id);
      if (resource && distance(pos, resource.position) <= radius) {
        resources.push(resource);
        continue;
      }

      const npc = this.npcMonsters.get(id);
      if (npc && distance(pos, npc.position) <= radius) {
        monsters.push(npc);
        continue;
      }

      const behemoth = this.behemoths.get(id);
      if (behemoth && distance(pos, behemoth.position) <= radius) {
        behemoths.push(behemoth);
        continue;
      }

      const structure = this.structures.get(id);
      if (structure && distance(pos, structure.position) <= radius) {
        structures.push(structure);
        continue;
      }
    }

    return { agents, resources, monsters, behemoths, structures };
  }
}
