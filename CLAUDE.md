# CLAUDE.md — Instructions for AI Agents

> **READ THIS FIRST.** If you are Claude Code, Codex, Cowork, or any AI agent working on this codebase, these are your standing orders.

## Project: Vibe Paradox

An MMORPG where AI agents are the players. TypeScript/Node.js. Game server (port 8080) + admin dashboard (port 8081). SQLite persistence. Deployed on Hetzner VPS at 46.225.140.38.

## Before You Write Any Code

1. **Read this file completely**
2. **Read `TASKS.md`** — find your assigned task and its SCOPE
3. **You may ONLY modify files listed in the task's SCOPE** — touching anything else is a scope violation
4. **Run tests before and after** — `npx vitest run && npx tsc --noEmit`
5. **When done, run scope check** — `./scripts/scope-check.sh TASK-XXX`
6. **Mark your task DONE in `TASKS.md`** — add completion date

## Scope Enforcement

Every agent session MUST be associated with a TASK-XXX ID. Before committing:

1. Run `./scripts/scope-check.sh TASK-XXX` to validate all changed files are within your task's clearance AND track boundary
2. If you get a VIOLATION (exit 1), you touched a file above your tier. Revert it.
3. If you get a TRACK BOUNDARY VIOLATION (exit 4), you touched the other track's files. Revert immediately. This is how we got 14 merge conflicts in the ALIVE project.
4. If you get an ESCALATION (exit 2), stop and notify the operator.

To check a specific file's risk tier: `./scripts/scope-check.sh --classify path/to/file.ts`
To see your track boundaries: `./scripts/scope-check.sh --track TASK-XXX`

Risk tiers and track boundaries are defined in `risk-policy.json`. Do not modify `risk-policy.json` without operator approval.

---

## Task Protocol (MANDATORY)

Every coding session follows this exact sequence. No exceptions.

### Step 1: Identify your task
Open `TASKS.md`. Find the task assigned to you or the first task with status `READY`. If no task is READY, STOP and ask the operator. Do NOT freelance.

### Step 2: Announce scope
Before writing any code, list the files you will modify. Cross-check against the task's `scope:` field. If you need to touch a file not in scope, STOP and explain why.

Run `./scripts/scope-check.sh --track TASK-XXX` to confirm your track boundaries.

### Step 3: Run tests (before)
```bash
npx vitest run && npx tsc --noEmit
```
Note any pre-existing failures. You are not responsible for those — but you must not add new ones.

### Step 4: Plan first for sensitive tasks
If the task is marked `Priority: High`, OR touches `agent/pipeline/*` files, OR touches `src/server/ws-server.ts` or `src/server/game-engine.ts`, draft a plan BEFORE writing code. Show the plan. Wait for operator approval.

Skip Plan Mode if the task spec already contains numbered implementation steps — follow those directly.

### Step 5: Do the work
Implement the task. Stay within scope. If you discover a bug in an out-of-scope file, document it in `TASKS.md` as a new BACKLOG task with its own scope — do NOT fix it now.

### Step 6: Run tests (after)
```bash
npx vitest run && npx tsc --noEmit
```
ALL previously-passing tests must still pass. New tests for your work should also pass.

### Step 7: Run scope check
```bash
./scripts/scope-check.sh TASK-XXX
```
Must exit 0. If it doesn't, fix before committing.

### Step 8: Commit
```bash
git add -A
git commit -m "feat: <task title> [TASK-XXX]"
```

### Step 9: Code review (MANDATORY before merge)
Spawn the code-reviewer sub-agent or self-review:
```
Review changes for TASK-XXX.
Check: (1) scope-check.sh exits 0,
(2) npx vitest run passes,
(3) npx tsc --noEmit passes,
(4) no track boundary violations.
Output VERDICT: PASS or VERDICT: FAIL with reasons.
```
Do not merge without `VERDICT: PASS`.

### Step 10: Chain or Stop
Follow the **Task Chaining** rules below.

### Step 11: Clear context
Run `/clear` before starting any new task.

---

## Task Chaining

After completing a task (Step 8), check if you should continue or stop.

### When to chain (pick up the next task):
1. Another task in TASKS.md has status `READY`
2. Its scope does NOT overlap with files you just modified (no shared files)
3. You have not already completed 3 tasks this session
4. All tests passed after your just-completed task

If all four conditions are met: pick up the next `READY` task. No need to ask the operator — the `READY` status IS permission.

### When to STOP:
- No task has status `READY` → stop, report completion
- Next `READY` task's scope overlaps with files you just changed → stop, let operator verify first
- You've completed 3 tasks this session → stop for operator review
- ANY test failed → stop immediately, do not chain
- You're unsure about scope overlap → stop and ask

### Operator's role:
The operator pre-loads chains by setting multiple tasks to `READY` before a session. If only one task is `READY`, you do that task and stop. The operator controls the chain, not the agent.

---

## Track Boundaries (CRITICAL for parallel work)

Two tracks run in parallel via git worktrees. Track boundaries are HARD FAILURES — not warnings.

```
TRACK A — Agent Brain v2                    TRACK B — Accounts + Dashboard
─────────────────────────                   ──────────────────────────────
agent/brain.ts (modify)                     src/server/auth.ts (new)
agent/brain-v1.ts (rename)                  src/server/users-db.ts (new)
agent/pipeline/perception.ts (new)          src/server/agent-api.ts (new)
agent/pipeline/salience.ts (new)            src/server/spawner.ts (new)
agent/pipeline/drives.ts (new)              src/server/admin.ts (modify)
agent/pipeline/router.ts (new)              src/server/dashboard.html (modify)
agent/pipeline/planner.ts (new)             src/server/index.ts (modify — routes only)
agent/pipeline/memory.ts (new)
agent/plan-executor.ts (new)
agent/index.ts (modify)

SHARED (coordinate before touching):
  tsup.config.ts
  package.json (deps only — no conflicts if adding different packages)
  agent/launcher.ts
```

