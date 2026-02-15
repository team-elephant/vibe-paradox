CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('merchant', 'fighter', 'monster')),
  position_x REAL NOT NULL DEFAULT 500,
  position_y REAL NOT NULL DEFAULT 500,
  destination_x REAL,
  destination_y REAL,
  status TEXT NOT NULL DEFAULT 'idle',
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  attack REAL NOT NULL,
  defense REAL NOT NULL,
  speed REAL NOT NULL,
  vision_radius REAL NOT NULL,
  gold REAL NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '[]',
  equipment TEXT NOT NULL DEFAULT '{}',
  alliance TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  monster_eats INTEGER NOT NULL DEFAULT 0,
  evolution_stage INTEGER NOT NULL DEFAULT 1,
  action_cooldown INTEGER NOT NULL DEFAULT 0,
  respawn_tick INTEGER,
  connected_at INTEGER NOT NULL,
  last_action_tick INTEGER NOT NULL DEFAULT 0,
  is_alive INTEGER NOT NULL DEFAULT 1,
  is_connected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agents_position ON agents(position_x, position_y);
CREATE INDEX idx_agents_alliance ON agents(alliance);
CREATE INDEX idx_agents_role ON agents(role);
