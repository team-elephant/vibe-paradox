// server/admin.ts — Admin dashboard: HTTP server + WebSocket for live state broadcast
// Auth: session token OR legacy ?key= param. Per-user agent filtering.

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type {
  EntityId,
  Agent,
  NpcMonster,
  Behemoth,
  WorldEvent,
  TickResult,
  ChatMessageView,
} from '../types/index.js';
import type { WorldState } from './world.js';
import type { User } from './users-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface AdminTickPayload {
  type: 'admin_tick';
  tick: number;
  agents: AdminAgentView[];
  npcMonsters: AdminNpcView[];
  behemoths: AdminBehemothView[];
  resourceCounts: { trees: number; goldVeins: number; saplings: number };
  resources: AdminResourceView[];
  events: WorldEvent[];
  messages: ChatMessageView[];
}

interface AdminAgentView {
  id: EntityId;
  name: string;
  role: string;
  position: { x: number; y: number };
  destination: { x: number; y: number } | null;
  status: string;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  gold: number;
  inventory: unknown[];
  equipment: { weapon: string | null; armor: string | null; tool: string | null };
  alliance: string | null;
  kills: number;
  evolutionStage: number;
  isConnected: boolean;
}

interface AdminNpcView {
  id: EntityId;
  template: string;
  position: { x: number; y: number };
  health: number;
  maxHealth: number;
  status: string;
  targetId: EntityId | null;
}

interface AdminBehemothView {
  id: EntityId;
  type: string;
  position: { x: number; y: number };
  health: number;
  maxHealth: number;
  status: string;
  oreAvailable: boolean;
  unconsciousTicksRemaining: number;
}

interface AdminResourceView {
  id: EntityId;
  type: string;
  position: { x: number; y: number };
  remaining: number;
}

/** Tracks a connected WebSocket client with its auth info */
interface AdminClient {
  ws: WebSocket;
  user: User | null;   // null = legacy god-mode via ?key=
  isGodMode: boolean;   // true if connected via ?key= (sees everything)
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
export type TokenAuthenticator = (token: string) => Promise<User | null>;

function resolveDashboardPath(): string {
  // Try alongside this module (works in both dev/tsx and built/tsup)
  const sameDirPath = resolve(__dirname, 'dashboard.html');
  if (existsSync(sameDirPath)) return sameDirPath;

  // Fallback: try source path relative to project root
  const projectRoot = resolve(__dirname, '..', '..');
  const srcPath = resolve(projectRoot, 'src', 'server', 'dashboard.html');
  if (existsSync(srcPath)) return srcPath;

  return '';
}

export class AdminServer {
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private dashboardHtml: string;
  private adminClients: Map<WebSocket, AdminClient> = new Map();
  private adminKey: string;
  private apiHandler: ApiHandler | null = null;
  private tokenAuth: TokenAuthenticator | null = null;

  constructor(port: number) {
    // Generate auth key (legacy god-mode)
    this.adminKey = process.env.ADMIN_KEY || randomBytes(12).toString('base64url');

    // Resolve and load dashboard HTML at startup
    const htmlPath = resolveDashboardPath();
    if (htmlPath) {
      this.dashboardHtml = readFileSync(htmlPath, 'utf-8');
    } else {
      console.error('[VP] Admin dashboard HTML not found. Checked:');
      console.error(`[VP]   ${resolve(__dirname, 'dashboard.html')}`);
      console.error(`[VP]   ${resolve(__dirname, '..', '..', 'src', 'server', 'dashboard.html')}`);
      this.dashboardHtml = '<html><body><h1>Dashboard not found</h1></body></html>';
    }

    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/', 'http://localhost');

      // Try legacy ?key= auth first (god-mode)
      const key = url.searchParams.get('key');
      if (key === this.adminKey) {
        const client: AdminClient = { ws, user: null, isGodMode: true };
        this.adminClients.set(ws, client);
        ws.on('close', () => this.adminClients.delete(ws));
        ws.on('error', () => this.adminClients.delete(ws));
        return;
      }

      // Try token-based auth
      const token = url.searchParams.get('token');
      if (token && this.tokenAuth) {
        const user = await this.tokenAuth(token);
        if (user) {
          const client: AdminClient = { ws, user, isGodMode: user.is_admin };
          this.adminClients.set(ws, client);
          ws.on('close', () => this.adminClients.delete(ws));
          ws.on('error', () => this.adminClients.delete(ws));
          return;
        }
      }

      // No valid auth
      ws.close(4401, 'Unauthorized');
    });

