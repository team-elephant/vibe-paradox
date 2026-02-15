# CLAUDE.md — Vibe Paradox

> Instructions for Claude Code agents working on this project. Read once, then follow task specs.

## What This Is

Vibe Paradox is a multiplayer game server where AI agents connect via WebSocket and play in a persistent world. The server is pure deterministic game logic — no LLM calls, no AI decision-making. The server receives actions, validates them, executes them, and broadcasts state. That's it.

## Architecture

Read `ARCHITECTURE.md` for the full technical spec. Key points:

- **Stack**: Node.js, TypeScript (strict), WebSocket (ws), SQLite (better-sqlite3)
- **Pattern**: Tick-based game loop (1s ticks). Each tick: drain actions → validate → execute → broadcast.
- **Source of truth**: In-memory `WorldState` during runtime. SQLite for persistence/recovery.
- **No async in tick loop.** better-sqlite3 is synchronous. The tick must complete in <1000ms.

## Rules

### Type Safety
1. Every function crossing a module boundary MUST use types from `src/types/`.
2. No `any`. No `Record<string, unknown>` at module boundaries. Use the discriminated unions.
3. Internal helper functions can use simpler types, but public APIs must be typed.

### Architecture Boundaries
4. **Validator validates. Executor executes.** These are separate modules. Executor trusts its input.
5. **Only Executor mutates WorldState.** No other module writes to world state directly.
6. **1 action per agent per tick.** ActionQueue enforces last-write-wins.
7. **Server has zero LLM calls.** Pure game logic. Deterministic given same inputs.

### Code Style
8. Use ES modules (`import`/`export`), not CommonJS.
9. Classes for stateful components (WorldState, ChunkManager, TickLoop). Pure functions for stateless logic (distance, damage calc).
10. Prefer `const` over `let`. No `var`.
11. Error handling: validation errors are `RejectedAction` objects, not thrown exceptions. Exceptions are for programmer bugs, not game state violations.

### Testing
12. Use vitest. Every task must have passing tests.
13. Tests create their own WorldState instances — no shared mutable state between tests.
14. Test the contracts: "given this world state and this action, what happens?"
15. Don't mock the world. Create real WorldState + ChunkManager instances in tests.

### Persistence
16. SQLite writes happen AFTER tick processing, not during.
17. Full snapshots every 60 ticks. Incremental changes on critical events (death, trade, evolution).
18. JSON for complex fields in SQLite (inventory, equipment, routes). Parse on load.

## Task Protocol

1. Read the task spec in `TASKS.md`
2. Read the relevant sections of `ARCHITECTURE.md` (the task spec says which sections)
3. Implement exactly what the task says. No more, no less.
4. Run `npx vitest run` — all tests must pass
5. Run `npx tsc --noEmit` — no type errors

## Don't

- Don't add features not in the task spec
- Don't refactor existing code unless the task explicitly says to
- Don't add npm dependencies without the task spec listing them
- Don't create abstractions "for later" — build what's needed now
- Don't use `console.log` for debugging (use it for server status logging only)
- Don't put validation logic in the executor
- Don't put execution logic in the validator
- Don't make async calls inside `processTick()`

## File Ownership

Each pipeline module owns its domain. Don't reach across:

| Module | Owns | Does NOT touch |
|--------|------|---------------|
| `validator.ts` | Action validation, role checks, range checks | World mutations, damage calc |
| `executor.ts` | World mutations, action execution | Validation logic, broadcast |
| `combat-resolver.ts` | Damage calc, death handling, combat pairs | Gathering, trading, crafting |
| `resource-processor.ts` | Gathering progress, tree growth, depletion | Combat, trading |
| `economy-processor.ts` | Trade resolution, crafting queue | Combat, resources |
| `monster-processor.ts` | NPC AI behavior, spawn balance, evolution | Trading, crafting |
| `behemoth-processor.ts` | Behemoth lifecycle (feed/knockout/wake) | General combat, trading |
| `broadcaster.ts` | Per-agent state computation, fog of war | World mutations |
| `tick-loop.ts` | Orchestration (calls everything in order) | Direct game logic |

## Constants

All magic numbers live in `src/shared/constants.ts`. Don't hardcode numbers in logic files. Import from constants.

## ID Format

- Agents: `agent_${nanoid(8)}` — e.g. `agent_x7kB9mPq`
- NPC monsters: `npc_${nanoid(8)}`
- Resources: `res_${nanoid(8)}`
- Behemoths: `beh_${nanoid(8)}`
- Structures: `str_${nanoid(8)}`
- Trades: `trade_${nanoid(8)}`
- Messages: `msg_${nanoid(8)}`
- Alliances: user-chosen name (validated for uniqueness)

ID generation function is in `src/shared/utils.ts`.
