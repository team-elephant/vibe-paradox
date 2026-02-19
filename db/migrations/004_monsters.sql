CREATE TABLE IF NOT EXISTS npc_monsters (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  attack REAL NOT NULL,
  defense REAL NOT NULL,
  speed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'roaming',
  patrol_origin_x REAL,
  patrol_origin_y REAL,
  patrol_radius REAL NOT NULL DEFAULT 50,
  target_id TEXT,
  gold_drop REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS behemoths (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  health REAL NOT NULL,
  max_health REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'roaming',
  ore_amount REAL NOT NULL DEFAULT 0,
  ore_max REAL NOT NULL,
  fed_amount REAL NOT NULL DEFAULT 0,
  unconscious_until_tick INTEGER,
  route TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_npc_monsters_position ON npc_monsters(position_x, position_y);
CREATE INDEX IF NOT EXISTS idx_behemoths_position ON behemoths(position_x, position_y);
