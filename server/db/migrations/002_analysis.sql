CREATE TABLE game_analysis (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  accuracy_user REAL,
  accuracy_opp REAL,
  counts_json TEXT NOT NULL DEFAULT '{"blunder":0,"mistake":0,"inaccuracy":0}',
  key_moments_json TEXT NOT NULL DEFAULT '[]',
  analysed_at INTEGER
);

CREATE TABLE move_analysis (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (game_id, ply)
);