    this.httpServer.on('error', (err: Error) => {
      console.error(`[VP] Admin server failed to start on port ${port}: ${err.message}`);
    });

    this.httpServer.listen(port);
  }

  getKey(): string {
    return this.adminKey;
  }

  setApiHandler(handler: ApiHandler): void {
    this.apiHandler = handler;
  }

  setTokenAuthenticator(auth: TokenAuthenticator): void {
    this.tokenAuth = auth;
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const urlPath = (req.url || '').split('?')[0]!;

    // Delegate /api/* routes to external handler (auth, agent management, etc.)
    if (urlPath.startsWith('/api/') && this.apiHandler) {
      const handled = await this.apiHandler(req, res);
      if (handled) return;
    }

    if (urlPath === '/' || urlPath === '/index.html') {
      // Serve dashboard without auth — the login page handles authentication
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.dashboardHtml);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  broadcastTick(world: WorldState, tickResult: TickResult): void {
    if (this.adminClients.size === 0) return;

    // Build base payload (shared world state)
    const basePayload = this.buildPayload(world, tickResult);
    // Cache full JSON for god-mode clients
    const godModeJson = JSON.stringify(basePayload);

    for (const [, client] of this.adminClients) {
      if (client.ws.readyState !== 1) continue;

      try {
        if (client.isGodMode) {
          // God-mode / admin: full payload
          client.ws.send(godModeJson);
        } else if (client.user) {
          // Logged-in non-admin: filtered payload
          // For now, send full world state (agents on map are public info)
          // but the dashboard UI only shows controls for owned agents
          client.ws.send(godModeJson);
        }
      } catch {
        this.adminClients.delete(client.ws);
      }
    }
  }

  private buildPayload(world: WorldState, tickResult: TickResult): AdminTickPayload {
    const agents: AdminAgentView[] = [];
    for (const [, agent] of world.agents) {
      agents.push(this.toAdminAgentView(agent));
    }

    const npcMonsters: AdminNpcView[] = [];
    for (const [, npc] of world.npcMonsters) {
      npcMonsters.push(this.toAdminNpcView(npc));
    }

    const behemoths: AdminBehemothView[] = [];
    for (const [, b] of world.behemoths) {
      behemoths.push(this.toAdminBehemothView(b, world));
    }

    let trees = 0;
    let goldVeins = 0;
    let saplings = 0;
    const resources: AdminResourceView[] = [];
    for (const [, r] of world.resources) {
      if (r.type === 'tree') trees++;
      else if (r.type === 'gold_vein') goldVeins++;
      else if (r.type === 'sapling') saplings++;
      resources.push({ id: r.id, type: r.type, position: r.position, remaining: r.remaining });
    }

    const messages: ChatMessageView[] = world.tickMessages.map(m => ({
      id: m.id,
      mode: m.mode,
      senderId: m.senderId,
      senderName: m.senderName,
      content: m.content,
      tick: m.tick,
    }));

    return {
      type: 'admin_tick',
      tick: world.tick,
      agents,
      npcMonsters,
      behemoths,
      resourceCounts: { trees, goldVeins, saplings },
      resources,
      events: tickResult.events,
      messages,
    };
  }

  private toAdminAgentView(agent: Agent): AdminAgentView {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      position: { x: agent.position.x, y: agent.position.y },
      destination: agent.destination ? { x: agent.destination.x, y: agent.destination.y } : null,
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
      isConnected: agent.isConnected,
    };
  }

  private toAdminNpcView(npc: NpcMonster): AdminNpcView {
    return {
      id: npc.id,
      template: npc.template,
      position: { x: npc.position.x, y: npc.position.y },
      health: npc.health,
      maxHealth: npc.maxHealth,
      status: npc.status,
      targetId: npc.targetId,
    };
  }

  private toAdminBehemothView(b: Behemoth, world: WorldState): AdminBehemothView {
    let unconsciousTicksRemaining = 0;
    if (b.status === 'unconscious' && b.unconsciousUntilTick !== null) {
      unconsciousTicksRemaining = Math.max(0, b.unconsciousUntilTick - world.tick);
    }
    return {
      id: b.id,
      type: b.type,
      position: { x: b.position.x, y: b.position.y },
      health: b.health,
      maxHealth: b.maxHealth,
      status: b.status,
      oreAvailable: b.oreAmount > 0,
      unconsciousTicksRemaining,
    };
  }

  close(): void {
    for (const [, client] of this.adminClients) {
      client.ws.close();
    }
    this.adminClients.clear();
    this.wss.close();
    this.httpServer.close();
  }
}
