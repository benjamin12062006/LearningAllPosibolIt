BEGIN;

-- Cubre el listado de importaciones de un proyecto: del más reciente al más antiguo.
CREATE INDEX "idx_catalog_snapshots_project_created"
  ON "estadistica_forms"."catalog_snapshots" ("project_id", "created_at" DESC, "id" DESC);

COMMIT;
