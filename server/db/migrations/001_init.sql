CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  time_class TEXT NOT NULL,
  rated INTEGER NOT NULL,
  white TEXT NOT NULL,
  black TEXT NOT NULL,
  white_elo INTEGER,
  black_elo INTEGER,
  user_color TEXT,
  result TEXT,
  termination TEXT,
  eco TEXT,
  opening_name TEXT,
  pgn TEXT NOT NULL,
  url TEXT,
  ply_count INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  UNIQUE (source, source_id)
);

CREATE INDEX games_played_at_idx ON games (played_at DESC);

CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,
  last_synced_at INTEGER
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  total INTEGER,
  message TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
