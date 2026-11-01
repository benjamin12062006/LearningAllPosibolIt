BEGIN;

-- Versiones inmutables de mapeo y reglas (plan rulesets&evaluations, D1).
-- `mapping` y `rules` son arreglos JSON porque jsonb no conserva el orden de las
-- claves de un objeto, y el orden de las reglas es el orden de aplicación.
-- Los nombres de restricciones son los que genera Prisma para schema.prisma.
CREATE TABLE "estadistica_forms"."ruleset_versions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "mapping" JSONB NOT NULL CHECK (jsonb_typeof("mapping") = 'array'),
  "rules" JSONB NOT NULL CHECK (jsonb_typeof("rules") = 'array'),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "ruleset_versions_pkey" PRIMARY KEY ("id")
);

-- Última defensa si dos guardados llegaran a calcular la misma revisión.
CREATE UNIQUE INDEX "ruleset_versions_project_id_revision_key"
  ON "estadistica_forms"."ruleset_versions" ("project_id", "revision");

-- Destino de las claves foráneas compuestas de las evaluaciones (E3), que no
-- deben poder mezclar una versión con un snapshot de otro proyecto.
CREATE UNIQUE INDEX "ruleset_versions_project_id_id_key"
  ON "estadistica_forms"."ruleset_versions" ("project_id", "id");

-- Una versión no tiene sentido sin su proyecto: al borrarlo se borran con él.
ALTER TABLE "estadistica_forms"."ruleset_versions"
  ADD CONSTRAINT "ruleset_versions_project_id_fkey"
    FOREIGN KEY ("project_id")
    REFERENCES "estadistica_forms"."projects" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
