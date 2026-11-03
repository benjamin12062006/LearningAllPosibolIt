BEGIN;

-- Empresas y membresías (ampliación E1.1, plan organizations&access O1–O4).
-- Aditiva: ninguna ruta existente lee estas tablas todavía y
-- `projects.organization_id` admite nulos hasta E1.2.
-- Los nombres de restricciones e índices son los que genera Prisma.
CREATE TABLE "estadistica_forms"."organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  -- Organización personal de un usuario: la correspondencia «propietario
  -- heredado → organización» que hace repetible el backfill (O2). Nula en las
  -- organizaciones de equipo (E1.3).
  "personal_owner_id" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "estadistica_forms"."organization_members" (
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  -- Roles cerrados (O1). Los permisos de cada rol se calculan en la API.
  "role" TEXT NOT NULL
    CHECK ("role" IN ('owner', 'admin', 'manager', 'editor', 'viewer')),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id")
);

CREATE UNIQUE INDEX "organizations_personal_owner_id_key"
  ON "estadistica_forms"."organizations" ("personal_owner_id");

-- «Mis organizaciones»: se busca por usuario, no por organización.
CREATE INDEX "idx_organization_members_user"
  ON "estadistica_forms"."organization_members" ("user_id", "organization_id");

ALTER TABLE "estadistica_forms"."projects"
  ADD COLUMN "organization_id" TEXT;

-- Proyectos de una organización, del más reciente al más antiguo.
CREATE INDEX "idx_projects_organization_created"
  ON "estadistica_forms"."projects" ("organization_id", "created_at" DESC, "id" DESC);

ALTER TABLE "estadistica_forms"."organizations"
  ADD CONSTRAINT "organizations_personal_owner_id_fkey"
    FOREIGN KEY ("personal_owner_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."organization_members"
  ADD CONSTRAINT "organization_members_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "estadistica_forms"."organizations" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."organization_members"
  ADD CONSTRAINT "organization_members_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- RESTRICT: una organización con proyectos no puede desaparecer y dejarlos
-- sin dueño.
ALTER TABLE "estadistica_forms"."projects"
  ADD CONSTRAINT "projects_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "estadistica_forms"."organizations" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Backfill (O4). Las tres sentencias son repetibles: si un binario antiguo
-- crea proyectos después de migrar, ejecutarlas otra vez solo completa los
-- que falten. Los IDs de proyectos, snapshots y demás recursos no cambian.

-- 1. Una organización personal por cada propietario con proyectos.
INSERT INTO "estadistica_forms"."organizations"
  ("id", "name", "personal_owner_id", "created_at")
SELECT
  gen_random_uuid()::text,
  'Personal',
  u."id",
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "estadistica_forms"."app_users" u
WHERE EXISTS (
  SELECT 1 FROM "estadistica_forms"."projects" p WHERE p."owner_id" = u."id"
)
ON CONFLICT ("personal_owner_id") DO NOTHING;

-- 2. El propietario es `owner` de su organización personal.
INSERT INTO "estadistica_forms"."organization_members"
  ("organization_id", "user_id", "role", "created_at")
SELECT
  o."id",
  o."personal_owner_id",
  'owner',
  o."created_at"
FROM "estadistica_forms"."organizations" o
WHERE o."personal_owner_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- 3. Cada proyecto sin organización pasa a la personal de su propietario.
UPDATE "estadistica_forms"."projects" p
SET "organization_id" = o."id"
FROM "estadistica_forms"."organizations" o
WHERE o."personal_owner_id" = p."owner_id"
  AND p."organization_id" IS NULL;

COMMIT;
