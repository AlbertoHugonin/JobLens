INSERT INTO settings(key, value, description)
VALUES (
  'app.schema_target',
  to_jsonb(4),
  'Latest schema version expected by this build.'
)
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  updated_at = now();
