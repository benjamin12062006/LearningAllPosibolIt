BEGIN;

-- Archivar una organización (ampliación E1.4, plan organizations&access 03,
-- A1): nula = activa. Archivar no borra nada; solo impide cambios de miembros
-- e invitaciones. Las organizaciones personales no se archivan.
ALTER TABLE "estadistica_forms"."organizations"
  ADD COLUMN "archived_at" TEXT,
  ADD CONSTRAINT "organizations_personal_not_archived"
    CHECK ("personal_owner_id" IS NULL OR "archived_at" IS NULL);

COMMIT;
