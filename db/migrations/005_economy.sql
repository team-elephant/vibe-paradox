CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  offered TEXT NOT NULL,
  received TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS crafting_queue (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  start_tick INTEGER NOT NULL,
  complete_tick INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
);
