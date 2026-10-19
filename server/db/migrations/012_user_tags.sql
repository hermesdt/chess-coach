-- Tag counts on the user's own moves, per analysed game: {"hung_piece":2}. Lets Insights skip move_analysis.
ALTER TABLE game_analysis ADD COLUMN user_tags_json TEXT;
UPDATE game_analysis SET user_tags_json = (
  SELECT COALESCE(json_group_object(tag, n), '{}') FROM (
    SELECT j.value AS tag, COUNT(*) AS n
    FROM move_analysis m, json_each(m.data_json, '$.tags') j
    WHERE m.game_id = game_analysis.game_id AND json_extract(m.data_json, '$.isUserMove') = 1
    GROUP BY j.value
  )
);
