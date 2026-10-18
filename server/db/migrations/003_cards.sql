CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  position_key TEXT NOT NULL,
  fen TEXT NOT NULL,
  side_to_move TEXT NOT NULL,
  prompt TEXT NOT NULL,
  solution_json TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  last_move_uci TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, position_key)
);

CREATE TABLE card_state (
  card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  fsrs_json TEXT NOT NULL,
  due INTEGER NOT NULL,
  last_review INTEGER
);
CREATE INDEX idx_card_state_due ON card_state(due);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  answer_uci TEXT,
  duration_ms INTEGER NOT NULL,
  reviewed_at INTEGER NOT NULL
);
CREATE INDEX idx_reviews_card ON reviews(card_id);
CREATE INDEX idx_reviews_at ON reviews(reviewed_at);

CREATE TABLE card_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
