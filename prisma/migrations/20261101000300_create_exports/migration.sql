BEGIN;

-- Exportaciones TSV de una evaluación revisada (plan reviews&exports, D7). La
-- fila guarda qué aprobó el operador (suma y conteos aceptados) y qué archivo se
-- generó (clave interna, tamaño y suma del TSV). En la fase A no hay feeds ni
-- versiones publicadas: solo esta tabla.
-- Los nombres de restricciones e índices son los que genera Prisma.
CREATE TABLE "estadistica_forms"."exports" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "evaluation_id" TEXT NOT NULL,
  "approved_result_checksum" TEXT NOT NULL CHECK ("approved_result_checksum" ~ '^[a-f0-9]{64}$'),
  "accepted_invalid_count" INTEGER NOT NULL CHECK ("accepted_invalid_count" >= 0),
  "accepted_excluded_count" INTEGER NOT NULL CHECK ("accepted_excluded_count" >= 0),
  "row_count" INTEGER NOT NULL CHECK ("row_count" BETWEEN 1 AND 5000),
  "artifact_key" TEXT NOT NULL CHECK ("artifact_key" ~ '^[0-9a-f-]{36}\.tsv$'),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "tsv_checksum" TEXT NOT NULL CHECK ("tsv_checksum" ~ '^[a-f0-9]{64}$'),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "exports_pkey" PRIMARY KEY ("id"),
  -- Válidos exportados más exclusiones aceptadas: el total de la evaluación,
  -- que nunca pasa de 5.000 filas.
  CHECK ("row_count" + "accepted_invalid_count" + "accepted_excluded_count" <= 5000)
);

-- Una exportación por evaluación: el TSV de una evaluación inmutable es siempre
-- el mismo, y repetir la petición devuelve la existente (D7).
CREATE UNIQUE INDEX "exports_evaluation_id_key"
  ON "estadistica_forms"."exports" ("evaluation_id");

CREATE UNIQUE INDEX "exports_artifact_key_key"
  ON "estadistica_forms"."exports" ("artifact_key");

-- La clave compuesta impide referenciar una evaluación de otro proyecto. La
-- exportación es parte de su evaluación en la fase A: se borra con ella (D11).
ALTER TABLE "estadistica_forms"."exports"
  ADD CONSTRAINT "exports_project_id_evaluation_id_fkey"
    FOREIGN KEY ("project_id", "evaluation_id")
    REFERENCES "estadistica_forms"."evaluations" ("project_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
