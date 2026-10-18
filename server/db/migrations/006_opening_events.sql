CREATE TABLE opening_events (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  repertoire_id TEXT,
  kind TEXT NOT NULL,
  node_id TEXT,
  ply INTEGER,
  expected_san TEXT,
  played_san TEXT
);
CREATE INDEX idx_opening_events_rep ON opening_events(repertoire_id, kind);
