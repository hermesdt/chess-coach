ALTER TABLE games ADD COLUMN duplicate_of INTEGER;
CREATE INDEX idx_games_duplicate_of ON games(duplicate_of);
