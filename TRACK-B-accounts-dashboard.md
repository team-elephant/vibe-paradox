# TRACK B — User Accounts + Agent Management Dashboard

## Overview

Transform the admin dashboard from a single-key god-mode viewer into a multi-user platform where feature owners can create accounts, spawn agents, monitor their agents, and manage costs. This is the product surface — the thing people interact with.

## Architecture

```
Browser (dashboard)
    │
    ▼
[HTTP] Auth endpoints (signup/login/session)
    │
    ▼
[WS] Admin WebSocket (per-user filtered view)
    │
    ▼
[HTTP] Agent management API (spawn/stop/configure)
    │
    ▼
SQLite (users, agents, sessions, cost_logs)
```

## Files to Create/Modify

### New files:
- `src/server/auth.ts` — User authentication (signup, login, sessions)
- `src/server/users-db.ts` — User + agent ownership DB schema and queries
- `src/server/agent-api.ts` — REST API for agent CRUD operations
- `src/server/spawner.ts` — Server-side agent process manager

### Modify:
- `src/server/admin.ts` — Add auth middleware, per-user WebSocket filtering
- `src/server/dashboard.html` — Login UI, agent management panel, spawn controls
- `src/server/index.ts` — Wire new routes

### Do NOT modify:
- `agent/*` — Track A territory
- `src/server/ws-server.ts` — Game server WebSocket (port 8080) stays unchanged
- Core game logic files

---

## 1. Database Schema (`users-db.ts`)

Add tables to the existing SQLite database (or a separate `admin.db`):

```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- UUID
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,    -- bcrypt
  api_key_encrypted TEXT,         -- User's Anthropic API key (encrypted at rest)
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  max_agents INTEGER DEFAULT 3,  -- Agent limit per user
  is_admin BOOLEAN DEFAULT 0     -- Admin can see all agents, manage users
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,         -- Secure random token
  user_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Agent ownership
CREATE TABLE IF NOT EXISTS user_agents (
  id TEXT PRIMARY KEY,            -- UUID
  user_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,       -- e.g., "Fighter_001"
  agent_role TEXT NOT NULL,       -- fighter | merchant | monster
  status TEXT DEFAULT 'stopped',  -- stopped | starting | running | error
  process_pid INTEGER,            -- OS process ID when running
  config TEXT,                    -- JSON: model, temperature, custom prompt
  total_cost REAL DEFAULT 0,      -- Cumulative API cost in USD
  total_llm_calls INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_active TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Cost log (append-only)
CREATE TABLE IF NOT EXISTS cost_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tick INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  estimated_cost REAL,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES user_agents(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 2. Authentication (`auth.ts`)

Simple session-based auth. No OAuth, no JWT complexity.

### Endpoints:

```
POST /api/auth/signup
  Body: { username, password }
  → Creates user, returns session token
  → Password requirements: min 8 chars

POST /api/auth/login
  Body: { username, password }
  → Validates credentials, returns session token

POST /api/auth/logout
  Header: Authorization: Bearer <token>
  → Invalidates session

GET /api/auth/me
  Header: Authorization: Bearer <token>
  → Returns user info (id, username, max_agents, is_admin)
```

### Session handling:
- Token: 32-byte crypto random, hex encoded
- Expiry: 7 days
- Stored in SQLite sessions table
- Passed via `Authorization: Bearer <token>` header or `?token=<token>` query param (for WebSocket)

### Password:
- Hash with bcrypt (cost factor 10)
- npm: `bcryptjs` (pure JS, no native deps)

### First user bootstrap:
- On first startup, if no users exist, create admin user from env vars:
  ```
  ADMIN_USERNAME=admin
  ADMIN_PASSWORD=<set-in-env>
  ```
- Or: first signup automatically gets admin role

### Middleware:
```typescript
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  const session = await db.getSession(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = await db.getUser(session.user_id);
  next();
}
```

---

## 3. Agent Management API (`agent-api.ts`)

### Endpoints:

```
GET /api/agents
  → List user's agents (admin sees all)
  → Response: [{ id, name, role, status, total_cost, total_llm_calls, last_active }]

POST /api/agents
  Body: { name, role, config? }
  → Create agent (checks max_agents limit)
  → Does NOT start the agent — just registers it

POST /api/agents/:id/start
  → Start the agent process (calls spawner)
  → Requires user's API key to be set

POST /api/agents/:id/stop
  → Stop the agent process (graceful SIGTERM)

DELETE /api/agents/:id
  → Stop if running, then delete

