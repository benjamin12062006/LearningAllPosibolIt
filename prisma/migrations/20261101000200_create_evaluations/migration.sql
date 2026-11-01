BEGIN;

-- Evaluaciones de un snapshot con una versión de reglas (plan rulesets&evaluations,
-- D7–D9). La fila hace también de trabajo: queued → running → succeeded | failed.
-- Los nombres de restricciones e índices son los que genera Prisma.
CREATE TABLE "estadistica_forms"."evaluations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "ruleset_version_id" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "profile_version" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  "total_count" INTEGER CHECK ("total_count" BETWEEN 1 AND 5000),
  "valid_count" INTEGER CHECK ("valid_count" >= 0),
  "invalid_count" INTEGER CHECK ("invalid_count" >= 0),
  "excluded_count" INTEGER CHECK ("excluded_count" >= 0),
  "result_checksum" TEXT CHECK ("result_checksum" ~ '^[a-f0-9]{64}$'),
  "created_at" TEXT NOT NULL,
  "started_at" TEXT,
  "finished_at" TEXT,
  "error" JSONB,
  CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id"),
  -- Los cuatro conteos existen juntos o no existe ninguno.
  CHECK (
    ("total_count" IS NULL AND "valid_count" IS NULL AND "invalid_count" IS NULL AND "excluded_count" IS NULL)
    OR ("total_count" IS NOT NULL AND "valid_count" IS NOT NULL AND "invalid_count" IS NOT NULL AND "excluded_count" IS NOT NULL)
  ),
  -- Cada estado tiene sus campos. En `succeeded` se exige la invariante
  -- válidos + inválidos + excluidos = total (F2, inv. 3).
  CHECK (
    ("status" = 'queued' AND "started_at" IS NULL AND "finished_at" IS NULL AND "error" IS NULL AND "total_count" IS NULL AND "result_checksum" IS NULL)
    OR ("status" = 'running' AND "started_at" IS NOT NULL AND "finished_at" IS NULL AND "error" IS NULL AND "total_count" IS NULL AND "result_checksum" IS NULL)
    OR ("status" = 'succeeded' AND "started_at" IS NOT NULL AND "finished_at" IS NOT NULL AND "error" IS NULL
        AND "total_count" IS NOT NULL AND "result_checksum" IS NOT NULL
        AND "valid_count" + "invalid_count" + "excluded_count" = "total_count")
    OR ("status" = 'failed' AND "finished_at" IS NOT NULL AND "error" IS NOT NULL AND "total_count" IS NULL AND "result_checksum" IS NULL)
  )
);

CREATE TABLE "estadistica_forms"."evaluation_rows" (
  "evaluation_id" TEXT NOT NULL,
  "source_row" INTEGER NOT NULL CHECK ("source_row" BETWEEN 1 AND 5000),
  "external_id" TEXT NOT NULL,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('valid', 'invalid', 'excluded')),
  "product_values" JSONB CHECK ("product_values" IS NULL OR jsonb_typeof("product_values") = 'object'),
  "problems" JSONB NOT NULL CHECK (jsonb_typeof("problems") = 'array'),
  "excluded_by_rule" INTEGER CHECK ("excluded_by_rule" >= 1),
  CONSTRAINT "evaluation_rows_pkey" PRIMARY KEY ("evaluation_id", "source_row"),
  -- Una fila es exactamente una de las tres (D7): excluida sin valores ni
  -- problemas; válida sin problemas; inválida con al menos uno.
  CHECK (
    ("outcome" = 'excluded' AND "excluded_by_rule" IS NOT NULL AND "product_values" IS NULL AND "problems" = '[]'::jsonb)
    OR ("outcome" = 'valid' AND "excluded_by_rule" IS NULL AND "product_values" IS NOT NULL AND "problems" = '[]'::jsonb)
    OR ("outcome" = 'invalid' AND "excluded_by_rule" IS NULL AND "product_values" IS NOT NULL AND jsonb_array_length("problems") > 0)
  )
);

-- Cola del trabajador: la evaluación en espera más antigua primero.
CREATE INDEX "idx_evaluations_queue"
  ON "estadistica_forms"."evaluations" ("status", "created_at", "id");

-- Destino de claves foráneas compuestas futuras (exportación, incremento 3).
CREATE UNIQUE INDEX "evaluations_project_id_id_key"
  ON "estadistica_forms"."evaluations" ("project_id", "id");

-- Como mucho una evaluación activa por proyecto, garantizado por la base y no
-- solo por el bloqueo de la aceptación (ficha 07, F35). Prisma no expresa
-- índices parciales en schema.prisma.
CREATE UNIQUE INDEX "evaluations_one_active_per_project"
  ON "estadistica_forms"."evaluations" ("project_id")
  WHERE "status" IN ('queued', 'running');

-- Informe paginado por resultado (E4).
CREATE INDEX "idx_evaluation_rows_outcome"
  ON "estadistica_forms"."evaluation_rows" ("evaluation_id", "outcome", "source_row");

-- Las claves compuestas impiden mezclar un snapshot o una versión de reglas de
-- otro proyecto. Borrar el snapshot borra sus evaluaciones; una versión de
-- reglas usada por una evaluación no se puede borrar sola (D14).
ALTER TABLE "estadistica_forms"."evaluations"
  ADD CONSTRAINT "evaluations_project_id_snapshot_id_fkey"
    FOREIGN KEY ("project_id", "snapshot_id")
    REFERENCES "estadistica_forms"."catalog_snapshots" ("project_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "evaluations_project_id_ruleset_version_id_fkey"
    FOREIGN KEY ("project_id", "ruleset_version_id")
    REFERENCES "estadistica_forms"."ruleset_versions" ("project_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."evaluation_rows"
  ADD CONSTRAINT "evaluation_rows_evaluation_id_fkey"
    FOREIGN KEY ("evaluation_id")
    REFERENCES "estadistica_forms"."evaluations" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
