// server/admin.ts — Admin dashboard: HTTP server + WebSocket for live state broadcast
// Auth: random key generated on startup, required as ?key= param on HTTP and WS

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
  private adminClients: Set<WebSocket> = new Set();
  private adminKey: string;

  constructor(port: number) {
    // Generate auth key
    this.adminKey = randomBytes(12).toString('base64url');

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
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      // Check auth key on WebSocket upgrade
      if (!this.checkKey(req.url || '')) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      this.adminClients.add(ws);
      ws.on('close', () => this.adminClients.delete(ws));
      ws.on('error', () => this.adminClients.delete(ws));
    });

    this.httpServer.on('error', (err: Error) => {
      console.error(`[VP] Admin server failed to start on port ${port}: ${err.message}`);
    });

    this.httpServer.listen(port);
  }

  getKey(): string {
    return this.adminKey;
  }

  private checkKey(urlStr: string): boolean {
    try {
      const url = new URL(urlStr, 'http://localhost');
      return url.searchParams.get('key') === this.adminKey;
    } catch {
      return false;
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const urlPath = (req.url || '').split('?')[0];

    if (urlPath === '/' || urlPath === '/index.html') {
      // Check auth key
      if (!this.checkKey(req.url || '')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: invalid or missing ?key= parameter');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.dashboardHtml);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  broadcastTick(world: WorldState, tickResult: TickResult): void {
    if (this.adminClients.size === 0) return;

    const payload = this.buildPayload(world, tickResult);
    const json = JSON.stringify(payload);

    for (const ws of this.adminClients) {
      if (ws.readyState === 1) {
        try {
          ws.send(json);
        } catch {
          this.adminClients.delete(ws);
        }
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
    for (const ws of this.adminClients) {
      ws.close();
    }
    this.adminClients.clear();
    this.wss.close();
    this.httpServer.close();
  }
}