GET /api/agents/:id/cost
  → Cost breakdown: total, last hour, last 24h, per-plan average

PUT /api/user/settings
  Body: { api_key }
  → Store encrypted Anthropic API key
  → Encrypted with server-side secret (env: ENCRYPTION_KEY)
```

### Limits:
- Default 3 agents per user
- Admin can adjust via `PUT /api/admin/users/:id { max_agents: N }`
- Rate limit: max 1 agent start per 10 seconds (prevent spam)

---

## 4. Agent Spawner (`spawner.ts`)

Manages agent processes as child processes of the server.

```typescript
import { fork } from 'child_process';

class AgentSpawner {
  private processes: Map<string, ChildProcess> = new Map();

  async spawn(agentConfig: {
    agentId: string;
    name: string;
    role: string;
    userId: string;
    apiKey: string;       // Decrypted from user's stored key
    model?: string;       // Default: claude-haiku-4-5-20251001
    serverUrl?: string;   // Default: ws://localhost:8080
  }): Promise<void> {
    // Fork agent/index.ts (or dist/agent/index.js in production)
    const child = fork('dist/agent/index.js', [
      '--server', agentConfig.serverUrl || 'ws://localhost:8080',
      '--name', agentConfig.name,
      '--role', agentConfig.role,
    ], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: agentConfig.apiKey,
        VIBE_PARADOX_MODEL: agentConfig.model || 'claude-haiku-4-5-20251001',
        AGENT_ID: agentConfig.agentId,
        USER_ID: agentConfig.userId,
      }
    });

    // Track process
    this.processes.set(agentConfig.agentId, child);

    // Handle cost reports from child process
    child.on('message', (msg) => {
      if (msg.type === 'cost_report') {
        db.logCost(msg);
        db.updateAgentCost(agentConfig.agentId, msg.estimated_cost);
      }
    });

    // Handle exit
    child.on('exit', (code) => {
      this.processes.delete(agentConfig.agentId);
      db.updateAgentStatus(agentConfig.agentId, code === 0 ? 'stopped' : 'error');
    });

    db.updateAgentStatus(agentConfig.agentId, 'running', child.pid);
  }

  async stop(agentId: string): Promise<void> {
    const child = this.processes.get(agentId);
    if (child) {
      child.kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }
  }

  getRunning(): string[] {
    return Array.from(this.processes.keys());
  }
}
```

### Agent-side cost reporting:
The agent process sends cost data back to the parent via IPC:
```typescript
// In agent/brain.ts, after each LLM call:
if (process.send) {
  process.send({
    type: 'cost_report',
    agentId: process.env.AGENT_ID,
    userId: process.env.USER_ID,
    tick: currentTick,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens,
    estimated_cost: calculateCost(usage),
    model: process.env.VIBE_PARADOX_MODEL,
  });
}
```

---

## 5. Dashboard UI Updates (`dashboard.html`)

### New UI sections:

#### A. Login/Signup Screen
When no session exists, show a simple login form:
```
┌─────────────────────────────┐
│      VIBE PARADOX           │
│                             │
│  Username: [_________]      │
│  Password: [_________]      │
│                             │
│  [Login]  [Sign Up]         │
└─────────────────────────────┘
```

After login, store token in memory (NOT localStorage — it's not available). Pass token via WebSocket URL: `ws://host:8081/ws?token=<token>`.

#### B. Agent Management Panel (right sidebar, below world stats)
Replace the static agent list with interactive controls:

```
MY AGENTS (2/3)
┌─────────────────────────────────┐
│ ⚔ Fighter_Heo [RUNNING]        │
│ HP: ████████░░ 82/100           │
│ Gold: 14  LVL: 3                │
│ Cost: $0.12 (47 plans)          │
│ [Stop]                          │
├─────────────────────────────────┤
│ 🛒 Merchant_Heo [STOPPED]      │
│ [Start]  [Delete]               │
├─────────────────────────────────┤
│ [+ Spawn New Agent]             │
│ Role: [Fighter ▼]               │
│ Name: [__________]              │
│ [Create & Start]                │
└─────────────────────────────────┘
```

#### C. Cost Dashboard (new tab/section)
```
COST OVERVIEW
─────────────
Last hour:  $0.08
Last 24h:   $1.42
All time:   $3.67

Per agent:
  Fighter_Heo:   $0.05/hr  (12 plans/hr)
  Merchant_Heo:  $0.03/hr  (8 plans/hr)
```

