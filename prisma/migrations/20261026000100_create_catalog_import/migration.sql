BEGIN;

CREATE TABLE estadistica_forms.catalog_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES estadistica_forms.projects(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  id_column TEXT NOT NULL CHECK (length(id_column) BETWEEN 1 AND 128),
  delimiter TEXT NOT NULL CHECK (delimiter IN ('comma','semicolon')),
  headers JSONB CHECK (headers IS NULL OR jsonb_typeof(headers)='array'),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  artifact_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 0 AND 10485760),
  original_name TEXT NOT NULL,
  project_configuration JSONB NOT NULL CHECK (jsonb_typeof(project_configuration)='object'),
  status TEXT NOT NULL CHECK (status IN ('pending','importing','ready','failed')),
  row_count INTEGER CHECK (row_count BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  error JSONB,
  UNIQUE(project_id,id),
  CHECK (
    (status IN ('pending','importing') AND row_count IS NULL AND finished_at IS NULL AND error IS NULL)
    OR (status='ready' AND row_count IS NOT NULL AND headers IS NOT NULL AND finished_at IS NOT NULL AND error IS NULL)
    OR (status='failed' AND row_count IS NULL AND finished_at IS NOT NULL AND error IS NOT NULL)
  )
);

CREATE TABLE estadistica_forms.catalog_rows (
  snapshot_id TEXT NOT NULL REFERENCES estadistica_forms.catalog_snapshots(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  source_row INTEGER NOT NULL CHECK (source_row BETWEEN 1 AND 5000),
  external_id TEXT NOT NULL CHECK (length(trim(external_id)) > 0),
  original_values JSONB NOT NULL CHECK (jsonb_typeof(original_values)='object'),
  PRIMARY KEY(snapshot_id,source_row),
  UNIQUE(snapshot_id,external_id)
);

CREATE TABLE estadistica_forms.catalog_import_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows BETWEEN 0 AND 5000),
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error JSONB,
  FOREIGN KEY(project_id,snapshot_id) REFERENCES estadistica_forms.catalog_snapshots(project_id,id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CHECK (
    (status='queued' AND started_at IS NULL AND finished_at IS NULL AND error IS NULL)
    OR (status='running' AND started_at IS NOT NULL AND finished_at IS NULL AND error IS NULL)
    OR (status='succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND error IS NULL)
    OR (status='failed' AND finished_at IS NOT NULL AND error IS NOT NULL)
  )
);

CREATE INDEX idx_catalog_jobs_queue ON estadistica_forms.catalog_import_jobs(status,created_at,id);

COMMIT;
