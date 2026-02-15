CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('tree', 'gold_vein', 'sapling')),
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  remaining REAL NOT NULL,
  max_capacity REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'available',
  growth_start_tick INTEGER,
  growth_complete_tick INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_resources_position ON resources(position_x, position_y);
CREATE INDEX idx_resources_type ON resources(type);
