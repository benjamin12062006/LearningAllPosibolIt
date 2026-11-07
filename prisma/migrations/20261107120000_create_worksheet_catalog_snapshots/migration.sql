BEGIN;

-- Procedencia de un snapshot de catálogo creado desde una revisión de hoja
-- (ampliación E5.4, plan imports&exports 01, D22–D28). Se inserta en la misma
-- transacción que el snapshot y su trabajo de importación.

CREATE TABLE "estadistica_forms"."worksheet_catalog_snapshots" (
  "snapshot_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "revision_sequence" INTEGER NOT NULL CHECK ("revision_sequence" >= 1),
  "created_by" TEXT NOT NULL,
  "id_column_id" TEXT NOT NULL,
  -- Columnas elegidas, en orden, con la cabecera que tienen en el snapshot (D24).
  "columns" JSONB NOT NULL CHECK (
    jsonb_typeof("columns") = 'array'
    AND jsonb_array_length("columns") BETWEEN 1 AND 200
  ),
  -- Filtro y orden tal como se validaron (D24).
  "query" JSONB NOT NULL CHECK (jsonb_typeof("query") = 'object'),
  "serializer_version" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL CHECK ("row_count" BETWEEN 1 AND 5000),
  "source_hash" TEXT NOT NULL CHECK ("source_hash" ~ '^[a-f0-9]{64}$'),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_catalog_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

CREATE UNIQUE INDEX "worksheet_catalog_snapshots_project_id_snapshot_id_key"
  ON "estadistica_forms"."worksheet_catalog_snapshots" ("project_id", "snapshot_id");

CREATE INDEX "idx_worksheet_catalog_snapshots_worksheet_created"
  ON "estadistica_forms"."worksheet_catalog_snapshots" ("organization_id", "worksheet_id", "created_at" DESC);

-- Borrar la importación (la ruta existente) borra también su procedencia (D27).
-- La clave compuesta asegura que el snapshot es del mismo proyecto.
ALTER TABLE "estadistica_forms"."worksheet_catalog_snapshots"
  ADD CONSTRAINT "worksheet_catalog_snapshots_project_id_snapshot_id_fkey"
    FOREIGN KEY ("project_id", "snapshot_id")
    REFERENCES "estadistica_forms"."catalog_snapshots" ("project_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_catalog_snapshots"
  ADD CONSTRAINT "worksheet_catalog_snapshots_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- La revisión es de la misma hoja: la clave compuesta lo garantiza.
ALTER TABLE "estadistica_forms"."worksheet_catalog_snapshots"
  ADD CONSTRAINT "worksheet_catalog_snapshots_worksheet_id_revision_id_fkey"
    FOREIGN KEY ("worksheet_id", "revision_id")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_catalog_snapshots"
  ADD CONSTRAINT "worksheet_catalog_snapshots_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
