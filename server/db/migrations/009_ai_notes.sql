CREATE TABLE ai_notes (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  analysis_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (subject, prompt_version, analysis_version, provider, model)
);
