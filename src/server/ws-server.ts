// server/ws-server.ts — WebSocket connection handler

import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'node:http';
import type {
  EntityId,
  AgentRole,
  Agent,
  ClientMessage,
  ServerMessage,
  RawAction,
  ActionType,
} from '../types/index.js';
import type { WorldState } from './world.js';
import type { ActionQueue } from '../pipeline/action-queue.js';
import { BASE_STATS, VISION_RADIUS, SPAWN_POINT } from '../shared/constants.js';
import { generateAgentId } from '../shared/utils.js';

type ConnectionState = 'connecting' | 'selecting_role' | 'playing';

interface ConnectedAgent {
  ws: WebSocket;
  agentId: EntityId | null;
  state: ConnectionState;
  name: string | null;
}

const AVAILABLE_ROLES: AgentRole[] = ['merchant', 'fighter', 'monster'];

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private httpServer: HttpServer;
  private ownsHttpServer: boolean;
  private connections: Map<WebSocket, ConnectedAgent> = new Map();
  private agentConnections: Map<EntityId, WebSocket> = new Map();
  private nameToAgentId: Map<string, EntityId> = new Map();
  private world: WorldState;
  private actionQueue: ActionQueue;

  constructor(
    portOrServer: number | HttpServer,
    world: WorldState,
    actionQueue: ActionQueue,
  ) {
    this.world = world;
    this.actionQueue = actionQueue;

    if (typeof portOrServer === 'number') {
      this.httpServer = createServer();
      this.ownsHttpServer = true;
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.httpServer.listen(portOrServer);
    } else {
      this.httpServer = portOrServer;
      this.ownsHttpServer = false;
      this.wss = new WebSocketServer({ server: this.httpServer });
    }

    this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws));

    // Build name→agentId index from existing world state
    for (const [id, agent] of world.agents) {
      this.nameToAgentId.set(agent.name, id);
    }
  }

  ready(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer.listening) {
        resolve();
      } else {
        this.httpServer.on('listening', () => resolve());
      }
    });
  }

  private handleConnection(ws: WebSocket): void {
    const conn: ConnectedAgent = { ws, agentId: null, state: 'connecting', name: null };
    this.connections.set(ws, conn);

    ws.on('message', (data: Buffer | string) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return; // silently drop malformed JSON
      }
      this.handleMessage(ws, conn, msg);
    });

    ws.on('close', () => this.handleDisconnect(ws, conn));

    // Send auth prompt
    this.send(ws, { type: 'auth_prompt' });
  }

  private handleMessage(ws: WebSocket, conn: ConnectedAgent, msg: ClientMessage): void {
    switch (conn.state) {
      case 'connecting':
        if (msg.type === 'auth') this.handleAuth(ws, conn, msg);
        break;
      case 'selecting_role':
        if (msg.type === 'select_role') this.handleRoleSelection(ws, conn, msg);
        break;
      case 'playing':
        if (msg.type === 'action') this.handleAction(conn, msg);
        if (msg.type === 'ping') this.send(ws, { type: 'pong', serverTick: this.world.tick });
        break;
    }
  }

  private handleAuth(
    ws: WebSocket,
    conn: ConnectedAgent,
    msg: Extract<ClientMessage, { type: 'auth' }>,
  ): void {
    const name = msg.name;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      this.send(ws, { type: 'auth_error', reason: 'Name is required' });
      return;
    }

    const trimmedName = name.trim();

    // Check if an agent with this name already exists (reconnection)
    const existingAgentId = this.nameToAgentId.get(trimmedName);
    if (existingAgentId) {
      const existingAgent = this.world.agents.get(existingAgentId);
      if (existingAgent) {
        // Check if another WS is currently connected as this agent
        const existingWs = this.agentConnections.get(existingAgentId);
        if (existingWs && existingWs !== ws && existingWs.readyState === 1) {
          this.send(ws, { type: 'auth_error', reason: 'Name taken' });
          return;
        }

        // Reconnection: resume existing agent
        conn.agentId = existingAgentId;
        conn.name = trimmedName;
        conn.state = 'playing';
        existingAgent.isConnected = true;
        this.agentConnections.set(existingAgentId, ws);

        this.send(ws, { type: 'auth_success', agentId: existingAgentId });
        this.send(ws, {
          type: 'role_confirmed',
          role: existingAgent.role,
          agentId: existingAgentId,
          spawnPosition: existingAgent.position,
        });
        return;
      }
    }

    // New agent — proceed to role selection
    conn.name = trimmedName;
    conn.state = 'selecting_role';
    this.send(ws, { type: 'auth_success', agentId: '' }); // agentId assigned after role selection
    this.send(ws, { type: 'role_prompt', availableRoles: AVAILABLE_ROLES });
  }

  private handleRoleSelection(
    ws: WebSocket,
    conn: ConnectedAgent,
    msg: Extract<ClientMessage, { type: 'select_role' }>,
  ): void {
    const role = msg.role;

    if (!AVAILABLE_ROLES.includes(role)) {
      this.send(ws, { type: 'auth_error', reason: `Invalid role: ${role}` });
      return;
    }

    const agentId = generateAgentId();
    const stats = BASE_STATS[role];
    const visionKey = role === 'monster' ? 'monster_s1' : role;
    const visionRadius = VISION_RADIUS[visionKey];

    const agent: Agent = {
      id: agentId,
      name: conn.name!,
      role,
      position: { ...SPAWN_POINT },
      destination: null,
      status: 'idle',
      stats: {
        health: stats.health,
        maxHealth: stats.health,
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed,
        visionRadius,
      },
      gold: 0,
      inventory: [],
      equipment: { weapon: null, armor: null, tool: null },
      alliance: null,
      kills: 0,
      monsterEats: 0,
      evolutionStage: 1,
      actionCooldown: 0,
      respawnTick: null,
      connectedAt: this.world.tick,
      lastActionTick: 0,
      isAlive: true,
      isConnected: true,
    };

    this.world.addAgent(agent);
    this.nameToAgentId.set(conn.name!, agentId);
    this.agentConnections.set(agentId, ws);
    conn.agentId = agentId;
    conn.state = 'playing';

    this.send(ws, {
      type: 'role_confirmed',
      role,
      agentId,
      spawnPosition: { ...SPAWN_POINT },
    });
  }

  private handleAction(
    conn: ConnectedAgent,
    msg: Extract<ClientMessage, { type: 'action' }>,
  ): void {
    if (!conn.agentId) return;

    const rawAction: RawAction = {
      action: msg.action as ActionType,
      params: msg.params,
      tick: msg.tick,
    };

    this.actionQueue.enqueue(conn.agentId, rawAction, this.world.tick);
  }

  private handleDisconnect(ws: WebSocket, conn: ConnectedAgent): void {
    if (conn.agentId) {
      const agent = this.world.agents.get(conn.agentId);
      if (agent) {
        agent.isConnected = false;
      }
      this.agentConnections.delete(conn.agentId);
    }
    this.connections.delete(ws);
  }

  sendToAgent(agentId: EntityId, message: ServerMessage): void {
    const ws = this.agentConnections.get(agentId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcastToAll(message: ServerMessage): void {
    const msgStr = JSON.stringify(message);
    for (const [ws, conn] of this.connections) {
      if (ws.readyState === 1 && conn.state === 'playing') {
        ws.send(msgStr);
      }
    }
  }

  getConnectedCount(): number {
    let count = 0;
    for (const [, conn] of this.connections) {
      if (conn.state === 'playing') count++;
    }
    return count;
  }

  close(): void {
    for (const [ws] of this.connections) {
      ws.close();
    }
    this.connections.clear();
    this.agentConnections.clear();
    this.wss.close();
    if (this.ownsHttpServer) {
      this.httpServer.close();
    }
  }

  closeAsync(): Promise<void> {
    return new Promise((resolve) => {
      for (const [ws] of this.connections) {
        ws.close();
      }
      this.connections.clear();
      this.agentConnections.clear();
      this.wss.close(() => {
        if (this.ownsHttpServer) {
          this.httpServer.close(() => resolve());
        } else {
          resolve();
        }
      });
    });
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }
}
