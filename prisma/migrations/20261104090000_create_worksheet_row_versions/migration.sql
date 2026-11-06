BEGIN;

-- Filas de una hoja por revisión (ampliación E3.2, plan worksheets 02, R1–R3).
-- Cada versión vale en el intervalo de revisiones [from_sequence,
-- to_sequence); `to_sequence` nulo = sigue vigente. Leer la revisión N es
-- tomar las versiones con from_sequence <= N < to_sequence que no estén
-- borradas. Esta entrega solo lee: las escribirá el apply de E4.
-- Los nombres de restricciones e índices son los que genera Prisma.

-- R3: revisiones de E4 (borradores aplicados). Hace falta ya para leer una
-- revisión antigua cuando hay otra posterior.
ALTER TABLE "estadistica_forms"."worksheet_revisions"
  DROP CONSTRAINT "worksheet_revisions_source_check",
  ADD CONSTRAINT "worksheet_revisions_source_check"
    CHECK ("source" IN ('initialize', 'changeset'));

CREATE TABLE "estadistica_forms"."worksheet_row_versions" (
  "organization_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  -- Identidad estable de la fila: no cambia al ordenar, filtrar ni insertar.
  "row_id" TEXT NOT NULL,
  "from_sequence" INTEGER NOT NULL CHECK ("from_sequence" >= 1),
  "to_sequence" INTEGER,
  -- Orden de la hoja; desempata `row_id`.
  "sort_key" TEXT NOT NULL CHECK (char_length("sort_key") BETWEEN 1 AND 64),
  -- Objeto `{ columnId: valor canónico }`; una clave ausente es null (R4).
  "cell_values" JSONB NOT NULL CHECK (jsonb_typeof("cell_values") = 'object'),
  -- Tombstone: la fila deja de existir desde `from_sequence`.
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "worksheet_row_versions_pkey"
    PRIMARY KEY ("worksheet_id", "row_id", "from_sequence"),
  CHECK ("to_sequence" IS NULL OR "to_sequence" > "from_sequence")
);

-- Una sola versión vigente por fila (F43). Prisma no expresa índices
-- parciales. Que los intervalos cerrados no se solapen lo garantiza el
-- escritor de E4 (R2).
CREATE UNIQUE INDEX "worksheet_row_versions_one_open"
  ON "estadistica_forms"."worksheet_row_versions" ("worksheet_id", "row_id")
  WHERE "to_sequence" IS NULL;

-- Filas de una revisión, en el orden de la hoja.
CREATE INDEX "idx_worksheet_row_versions_revision"
  ON "estadistica_forms"."worksheet_row_versions" ("worksheet_id", "from_sequence", "sort_key", "row_id");

ALTER TABLE "estadistica_forms"."worksheet_row_versions"
  ADD CONSTRAINT "worksheet_row_versions_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Las dos secuencias son revisiones de la misma hoja.
ALTER TABLE "estadistica_forms"."worksheet_row_versions"
  ADD CONSTRAINT "worksheet_row_versions_worksheet_id_from_sequence_fkey"
    FOREIGN KEY ("worksheet_id", "from_sequence")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "sequence")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_row_versions"
  ADD CONSTRAINT "worksheet_row_versions_worksheet_id_to_sequence_fkey"
    FOREIGN KEY ("worksheet_id", "to_sequence")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "sequence")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