**If you are Track A: DO NOT touch any `src/server/` files.**
**If you are Track B: DO NOT touch any `agent/` files (except launcher.ts with coordination).**

`scope-check.sh` enforces this automatically. Exit code 4 = track boundary violation.

---

## Critical File Rules

### DO NOT touch these files unless your task explicitly requires it:

| File | Why | Risk |
|------|-----|------|
| `src/server/ws-server.ts` | Game server WebSocket core | Breaking = world stops |
| `src/server/game-engine.ts` | Tick processing, actions | Breaking = world stops |
| `src/server/world.ts` | Entity state management | Data corruption |
| `agent/brain.ts` | Cognitive pipeline entry | Wrong change = $30/hr burn (learned the hard way) |

---

## Pipeline Modification Rules (Track A only)

The cognitive pipeline is the core architecture. Modify with care:

- Each pipeline stage has a SINGLE responsibility. Don't merge stages.
- Stages are pure functions where possible — input in, output out, no side effects.
- The pipeline order is: Perception → Salience → Drives → Router → Planner → Memory
- The Planner is the ONLY stage that calls the LLM. All others are deterministic.
- If you add a new stage, update the pipeline diagram in this file.
- Test each stage independently before integration.
- The entire point of the pipeline: agents should NOT call the LLM every tick. Most ticks → EXECUTE_PLAN (zero LLM cost).

---

## Sub-Agent Rules

### Allowed sub-agent uses:
- Code review (Step 9)
- Running test suites while you continue editing
- File moves / renames that don't require judgment
- Generating TypeScript types or boilerplate

### Prohibited sub-agent uses:
- Modifying `agent/pipeline/*` files (cognitive architecture — requires full context)
- Any change that affects LLM call content or frequency
- Database schema changes
- Parallel edits to the same file

---

## Common Tasks

### "Add a new pipeline stage" (Track A)
1. Create `agent/pipeline/stage-name.ts` with typed input/output interfaces
2. Implement as a pure function
3. Add tests in `agent/pipeline/__tests__/stage-name.test.ts`
4. Wire into `agent/brain.ts` in the correct pipeline position
5. Update this file's pipeline diagram

### "Add an API endpoint" (Track B)
1. Add route in `src/server/agent-api.ts` or `src/server/auth.ts`
2. Add auth middleware if endpoint requires login
3. Wire route in `src/server/index.ts`
4. Test with curl commands

### "Add a database table" (Track B)
1. Add CREATE TABLE in `src/server/users-db.ts`
2. Add migration logic (check if table exists before creating)
3. Add typed query functions in the same file
4. Never use raw SQL outside of `users-db.ts`

### "Fix a bug found during soak test"
1. Document the bug as a new BACKLOG task in TASKS.md
2. Include: how to reproduce, which tick it occurred at, logs
3. Do NOT fix inline — bugs found in soak tests get their own scoped task
4. ALIVE lesson: the 7-day sleep cycle bug was only found via soak test

---

## Testing

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run agent/pipeline/__tests__/perception.test.ts

# Type check (must pass — no exceptions)
npx tsc --noEmit

# Scope check (must pass before merge)
./scripts/scope-check.sh TASK-XXX
```

### Known test behaviors:
- Tests should complete in under 30 seconds
- If tests hang, check for unclosed WebSocket connections
- Document any pre-existing failures in this section as they're discovered

---

## Git Workflow

- `main` — stable, deployable
- `feat/task-xxx-description` — feature branches, one per task
- Always branch from the latest `main` unless building on an unmerged feature
- Squash merge to main: `git merge --no-ff feat/task-xxx -m "feat: description [TASK-XXX]"`
- Run full suite + scope-check before pushing

### Worktree setup (for parallel tracks):
```bash
# Main directory = Track A
cd ~/vibe-paradox
git checkout -b feat/task-a01-perception

# Separate worktree = Track B
git worktree add ../vibe-paradox-track-b feat/task-b01-auth
cd ../vibe-paradox-track-b
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for agent LLM calls |
| `VIBE_PARADOX_MODEL` | No | Model name (default: `claude-haiku-4-5-20251001`) |
| `AGENT_BRAIN_VERSION` | No | `1` for old brain, `2` for pipeline (default: `2`) |
| `ADMIN_USERNAME` | For auth | Bootstrap admin user |
| `ADMIN_PASSWORD` | For auth | Bootstrap admin password |
| `ENCRYPTION_KEY` | For auth | AES-256-GCM key for API key storage |
| `ADMIN_KEY` | For legacy | Backward compat with `?key=` dashboard param |

---

## Deployment

```bash
# Check server status
ssh root@46.225.140.38 'systemctl status vibe-paradox'

# View live logs
ssh root@46.225.140.38 'journalctl -u vibe-paradox -f'

# Dashboard
http://46.225.140.38:8081?key=<from-logs>
```

---

## What NOT to Do

- Don't touch files outside your task scope — `scope-check.sh` will catch you
- Don't cross track boundaries — exit code 4 is a hard failure
- Don't add npm packages without documenting why
- Don't change the game tick rate (1 second) without operator approval
- Don't store secrets in code — use environment variables
- Don't use `localStorage` in dashboard.html — not available in all contexts
- Don't create Docker files — we deploy directly with systemd
- Don't refactor or "improve" code outside your task scope
- Don't skip the scope check before committing — it exists because agents historically violate scope when unsupervised
