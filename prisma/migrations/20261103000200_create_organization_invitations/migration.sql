BEGIN;

-- Invitaciones a una organización (ampliación E1.3, plan organizations&access
-- 02, T2). Del token solo se guarda su SHA-256: una copia de la base no permite
-- aceptar invitaciones.
CREATE TABLE "estadistica_forms"."organization_invitations" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  -- En minúsculas y sin espacios: así «Ana@X.com» y «ana@x.com» son la misma
  -- invitación pendiente.
  "email_normalized" TEXT NOT NULL CHECK (
    "email_normalized" = lower(btrim("email_normalized"))
    AND "email_normalized" LIKE '%_@_%'
    AND char_length("email_normalized") <= 254
  ),
  "role" TEXT NOT NULL
    CHECK ("role" IN ('owner', 'admin', 'manager', 'editor', 'viewer')),
  "token_hash" TEXT NOT NULL CHECK ("token_hash" ~ '^[a-f0-9]{64}$'),
  "invited_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "accepted_at" TEXT,
  "accepted_by" TEXT,
  "revoked_at" TEXT,
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  -- Aceptada (con quién) o revocada, nunca las dos cosas.
  CHECK (("accepted_at" IS NULL) = ("accepted_by" IS NULL)),
  CHECK ("accepted_at" IS NULL OR "revoked_at" IS NULL)
);

CREATE UNIQUE INDEX "organization_invitations_token_hash_key"
  ON "estadistica_forms"."organization_invitations" ("token_hash");

-- Como mucho una invitación pendiente por organización y correo (T3: invitar
-- otra vez revoca la anterior). Prisma no expresa índices parciales.
CREATE UNIQUE INDEX "organization_invitations_one_pending"
  ON "estadistica_forms"."organization_invitations" ("organization_id", "email_normalized")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Invitaciones de una organización, de la más reciente a la más antigua.
CREATE INDEX "idx_organization_invitations_organization_created"
  ON "estadistica_forms"."organization_invitations" ("organization_id", "created_at" DESC, "id" DESC);

ALTER TABLE "estadistica_forms"."organization_invitations"
  ADD CONSTRAINT "organization_invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "estadistica_forms"."organizations" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."organization_invitations"
  ADD CONSTRAINT "organization_invitations_invited_by_fkey"
    FOREIGN KEY ("invited_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."organization_invitations"
  ADD CONSTRAINT "organization_invitations_accepted_by_fkey"
    FOREIGN KEY ("accepted_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
