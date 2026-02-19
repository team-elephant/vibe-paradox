// server/agent-api.ts — REST API for agent CRUD operations
// Endpoints: /api/agents/*, /api/user/settings

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import type { AuthRouter, AuthenticatedRequest } from './auth.js';
import { UsersDatabase } from './users-db.js';
import type { AgentSpawner } from './spawner.js';

const VALID_ROLES = ['fighter', 'merchant', 'monster'] as const;
const MAX_AGENT_NAME_LENGTH = 32;

type RouteHandler = (
  req: AuthenticatedRequest,
  res: ServerResponse,
  body: Record<string, unknown>,
  params: Record<string, string>,
) => Promise<void>;

// --- Agent API Router ---

export class AgentApiRouter {
  private db: UsersDatabase;
  private auth: AuthRouter;
  private spawner: AgentSpawner;
  private encryptionKey: string | null;

  constructor(
    db: UsersDatabase,
    auth: AuthRouter,
    spawner: AgentSpawner,
  ) {
    this.db = db;
    this.auth = auth;
    this.spawner = spawner;
    this.encryptionKey = process.env.ENCRYPTION_KEY || null;
  }

  /** Try to handle /api/agents/* and /api/user/* requests. Returns true if handled. */
  async handleRequest(req: AuthenticatedRequest, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method || 'GET';

    // Match routes
    const match = this.matchRoute(method, path);
    if (!match) return false;

    // All agent/user API endpoints require auth
    const user = await this.auth.authenticate(req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }
    req.user = user;

    try {
      const body = (method === 'GET' || method === 'DELETE')
        ? {}
        : await parseJsonBody(req);
      await match.handler(req, res, body, match.params);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: message });
    }

    return true;
  }

  private matchRoute(
    method: string,
    path: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    // Static routes
    if (path === '/api/agents' && method === 'GET') {
      return { handler: this.listAgents.bind(this), params: {} };
    }
    if (path === '/api/agents' && method === 'POST') {
      return { handler: this.createAgent.bind(this), params: {} };
    }
    if (path === '/api/user/settings' && method === 'PUT') {
      return { handler: this.updateSettings.bind(this), params: {} };
    }

    // Parameterized routes: /api/agents/:id/...
    const agentMatch = path.match(/^\/api\/agents\/([a-f0-9-]+)(\/\w+)?$/);
    if (!agentMatch) return null;

    const id = agentMatch[1]!;
    const action = agentMatch[2] || '';

    if (action === '/start' && method === 'POST') {
      return { handler: this.startAgent.bind(this), params: { id } };
    }
    if (action === '/stop' && method === 'POST') {
      return { handler: this.stopAgent.bind(this), params: { id } };
    }
    if (action === '/cost' && method === 'GET') {
      return { handler: this.getAgentCost.bind(this), params: { id } };
    }
    if (action === '' && method === 'DELETE') {
      return { handler: this.deleteAgent.bind(this), params: { id } };
    }

    return null;
  }

  // --- Route handlers ---

  /** GET /api/agents — list user's agents (admin sees all) */
  private async listAgents(
    req: AuthenticatedRequest,
    res: ServerResponse,
  ): Promise<void> {
    const user = req.user!;

    const agents = user.is_admin
      ? this.db.getAllAgents()
      : this.db.getAgentsByUser(user.id);

    // Enrich with live running status
    const enriched = agents.map(a => ({
      id: a.id,
      user_id: a.user_id,
      name: a.agent_name,
      role: a.agent_role,
      status: this.spawner.isRunning(a.id) ? 'running' : a.status,
      total_cost: a.total_cost,
      total_llm_calls: a.total_llm_calls,
      last_active: a.last_active,
      created_at: a.created_at,
    }));

    sendJson(res, 200, enriched);
  }

  /** POST /api/agents — create agent (checks max_agents limit) */
  private async createAgent(
    req: AuthenticatedRequest,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const user = req.user!;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const role = typeof body.role === 'string' ? body.role : '';
    const config = typeof body.config === 'object' && body.config !== null
      ? JSON.stringify(body.config)
      : undefined;

    // Validate name
    if (!name) {
      sendJson(res, 400, { error: 'Agent name is required' });
      return;
    }
    if (name.length > MAX_AGENT_NAME_LENGTH) {
      sendJson(res, 400, { error: `Agent name must be ${MAX_AGENT_NAME_LENGTH} characters or less` });
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      sendJson(res, 400, { error: 'Agent name may only contain letters, numbers, hyphens, and underscores' });
      return;
    }

    // Validate role
    if (!VALID_ROLES.includes(role as typeof VALID_ROLES[number])) {
      sendJson(res, 400, { error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }

    // Check agent limit
    const count = this.db.countAgentsByUser(user.id);
    if (count >= user.max_agents) {
      sendJson(res, 403, { error: `Agent limit reached (${user.max_agents} max)` });
      return;
    }

    const id = uuidv4();
    this.db.createAgent(id, user.id, name, role, config);

    const agent = this.db.getAgent(id)!;
    sendJson(res, 201, {
      id: agent.id,
      name: agent.agent_name,
      role: agent.agent_role,
      status: agent.status,
    });
  }

  /** POST /api/agents/:id/start — spawn agent process */
  private async startAgent(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
    params: Record<string, string>,
  ): Promise<void> {
    const user = req.user!;
    const agent = this.db.getAgent(params.id!);

    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    if (agent.user_id !== user.id && !user.is_admin) {
      sendJson(res, 403, { error: 'Not your agent' });
      return;
    }

    // Check if already running
    if (this.spawner.isRunning(agent.id)) {
      sendJson(res, 409, { error: 'Agent is already running' });
      return;
    }

    // Check API key
    const agentOwner = this.db.getUser(agent.user_id);
    if (!agentOwner?.api_key_encrypted) {
      sendJson(res, 400, { error: 'No API key configured. Set your key via PUT /api/user/settings' });
      return;
    }

    if (!this.encryptionKey) {
      sendJson(res, 500, { error: 'Server encryption key not configured' });
      return;
    }

    // Decrypt API key
    let apiKey: string;
    try {
      apiKey = UsersDatabase.decryptApiKey(agentOwner.api_key_encrypted, this.encryptionKey);
    } catch {
      sendJson(res, 500, { error: 'Failed to decrypt API key' });
      return;
    }

    // Rate limit check
    const rateCheck = this.spawner.canSpawn(user.id);
    if (!rateCheck.allowed) {
      sendJson(res, 429, {
        error: `Rate limited. Try again in ${Math.ceil(rateCheck.retryAfterMs! / 1000)}s`,
      });
      return;
    }

    // Parse config
    let model: string | undefined;
    if (agent.config) {
      try {
        const cfg = JSON.parse(agent.config) as Record<string, unknown>;
        if (typeof cfg.model === 'string') model = cfg.model;
      } catch {
        // ignore bad config
      }
    }

    try {
      const { pid } = await this.spawner.spawn({
        agentId: agent.id,
        name: agent.agent_name,
        role: agent.agent_role,
        userId: agent.user_id,
        apiKey,
        model,
      });

      sendJson(res, 200, { status: 'running', pid });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start agent';
      sendJson(res, 500, { error: message });
    }
  }

  /** POST /api/agents/:id/stop — graceful stop */
  private async stopAgent(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
    params: Record<string, string>,
  ): Promise<void> {
    const user = req.user!;
    const agent = this.db.getAgent(params.id!);

    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    if (agent.user_id !== user.id && !user.is_admin) {
      sendJson(res, 403, { error: 'Not your agent' });
      return;
    }

    await this.spawner.stop(agent.id);
    sendJson(res, 200, { status: 'stopped' });
  }

  /** DELETE /api/agents/:id — stop + delete */
  private async deleteAgent(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
    params: Record<string, string>,
  ): Promise<void> {
    const user = req.user!;
    const agent = this.db.getAgent(params.id!);

    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    if (agent.user_id !== user.id && !user.is_admin) {
      sendJson(res, 403, { error: 'Not your agent' });
      return;
    }

    // Stop if running
    if (this.spawner.isRunning(agent.id)) {
      await this.spawner.stop(agent.id);
    }

    this.db.deleteAgent(agent.id);
    sendJson(res, 200, { ok: true });
  }

  /** GET /api/agents/:id/cost — cost breakdown */
  private async getAgentCost(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
    params: Record<string, string>,
  ): Promise<void> {
    const user = req.user!;
    const agent = this.db.getAgent(params.id!);

    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    if (agent.user_id !== user.id && !user.is_admin) {
      sendJson(res, 403, { error: 'Not your agent' });
      return;
    }

    const logs = this.db.getCostLogsByAgent(agent.id);
    const now = Date.now();

    let lastHourCost = 0;
    let last24hCost = 0;

    for (const log of logs) {
      const logTime = new Date(log.created_at!).getTime();
      const ageMs = now - logTime;
      if (ageMs <= 3_600_000) lastHourCost += log.estimated_cost;
      if (ageMs <= 86_400_000) last24hCost += log.estimated_cost;
    }

    const perPlanAvg = agent.total_llm_calls > 0
      ? agent.total_cost / agent.total_llm_calls
      : 0;

    sendJson(res, 200, {
      agent_id: agent.id,
      total: agent.total_cost,
      last_hour: lastHourCost,
      last_24h: last24hCost,
      per_plan_average: perPlanAvg,
      total_llm_calls: agent.total_llm_calls,
    });
  }

  /** PUT /api/user/settings — store encrypted API key */
  private async updateSettings(
    req: AuthenticatedRequest,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const user = req.user!;
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    if (!apiKey) {
      sendJson(res, 400, { error: 'api_key is required' });
      return;
    }

    if (!this.encryptionKey) {
      sendJson(res, 500, { error: 'Server encryption key not configured (ENCRYPTION_KEY env)' });
      return;
    }

    const encrypted = UsersDatabase.encryptApiKey(apiKey, this.encryptionKey);
    this.db.updateApiKey(user.id, encrypted);

    sendJson(res, 200, { ok: true, has_api_key: true });
  }
}

// --- Helpers ---

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}
