# TASKS.md — Vibe Paradox Task Queue

> Tasks are picked up in order by status. Agents: read CLAUDE.md first.
> Status: BACKLOG → READY → IN_PROGRESS → DONE
> Only work on tasks with status `READY`.

---

## TRACK A — Agent Brain v2

### TASK-A01: Perception Stage
- **Status:** READY
- **Priority:** High
- **Track:** A
- **Description:** Create delta detection between ticks. Compare previous and current world state, return list of what changed (new threats, HP changes, inventory changes, plan step completion/failure).
- **Scope (files you MAY touch):**
  - `agent/pipeline/perception.ts` (create)
  - `agent/pipeline/__tests__/perception.test.ts` (create)
- **Scope (files you may NOT touch):**
  - `src/server/*` (Track B territory)
  - `agent/brain.ts` (not yet — wired in A05)
- **Definition of done:**
  - Perception function takes prev/curr WorldState, returns Perception[]
  - Returns empty array when nothing changed
  - Detects: threat_appeared, hp_changed, inventory_changed, got_attacked, plan_step_completed, plan_step_failed
  - Tests cover all perception types + edge case of first tick (no prev state)
  - `npx vitest run && npx tsc --noEmit` passes

---

### TASK-A02: Salience Gate + Drives
- **Status:** READY
- **Priority:** High
- **Track:** A
- **Depends on:** A01
- **Description:** Score perceptions by importance (deterministic). Maintain floating-point drive values (survival, greed, ambition, social, caution) updated every tick with pure math. No LLM.
- **Scope (files you MAY touch):**
  - `agent/pipeline/salience.ts` (create)
  - `agent/pipeline/drives.ts` (create)
  - `agent/pipeline/__tests__/salience.test.ts` (create)
  - `agent/pipeline/__tests__/drives.test.ts` (create)
- **Scope (files you may NOT touch):**
  - `src/server/*` (Track B territory)
  - `agent/brain.ts` (not yet)
- **Definition of done:**
  - Salience gate scores perceptions, returns shouldInterrupt boolean
  - Role-specific modifiers (fighter boosts threats, merchant boosts resources)
  - Drives update deterministically from world state — pure functions, fully testable
  - Drives clamp to [0, 1]
  - Tests cover: each salience type, role modifiers, drive updates from various states
  - `npx vitest run && npx tsc --noEmit` passes

---

### TASK-A03: Router + Plan Executor
- **Status:** BACKLOG
- **Priority:** High
- **Track:** A
- **Depends on:** A02
- **Description:** Router decides: EXECUTE_PLAN (no LLM) vs INTERRUPT/PLAN_COMPLETE (call LLM). Plan executor stores multi-step plans and returns the next game action each tick without LLM.
- **Scope (files you MAY touch):**
  - `agent/pipeline/router.ts` (create)
  - `agent/plan-executor.ts` (create)
  - `agent/pipeline/__tests__/router.test.ts` (create)
  - `agent/pipeline/__tests__/plan-executor.test.ts` (create)
- **Scope (files you may NOT touch):**
  - `src/server/*` (Track B territory)
  - `agent/brain.ts` (not yet)
- **Definition of done:**
  - Router returns EXECUTE_PLAN when mid-plan and no interrupt
  - Router returns INTERRUPT on high salience events
  - Router returns PLAN_COMPLETE when all steps done
  - Router returns PLAN_EMPTY when no plan exists
  - Stuck detection: re-plan after 60 ticks on same step
  - Plan executor translates plan steps to game protocol actions
  - Plan executor tracks step completion via world state checks
  - Tests cover all router paths + executor step advancement
  - `npx vitest run && npx tsc --noEmit` passes

---

### TASK-A04: Planner (LLM) + Memory
- **Status:** BACKLOG
- **Priority:** High
- **Track:** A
- **Depends on:** A03
- **Description:** The single LLM call — generates a 5-20 step plan from drives + nearby entities + memory. Lightweight memory system logs significant events and generates periodic reflections.
- **Scope (files you MAY touch):**
  - `agent/pipeline/planner.ts` (create)
  - `agent/pipeline/memory.ts` (create)
  - `agent/pipeline/__tests__/planner.test.ts` (create)
  - `agent/pipeline/__tests__/memory.test.ts` (create)
