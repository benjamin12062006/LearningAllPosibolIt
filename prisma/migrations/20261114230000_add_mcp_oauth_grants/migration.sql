BEGIN;

ALTER TABLE "estadistica_forms"."integration_credentials"
  ADD COLUMN "resource_url" TEXT,
  DROP CONSTRAINT "integration_credentials_audience_check",
  ADD CONSTRAINT "integration_credentials_audience_check"
    CHECK ("audience" IN ('mcp', 'cli', 'mcp_oauth')),
  ADD CONSTRAINT "integration_credentials_resource_check"
    CHECK (("audience" = 'mcp_oauth') = ("resource_url" IS NOT NULL));

CREATE INDEX "idx_integration_credentials_oauth_owner"
  ON "estadistica_forms"."integration_credentials" ("project_id", "owner_id", "audience");

COMMIT;
