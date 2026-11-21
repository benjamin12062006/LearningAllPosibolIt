ALTER TABLE "estadistica_forms"."integration_credentials"
  DROP CONSTRAINT "integration_credentials_audience_check",
  DROP CONSTRAINT "integration_credentials_resource_check",
  ADD CONSTRAINT "integration_credentials_audience_check"
    CHECK ("audience" IN ('mcp', 'cli', 'mcp_oauth', 'cli_oauth')),
  ADD CONSTRAINT "integration_credentials_resource_check"
    CHECK (("audience" IN ('mcp_oauth', 'cli_oauth')) = ("resource_url" IS NOT NULL));
