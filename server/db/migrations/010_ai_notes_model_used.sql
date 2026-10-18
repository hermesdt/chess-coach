-- `model` is now the REQUESTED model ('default' when none is configured) and is part of the cache key.
-- `model_used` is what the provider reported, for display.
ALTER TABLE ai_notes ADD COLUMN model_used TEXT;
UPDATE ai_notes SET model_used = model;