#### D. API Key Setup
First-time setup prompt:
```
┌─────────────────────────────────┐
│ To run AI agents, you need an   │
│ Anthropic API key.              │
│                                 │
│ Key: [sk-ant-_______________]   │
│                                 │
│ [Save Key]                      │
│                                 │
│ Your key is encrypted and only  │
│ used to power your agents.      │
└─────────────────────────────────┘
```

### WebSocket Changes

Current: Admin WS sends full world state to all viewers.
New: Filter based on user.

```typescript
// On WebSocket upgrade:
const token = new URL(req.url, 'http://x').searchParams.get('token');
const user = await authenticateToken(token);

// Every tick, send:
// - Full world state (map, NPCs, behemoths) — same for everyone
// - Agent details — only show agents owned by this user (unless admin)
// - Cost data — only this user's costs

const adminTick = {
  type: 'admin_tick',
  tick: currentTick,
  world: worldState,                          // Same for all
  agents: filterAgentsByUser(allAgents, user), // User's agents with full detail
  otherAgents: anonymizeAgents(allAgents, user), // Others: position + role only
  userCost: getUserCostSummary(user.id),       // This user's costs
};
```

---

## 6. Admin Features

Admins (is_admin=true) get extra powers:

- See all agents from all users
- Stop any agent
- Adjust user limits
- View global cost dashboard
- Access to old `?key=` god-mode view as fallback

Keep backward compatibility: if `?key=<admin_key>` is provided (from env), bypass login and show god-mode view. This ensures the existing admin experience still works.

---

## 7. Security Notes

- **API keys**: Encrypted at rest with AES-256-GCM. Encryption key from env `ENCRYPTION_KEY`.
- **Passwords**: bcrypt hashed, never stored in plain text.
- **Sessions**: Secure random tokens, 7-day expiry, stored server-side.
- **Rate limiting**: Max 10 requests/minute per user on auth endpoints. Max 1 agent spawn per 10 seconds.
- **No localStorage**: Dashboard stores session token in JS memory only. Refreshing the page requires re-login. This is fine for an admin tool.
- **CORS**: Lock to same origin. No cross-origin requests.

---

## 8. Environment Variables

```bash
# Existing
ANTHROPIC_API_KEY=sk-ant-...          # Server's own key (for admin-spawned agents)
VIBE_PARADOX_MODEL=claude-haiku-4-5-20251001

# New
ADMIN_USERNAME=admin                   # Bootstrap admin user
ADMIN_PASSWORD=<strong-password>       # Bootstrap admin password
ENCRYPTION_KEY=<32-byte-hex>          # For API key encryption
ADMIN_KEY=<legacy-key>                # Backward compat with ?key= param
```

---

## 9. Migration Path

### Phase 1 (this task):
- Auth system + user DB
- Login UI on dashboard
- Agent management API + spawn controls
- Per-user WebSocket filtering
- Cost tracking in DB
- Backward compat with `?key=` for admin

### Phase 2 (future):
- BYOK billing/credits system
- Agent templates (pre-configured builds)
- Public spectator mode (no login, read-only world view)
- User-uploaded agent prompts/personalities
- Multi-server support

---

## Testing

```bash
# API tests
curl -X POST http://localhost:8081/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"testtest"}'

curl -X POST http://localhost:8081/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"testtest"}'
# → { "token": "abc123..." }

curl http://localhost:8081/api/agents \
  -H 'Authorization: Bearer abc123...'
# → []

curl -X POST http://localhost:8081/api/agents \
  -H 'Authorization: Bearer abc123...' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Fighter_Test","role":"fighter"}'
# → { "id": "uuid...", "status": "stopped" }

# Type check
npx tsc --noEmit
```

### Manual testing:
1. Open `http://46.225.140.38:8081` — should see login screen
2. Sign up → login → see empty agent list
3. Set API key → create fighter → start
4. Watch agent appear on map
5. Check cost updating in real-time
6. Stop agent → agent disconnects from game
7. Legacy `?key=<admin_key>` still works for god-mode

---

## Dependencies to Install

```bash
npm install bcryptjs uuid
npm install -D @types/bcryptjs @types/uuid
```

No external auth libraries. No JWT. Keep it simple.

---

## Success Criteria

- [ ] Users can sign up and log in via dashboard UI
- [ ] Users can create, start, stop, and delete agents
- [ ] Users can only see their own agents (admin sees all)
- [ ] Agent processes spawn and connect to game server
- [ ] Cost tracking shows per-agent and per-user totals
- [ ] Legacy `?key=` admin access still works
- [ ] Dashboard shows real-time agent status (running/stopped/error)
- [ ] API key encrypted at rest
- [ ] `npx tsc --noEmit` passes
