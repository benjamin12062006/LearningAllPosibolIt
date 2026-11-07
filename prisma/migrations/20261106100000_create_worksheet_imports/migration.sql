BEGIN;

-- Importar un CSV a un borrador de hoja (ampliación E5.1, plan imports&exports
-- 01, D7). La importación y su borrador se crean en la misma transacción. El
-- original no se guarda: su hash, sus opciones y el informe son la procedencia.

ALTER TABLE "estadistica_forms"."worksheet_changesets"
  DROP CONSTRAINT "worksheet_changesets_source_check",
  ADD CONSTRAINT "worksheet_changesets_source_check"
    CHECK ("source" IN ('manual', 'revert', 'import'));

CREATE TABLE "estadistica_forms"."worksheet_imports" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "changeset_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "format" TEXT NOT NULL CHECK ("format" IN ('csv')),
  "file_hash" TEXT NOT NULL CHECK ("file_hash" ~ '^[a-f0-9]{64}$'),
  "file_bytes" INTEGER NOT NULL CHECK ("file_bytes" BETWEEN 1 AND 10485760),
  -- Mapeo, modo, clave y reglas de conversión tal como se pidieron (D3–D5).
  "options" JSONB NOT NULL CHECK (jsonb_typeof("options") = 'object'),
  -- Recuentos por resultado e informe de cabeceras ignoradas.
  "report" JSONB NOT NULL CHECK (jsonb_typeof("report") = 'object'),
  -- Exclusiones exactas: fila de origen y códigos de cada una (D6, T15).
  "excluded_rows" JSONB NOT NULL CHECK (jsonb_typeof("excluded_rows") = 'array'),
  -- Huella de las filas incluidas con su `rowId`.
  "included_hash" TEXT NOT NULL CHECK ("included_hash" ~ '^[a-f0-9]{64}$'),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worksheet_imports_changeset_id_key"
  ON "estadistica_forms"."worksheet_imports" ("changeset_id");

CREATE INDEX "idx_worksheet_imports_worksheet_created"
  ON "estadistica_forms"."worksheet_imports" ("organization_id", "worksheet_id", "created_at" DESC);

ALTER TABLE "estadistica_forms"."worksheet_imports"
  ADD CONSTRAINT "worksheet_imports_organization_id_changeset_id_fkey"
    FOREIGN KEY ("organization_id", "changeset_id")
    REFERENCES "estadistica_forms"."worksheet_changesets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_imports"
  ADD CONSTRAINT "worksheet_imports_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