- **Scope (files you may NOT touch):**
  - `src/server/*` (Track B territory)
  - `agent/brain.ts` (not yet)
- **Definition of done:**
  - Planner prompt stays under 1500 input tokens
  - Planner returns Plan with 5-20 steps
  - Planner includes drives as natural language context
  - Planner includes last plan outcome + memory summary
  - Memory logs significant events (cap 100 entries)
  - Memory generates reflection every 10 plans (1 additional LLM call)
  - Memory.getSummary() returns compact string for planner context
  - Cost tracking: logs input/output tokens per call
  - Cooldowns: MIN_TICKS_BETWEEN_PLANS=10, MAX_PLANS_PER_MINUTE=3
  - Tests: planner prompt assembly, memory logging, memory pruning, reflection trigger
  - `npx vitest run && npx tsc --noEmit` passes

---

### TASK-A05: Wire Pipeline into Brain
- **Status:** BACKLOG
- **Priority:** High
- **Track:** A
- **Depends on:** A04
- **Description:** Replace monolithic LLM-every-tick brain with the new pipeline. Rename old brain.ts to brain-v1.ts. Feature flag AGENT_BRAIN_VERSION.
- **Scope (files you MAY touch):**
  - `agent/brain.ts` (rewrite)
  - `agent/brain-v1.ts` (rename from old brain.ts)
  - `agent/index.ts` (modify — wire new brain)
  - `agent/launcher.ts` (modify — pass brain version flag)
  - `tsup.config.ts` (add new entry points if needed)
