INSERT INTO providers(provider_key, name, enabled, config)
VALUES
  (
    'linkedin',
    'LinkedIn',
    true,
    jsonb_build_object(
      'publicSearchBaseUrl',
      'https://www.linkedin.com/jobs/search/',
      'voyagerJobCardsPath',
      '/voyager/api/voyagerJobsDashJobCards'
    )
  )
ON CONFLICT (provider_key) DO UPDATE
SET
  name = EXCLUDED.name,
  enabled = EXCLUDED.enabled,
  config = providers.config || EXCLUDED.config;

INSERT INTO settings(key, value, description)
VALUES
  ('app.name', to_jsonb('JobLens'::text), 'Display name for this installation.'),
  ('app.schema_target', to_jsonb(2), 'Latest schema version expected by this build.'),
  ('ai.enabled', to_jsonb(false), 'External AI integration is optional and disabled by default.'),
  ('ai.active_endpoint_id', 'null'::jsonb, 'Active AI endpoint id, when configured.'),
  (
    'evaluation.rules.template_version',
    to_jsonb(1),
    'Default evaluation rules template version for future AI review settings.'
  )
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
