BEGIN;

ALTER TABLE "estadistica_forms"."statistical_spaces" RENAME TO "projects";
ALTER TABLE "estadistica_forms"."projects"
  RENAME CONSTRAINT "statistical_spaces_pkey" TO "projects_pkey";
ALTER TABLE "estadistica_forms"."projects"
  RENAME CONSTRAINT "statistical_spaces_owner_id_fkey" TO "projects_owner_id_fkey";
ALTER TABLE "estadistica_forms"."projects"
  RENAME CONSTRAINT "statistical_spaces_name_check" TO "projects_name_check";
ALTER INDEX "estadistica_forms"."idx_statistical_spaces_owner_created"
  RENAME TO "idx_projects_owner_created";

ALTER TABLE "estadistica_forms"."projects"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "channel_profile" TEXT,
  ADD CONSTRAINT "project_configuration_complete" CHECK (
    (country IS NULL AND currency IS NULL AND channel_profile IS NULL)
    OR (country IS NOT NULL AND currency IS NOT NULL AND channel_profile IS NOT NULL)
  ),
  ADD CONSTRAINT "project_country_format" CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "project_currency_format" CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "project_channel_profile" CHECK (channel_profile = 'google_merchant');

COMMIT;
