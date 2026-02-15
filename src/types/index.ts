// types/index.ts — Barrel export

export type { EntityId, Tick, ChunkKey, Position } from './core.js';
export { distance, chunkOf } from './core.js';

export type {
  AgentRole,
  AgentStatus,
  CombatStats,
  Agent,
  InventoryItem,
  Equipment,
  AgentSelfView,
  AgentPublicView,
} from './agent.js';

export type {
  ActionType,
  RawAction,
  AgentAction,
  ActionParams,
  TradeItem,
  ValidatedAction,
  RejectedAction,
} from './action.js';

export type {
  WorldEvent,
  StateChange,
  SpawnEvent,
} from './world.js';

export type {
  ResourceType,
  ResourceState,
  Resource,
  NpcBehavior,
  NpcMonster,
  BehemothStatus,
  Behemoth,
  Structure,
  Alliance,
  TradeStatus,
  Trade,
  CraftingJob,
} from './entity.js';

export type {
  CombatPair,
  DamageResult,
} from './combat.js';

export type {
  CraftRecipeIngredient,
  CraftRecipeOutput,
  CraftRecipeStats,
  CraftRecipe,
  TradeOffer,
} from './economy.js';

export type {
  MessageMode,
  ChatMessage,
  ChatMessageView,
} from './message.js';

export type {
  TickInput,
  TickResult,
} from './tick.js';

export type {
  ClientMessage,
  ServerMessage,
  TickUpdateData,
  ResourceView,
  MonsterView,
  BehemothView,
  StructureView,
} from './protocol.js';
