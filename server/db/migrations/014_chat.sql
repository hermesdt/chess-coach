CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  question TEXT NOT NULL,
  anchor_json TEXT NOT NULL,
  fact_pack_json TEXT,
  answer_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'error')),
  error TEXT,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_messages_game ON chat_messages(game_id, turn);