- **Scope (files you may NOT touch):**
  - `src/server/*` (Track B territory)
  - `agent/pipeline/*` (already done in A01-A04, don't modify)
- **Definition of done:**
  - Old brain preserved as brain-v1.ts
  - New brain runs the full pipeline: perception → salience → drives → router → planner/executor → memory
  - AGENT_BRAIN_VERSION=2 env var selects new brain (default)
  - AGENT_BRAIN_VERSION=1 falls back to old brain
  - 6 agents run for 100 ticks, total LLM calls < 20
  - Cost tracking shows 70x+ reduction vs v1
  - All existing tests pass + new integration test
  - `npx vitest run && npx tsc --noEmit` passes

---

### TASK-A06: Soak Test (48hr)
- **Status:** BACKLOG
- **Priority:** High
- **Track:** A
- **Depends on:** A05
- **Description:** Deploy brain v2 to VPS. Run 6 agents on Haiku for 48 hours. Monitor via dashboard. Document emergent behaviors, costs, crashes.
- **Scope:** Deploy + observe. No code changes unless bugs found (document bugs as new tasks).
- **Definition of done:**
  - 6 agents running for 48+ hours without crashing
  - Total cost < $10 for entire run
  - Agents demonstrate multi-step plans (gather → craft → trade sequences)
  - Document any emergent behaviors (alliances, territory, trading patterns)
  - Document any bugs found → new BACKLOG tasks

---

## TRACK B — User Accounts + Dashboard

### TASK-B01: Database Schema + Auth
- **Status:** DONE (2026-02-19)
- **Priority:** High
- **Track:** B
- **Description:** Create user authentication system. SQLite tables for users, sessions, user_agents, cost_logs. Signup/login/logout endpoints. bcrypt passwords. Session tokens.
- **Scope (files you MAY touch):**
  - `src/server/users-db.ts` (create)
  - `src/server/auth.ts` (create)
  - `src/server/index.ts` (modify — add auth routes)
  - `package.json` (add bcryptjs, uuid deps)
- **Scope (files you may NOT touch):**
  - `agent/*` (Track A territory)
  - `src/server/ws-server.ts` (game server)
  - `src/server/game-engine.ts` (game logic)
- **Definition of done:**
  - users, sessions, user_agents, cost_logs tables created on startup
  - POST /api/auth/signup creates user with bcrypt password
  - POST /api/auth/login returns session token (7-day expiry)
  - POST /api/auth/logout invalidates session
  - GET /api/auth/me returns user info
  - Auth middleware rejects invalid/expired tokens
  - First user gets admin role (or bootstrap from env vars)
  - `npx tsc --noEmit` passes
  - Tested with curl commands

---

### TASK-B02: Agent Management API
- **Status:** DONE (2026-02-19)
- **Priority:** High
- **Track:** B
- **Depends on:** B01
- **Description:** REST API for creating, listing, starting, stopping, deleting agents. Per-user agent limits. Cost tracking per agent.
- **Scope (files you MAY touch):**
  - `src/server/agent-api.ts` (create)
  - `src/server/spawner.ts` (create)
  - `src/server/index.ts` (modify — add agent routes)
- **Scope (files you may NOT touch):**
  - `agent/*` (Track A territory)
  - `src/server/ws-server.ts` (game server)
  - `src/server/users-db.ts` (done in B01, don't modify schema)
- **Definition of done:**
  - GET /api/agents — list user's agents
  - POST /api/agents — create agent (checks max_agents limit)
  - POST /api/agents/:id/start — spawn agent process
  - POST /api/agents/:id/stop — graceful stop
  - DELETE /api/agents/:id — stop + delete
  - GET /api/agents/:id/cost — cost breakdown
  - PUT /api/user/settings — store encrypted API key
  - Spawner forks agent process with user's API key
  - Spawner handles process exit/crash cleanup
  - Agent sends cost reports back via IPC
  - Rate limit: 1 spawn per 10 seconds
  - `npx tsc --noEmit` passes
  - Tested with curl commands

---

### TASK-B03: Dashboard UI — Login + Agent Controls
- **Status:** DONE (2026-02-19)
- **Priority:** High
- **Track:** B
- **Depends on:** B02
- **Description:** Update dashboard.html with login screen, agent management panel, spawn controls, cost display. Per-user WebSocket filtering.
- **Scope (files you MAY touch):**
  - `src/server/dashboard.html` (modify)
  - `src/server/admin.ts` (modify — auth on WebSocket, per-user filtering)
- **Scope (files you may NOT touch):**
  - `agent/*` (Track A territory)
  - `src/server/ws-server.ts` (game server)
  - `src/server/auth.ts` (done in B01)
  - `src/server/agent-api.ts` (done in B02)
- **Definition of done:**
  - Login/signup form shown when no session
  - After login: agent list with status, HP, gold, cost
  - "Spawn New Agent" button: pick role, name, create + start
  - Start/stop buttons per agent
  - Cost display: per-agent and total
  - API key setup prompt for first-time users
  - WebSocket passes token, server filters agents by user
  - Admin users see all agents
  - Legacy `?key=<admin_key>` still works as god-mode bypass
  - Manual test: full flow from signup → spawn → watch → stop

---

### TASK-B04: Deploy + Test
- **Status:** DONE (2026-02-19)
- **Priority:** Medium
- **Track:** B
- **Depends on:** B03
- **Description:** Deploy Track B to VPS. Test full user flow. Fix any deployment issues.
- **Scope:** Deploy + fix. Keep changes minimal.
- **Definition of done:**
  - Dashboard shows login screen at http://46.225.140.38:8081
  - Can sign up, log in, spawn agent, watch it play, stop it
  - Cost tracking works in production
  - No regressions to existing god-mode admin view

---

## BACKLOG (Future)

### TASK-C01: Agent Brain v3 — Alliance Formation
- **Status:** BACKLOG
- **Priority:** Low
- **Track:** A
- **Description:** Agents form alliances, coordinate attacks on behemoths, share resources.

### TASK-C02: Public Spectator Mode
- **Status:** BACKLOG
- **Priority:** Low
- **Track:** B
- **Description:** Read-only world view without login. See agents playing, no controls.

### TASK-C03: npm Package (TASK-021)
- **Status:** BACKLOG
- **Priority:** Low
- **Track:** A
- **Description:** Publish CLI as npm package for public distribution.

### TASK-C04: Better Graphics + UI/UX
- **Status:** BACKLOG
- **Priority:** Medium
- **Track:** B
- **Description:** Improve dashboard visuals, agent animations, event feed styling.
