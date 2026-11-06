BEGIN;

-- Borradores de hojas, decisiones de revisión, recibos de operación y
-- auditoría (ampliación E4, plan changesets 01, D1). Los recibos y la
-- auditoría son la parte de E2 que E4 necesita: se escriben en la misma
-- transacción que la revisión. Nada borra en cascada desde proyectos.
-- Los nombres de restricciones e índices son los que genera Prisma.

CREATE TABLE "estadistica_forms"."worksheet_changesets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "source" TEXT NOT NULL CHECK ("source" IN ('manual', 'revert')),
  "title" TEXT NOT NULL CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  "status" TEXT NOT NULL CHECK ("status" IN (
    'draft', 'pending_review', 'approved', 'rejected', 'conflicted', 'applied', 'cancelled'
  )),
  -- Aumenta con cada guardado o reapertura: es el ETag del borrador (D3).
  "draft_version" INTEGER NOT NULL CHECK ("draft_version" >= 1),
  "base_revision_id" TEXT NOT NULL,
  "base_sequence" INTEGER NOT NULL CHECK ("base_sequence" >= 1),
  "base_schema_version" INTEGER NOT NULL CHECK ("base_schema_version" >= 1),
  -- Lista normalizada de operaciones (D2).
  "operations" JSONB NOT NULL CHECK (jsonb_typeof("operations") = 'array'),
  -- Huella del contenido enviado; existe desde el envío (D4, D5).
  "content_hash" TEXT CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  "applied_revision_id" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_changesets_pkey" PRIMARY KEY ("id"),
  CHECK (("status" = 'applied') = ("applied_revision_id" IS NOT NULL)),
  CHECK ("status" NOT IN ('pending_review', 'approved', 'applied') OR "content_hash" IS NOT NULL)
);

-- Solo se añaden filas: una decisión no se edita ni se borra.
CREATE TABLE "estadistica_forms"."worksheet_changeset_decisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "changeset_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "decision" TEXT NOT NULL CHECK ("decision" IN ('accept', 'reject')),
  "content_hash" TEXT NOT NULL CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  "draft_version" INTEGER NOT NULL CHECK ("draft_version" >= 1),
  "head_revision_id" TEXT NOT NULL,
  -- `single_member`: la empresa tiene una sola persona y se aprueba a sí misma (D6).
  "policy" TEXT NOT NULL CHECK ("policy" IN ('peer', 'single_member')),
  "reason" TEXT CHECK (char_length("reason") <= 500),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_changeset_decisions_pkey" PRIMARY KEY ("id")
);

-- Un recibo por organización, actor, operación, recurso y clave (F47, G7).
CREATE TABLE "estadistica_forms"."operation_receipts" (
  "organization_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL CHECK (char_length("idempotency_key") BETWEEN 1 AND 255),
  "payload_hash" TEXT NOT NULL CHECK ("payload_hash" ~ '^[a-f0-9]{64}$'),
  "result" JSONB NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "operation_receipts_pkey"
    PRIMARY KEY ("organization_id", "actor_id", "operation", "resource_id", "idempotency_key")
);

CREATE TABLE "estadistica_forms"."audit_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- Una revisión viene, como mucho, de un borrador; un borrador produce como
-- mucho una revisión (T10). Las revisiones `initialize` no tienen borrador.
ALTER TABLE "estadistica_forms"."worksheet_revisions"
  ADD COLUMN "changeset_id" TEXT;

CREATE UNIQUE INDEX "worksheet_revisions_changeset_id_key"
  ON "estadistica_forms"."worksheet_revisions" ("changeset_id");

CREATE UNIQUE INDEX "worksheet_changesets_organization_id_id_key"
  ON "estadistica_forms"."worksheet_changesets" ("organization_id", "id");

CREATE INDEX "idx_worksheet_changesets_worksheet_created"
  ON "estadistica_forms"."worksheet_changesets" ("organization_id", "worksheet_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_worksheet_changeset_decisions_changeset"
  ON "estadistica_forms"."worksheet_changeset_decisions" ("changeset_id", "created_at");

CREATE INDEX "idx_audit_events_resource"
  ON "estadistica_forms"."audit_events" ("organization_id", "resource_type", "resource_id", "created_at");

ALTER TABLE "estadistica_forms"."worksheet_changesets"
  ADD CONSTRAINT "worksheet_changesets_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_changesets"
  ADD CONSTRAINT "worksheet_changesets_worksheet_id_base_revision_id_fkey"
    FOREIGN KEY ("worksheet_id", "base_revision_id")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_changesets"
  ADD CONSTRAINT "worksheet_changesets_author_id_fkey"
    FOREIGN KEY ("author_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_changeset_decisions"
  ADD CONSTRAINT "worksheet_changeset_decisions_organization_id_changeset_id_fkey"
    FOREIGN KEY ("organization_id", "changeset_id")
    REFERENCES "estadistica_forms"."worksheet_changesets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_changeset_decisions"
  ADD CONSTRAINT "worksheet_changeset_decisions_actor_id_fkey"
    FOREIGN KEY ("actor_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_revisions"
  ADD CONSTRAINT "worksheet_revisions_organization_id_changeset_id_fkey"
    FOREIGN KEY ("organization_id", "changeset_id")
    REFERENCES "estadistica_forms"."worksheet_changesets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."operation_receipts"
  ADD CONSTRAINT "operation_receipts_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "estadistica_forms"."organizations" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."operation_receipts"
  ADD CONSTRAINT "operation_receipts_actor_id_fkey"
    FOREIGN KEY ("actor_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."audit_events"
  ADD CONSTRAINT "audit_events_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "estadistica_forms"."organizations" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."audit_events"
  ADD CONSTRAINT "audit_events_actor_id_fkey"
    FOREIGN KEY ("actor_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
