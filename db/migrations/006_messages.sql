CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tick INTEGER NOT NULL,
  sender_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('whisper', 'local', 'broadcast')),
  content TEXT NOT NULL,
  target_id TEXT,
  position_x REAL,
  position_y REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_tick ON messages(tick);
