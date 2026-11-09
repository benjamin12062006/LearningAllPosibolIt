BEGIN;

-- Un proyecto pertenece siempre a una organización (C6 del plan de cierre,
-- E1.2): el acceso a las rutas de proyectos se decide por la membresía en ella,
-- y `owner_id` queda como procedencia. El backfill de E1
-- (20261103000100_create_organizations) asignó la organización personal a los
-- proyectos anteriores; si alguno quedara sin ella, se para aquí en lugar de
-- adivinar de quién es.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "estadistica_forms"."projects" WHERE "organization_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay proyectos sin organización: repite el backfill de 20261103000100_create_organizations antes de esta migración.';
  END IF;
END $$;

ALTER TABLE "estadistica_forms"."projects"
  ALTER COLUMN "organization_id" SET NOT NULL;

COMMIT;
