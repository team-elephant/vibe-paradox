CREATE TABLE IF NOT EXISTS alliances (
  name TEXT PRIMARY KEY,
  founder_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alliance_members (
  alliance_name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (alliance_name, agent_id)
);
