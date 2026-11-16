BEGIN;

-- Credenciales delegadas (plan 07, D1): una persona da acceso a un cliente
-- externo (MCP) a un solo proyecto. Solo se guarda la huella del secreto.
CREATE TABLE "estadistica_forms"."integration_credentials" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "can_prepare" BOOLEAN NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "issue_key" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "revoked_at" TEXT,
    "revoked_by" TEXT,
    "last_used_at" TEXT,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_credentials_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 80),
    CONSTRAINT "integration_credentials_audience_check" CHECK ("audience" IN ('mcp', 'cli')),
    CONSTRAINT "integration_credentials_secret_hash_check" CHECK ("secret_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "integration_credentials_issue_key_check" CHECK (char_length("issue_key") BETWEEN 1 AND 255),
    CONSTRAINT "integration_credentials_revoked_check" CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL))
);

CREATE UNIQUE INDEX "integration_credentials_secret_hash_key" ON "estadistica_forms"."integration_credentials"("secret_hash");
CREATE UNIQUE INDEX "integration_credentials_project_id_owner_id_issue_key_key" ON "estadistica_forms"."integration_credentials"("project_id", "owner_id", "issue_key");
CREATE INDEX "idx_integration_credentials_project_created" ON "estadistica_forms"."integration_credentials"("project_id", "created_at" DESC, "id" DESC);

CREATE INDEX "idx_integration_credentials_project_owner" ON "estadistica_forms"."integration_credentials"("project_id", "owner_id");

ALTER TABLE "estadistica_forms"."integration_credentials" ADD CONSTRAINT "integration_credentials_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "estadistica_forms"."projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."integration_credentials" ADD CONSTRAINT "integration_credentials_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "estadistica_forms"."app_users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Las propuestas que prepara un cliente externo: una por llamada (`call_id`).
ALTER TABLE "estadistica_forms"."ai_proposals"
    ADD COLUMN "call_id" TEXT,
    ADD COLUMN "arguments_hash" TEXT,
    ADD CONSTRAINT "ai_proposals_integration_call_check" CHECK (
        ("run_id" IS NOT NULL AND "credential_id" IS NULL AND "call_id" IS NULL AND "arguments_hash" IS NULL)
        OR ("run_id" IS NULL AND "credential_id" IS NOT NULL AND "call_id" IS NOT NULL
            AND "arguments_hash" IS NOT NULL AND "arguments_hash" ~ '^[a-f0-9]{64}$')
    );

CREATE UNIQUE INDEX "ai_proposals_credential_id_call_id_key" ON "estadistica_forms"."ai_proposals"("credential_id", "call_id");

ALTER TABLE "estadistica_forms"."ai_proposals" ADD CONSTRAINT "ai_proposals_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "estadistica_forms"."integration_credentials"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Una fila por proyecto y sujeto. Al cambiar de minuto se reutiliza la fila.
CREATE TABLE "estadistica_forms"."integration_usage" (
    "project_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "minute" TEXT NOT NULL,
    "used" INTEGER NOT NULL,
    CONSTRAINT "integration_usage_pkey" PRIMARY KEY ("project_id", "subject"),
    CONSTRAINT "integration_usage_used_check" CHECK ("used" > 0),
    CONSTRAINT "integration_usage_project_id_fkey" FOREIGN KEY ("project_id")
        REFERENCES "estadistica_forms"."projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

COMMIT;
