CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS providers_set_updated_at ON providers;
CREATE TRIGGER providers_set_updated_at
BEFORE UPDATE ON providers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS provider_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'invalid', 'disabled')),
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_sessions_provider_id_idx
  ON provider_sessions(provider_id);

DROP TRIGGER IF EXISTS provider_sessions_set_updated_at ON provider_sessions;
CREATE TRIGGER provider_sessions_set_updated_at
BEFORE UPDATE ON provider_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  query JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS searches_provider_id_idx
  ON searches(provider_id);

DROP TRIGGER IF EXISTS searches_set_updated_at ON searches;
CREATE TRIGGER searches_set_updated_at
BEFORE UPDATE ON searches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location_text TEXT,
  workplace_type TEXT,
  employment_type TEXT,
  seniority TEXT,
  published_at TIMESTAMPTZ,
  reposted_at TIMESTAMPTZ,
  local_status TEXT NOT NULL DEFAULT 'new'
    CHECK (local_status IN ('new', 'viewed', 'saved', 'applied')),
  availability_status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      availability_status IN (
        'active',
        'missing_from_searches',
        'available_outside_searches',
        'unavailable'
      )
    ),
  source_url TEXT,
  provider_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_availability_status_idx
  ON jobs(availability_status);

CREATE INDEX IF NOT EXISTS jobs_local_status_idx
  ON jobs(local_status);

CREATE INDEX IF NOT EXISTS jobs_published_at_idx
  ON jobs(published_at DESC NULLS LAST);

DROP TRIGGER IF EXISTS jobs_set_updated_at ON jobs;
CREATE TRIGGER jobs_set_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS external_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  external_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_id, external_id)
);

CREATE INDEX IF NOT EXISTS external_jobs_job_id_idx
  ON external_jobs(job_id);

DROP TRIGGER IF EXISTS external_jobs_set_updated_at ON external_jobs;
CREATE TRIGGER external_jobs_set_updated_at
BEFORE UPDATE ON external_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled', 'interrupted')),
  subject_type TEXT,
  subject_id UUID,
  progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
  progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
  phase TEXT,
  message TEXT,
  error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'api',
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activities_status_idx
  ON activities(status);

CREATE INDEX IF NOT EXISTS activities_type_status_idx
  ON activities(activity_type, status);

CREATE INDEX IF NOT EXISTS activities_created_at_idx
  ON activities(created_at DESC);

DROP TRIGGER IF EXISTS activities_set_updated_at ON activities;
CREATE TRIGGER activities_set_updated_at
BEFORE UPDATE ON activities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS job_search_presence (
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_id UUID NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (job_id, search_id)
);

CREATE INDEX IF NOT EXISTS job_search_presence_search_id_idx
  ON job_search_presence(search_id);

CREATE TABLE IF NOT EXISTS job_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  html TEXT,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'provider',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, content_hash)
);

CREATE INDEX IF NOT EXISTS job_descriptions_job_id_idx
  ON job_descriptions(job_id);

CREATE TABLE IF NOT EXISTS ai_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_endpoints_single_active_idx
  ON ai_endpoints(is_active)
  WHERE is_active;

DROP TRIGGER IF EXISTS ai_endpoints_set_updated_at ON ai_endpoints;
CREATE TRIGGER ai_endpoints_set_updated_at
BEFORE UPDATE ON ai_endpoints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES ai_endpoints(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  installed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(endpoint_id, name)
);

DROP TRIGGER IF EXISTS ai_models_set_updated_at ON ai_models;
CREATE TRIGGER ai_models_set_updated_at
BEFORE UPDATE ON ai_models
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS job_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  endpoint_id UUID REFERENCES ai_endpoints(id) ON DELETE SET NULL,
  model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  model_name TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed')),
  decision TEXT
    CHECK (decision IS NULL OR decision IN ('apply', 'maybe', 'reject')),
  score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_output TEXT,
  error TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_reviews_job_id_created_at_idx
  ON job_reviews(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_reviews_decision_idx
  ON job_reviews(decision);

CREATE TABLE IF NOT EXISTS raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  external_job_id UUID REFERENCES external_jobs(id) ON DELETE SET NULL,
  request_url TEXT,
  request_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status INTEGER,
  content_type TEXT,
  elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  payload JSONB,
  payload_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_payloads_provider_id_created_at_idx
  ON raw_payloads(provider_id, created_at DESC);

CREATE INDEX IF NOT EXISTS raw_payloads_activity_id_idx
  ON raw_payloads(activity_id);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info'
    CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_logs_activity_id_created_at_idx
  ON activity_logs(activity_id, created_at ASC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS settings_set_updated_at ON settings;
CREATE TRIGGER settings_set_updated_at
BEFORE UPDATE ON settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
