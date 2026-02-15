// types/tick.ts — Tick input/output types

import type { Tick } from './core.js';
import type { ValidatedAction, RejectedAction } from './action.js';
import type { WorldEvent, StateChange, SpawnEvent } from './world.js';

export interface TickInput {
  tick: Tick;
}

export interface TickResult {
  tick: Tick;
  executed: ValidatedAction[];
  rejected: RejectedAction[];
  events: WorldEvent[];
  stateChanges: StateChange[];
  spawns: SpawnEvent[];
}
