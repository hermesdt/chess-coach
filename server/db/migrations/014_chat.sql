CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  question TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  fact_pack_json TEXT,
  answer_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'done', 'error')),
  error TEXT,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_chat_messages_game ON chat_messages(game_id, turn);
