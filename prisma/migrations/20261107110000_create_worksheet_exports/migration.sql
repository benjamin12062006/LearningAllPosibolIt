BEGIN;

-- Exportar una revisión fija de hoja a CSV o XLSX (ampliación E5.3, plan
-- imports&exports 01, D15–D21). La fila se inserta después de releer el
-- archivo guardado y comprobar su SHA-256: nunca apunta a un archivo a medias.

CREATE TABLE "estadistica_forms"."worksheet_exports" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "revision_sequence" INTEGER NOT NULL CHECK ("revision_sequence" >= 1),
  "created_by" TEXT NOT NULL,
  "format" TEXT NOT NULL CHECK ("format" IN ('csv', 'xlsx')),
  -- Solo CSV: separador y política de fórmulas (D16, D18).
  "options" JSONB NOT NULL CHECK (jsonb_typeof("options") = 'object'),
  -- Columnas resueltas, filtro y orden tal como se validaron (D16).
  "query" JSONB NOT NULL CHECK (jsonb_typeof("query") = 'object'),
  "serializer_version" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL CHECK ("row_count" >= 0),
  "column_count" INTEGER NOT NULL CHECK ("column_count" BETWEEN 1 AND 200),
  "problem_cell_count" INTEGER NOT NULL CHECK ("problem_cell_count" >= 0),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" >= 1),
  "checksum" TEXT NOT NULL CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  "artifact_key" TEXT NOT NULL CHECK ("artifact_key" ~ '^[0-9a-f-]{36}\.(csv|xlsx)$'),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_exports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worksheet_exports_artifact_key_key"
  ON "estadistica_forms"."worksheet_exports" ("artifact_key");

CREATE INDEX "idx_worksheet_exports_worksheet_created"
  ON "estadistica_forms"."worksheet_exports" ("organization_id", "worksheet_id", "created_at" DESC);

ALTER TABLE "estadistica_forms"."worksheet_exports"
  ADD CONSTRAINT "worksheet_exports_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- La revisión es de la misma hoja: la clave compuesta lo garantiza.
ALTER TABLE "estadistica_forms"."worksheet_exports"
  ADD CONSTRAINT "worksheet_exports_worksheet_id_revision_id_fkey"
    FOREIGN KEY ("worksheet_id", "revision_id")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_exports"
  ADD CONSTRAINT "worksheet_exports_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
