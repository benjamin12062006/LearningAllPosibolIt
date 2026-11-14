BEGIN;

CREATE TABLE "estadistica_forms"."worksheet_transform_selections" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "revision_id" TEXT NOT NULL,
  "row_ids" JSONB NOT NULL,
  "column_ids" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "worksheet_transform_selections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worksheet_transform_selections_rows_check"
    CHECK (jsonb_typeof("row_ids") = 'array' AND jsonb_array_length("row_ids") <= 200),
  CONSTRAINT "worksheet_transform_selections_columns_check"
    CHECK (jsonb_typeof("column_ids") = 'array' AND jsonb_array_length("column_ids") BETWEEN 1 AND 200)
);

CREATE TABLE "estadistica_forms"."worksheet_transform_previews" (
  "id" TEXT NOT NULL,
  "selection_id" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "issue_count" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "changeset_id" TEXT,

  CONSTRAINT "worksheet_transform_previews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worksheet_transform_previews_changes_check"
    CHECK (jsonb_typeof("changes") = 'array' AND jsonb_array_length("changes") <= 1000),
  CONSTRAINT "worksheet_transform_previews_issue_count_check" CHECK ("issue_count" >= 0),
  CONSTRAINT "worksheet_transform_previews_hash_check" CHECK ("hash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "worksheets_organization_id_project_id_id_key"
  ON "estadistica_forms"."worksheets" ("organization_id", "project_id", "id");
CREATE INDEX "idx_worksheet_transform_selections_expires"
  ON "estadistica_forms"."worksheet_transform_selections" ("expires_at");
CREATE UNIQUE INDEX "worksheet_transform_previews_changeset_id_key"
  ON "estadistica_forms"."worksheet_transform_previews" ("changeset_id");
CREATE INDEX "idx_worksheet_transform_previews_expires"
  ON "estadistica_forms"."worksheet_transform_previews" ("expires_at");

ALTER TABLE "estadistica_forms"."worksheet_transform_selections"
  ADD CONSTRAINT "worksheet_transform_selections_organization_id_project_id__fkey"
    FOREIGN KEY ("organization_id", "project_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "worksheet_transform_selections_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "worksheet_transform_selections_worksheet_id_revision_id_fkey"
    FOREIGN KEY ("worksheet_id", "revision_id")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_transform_previews"
  ADD CONSTRAINT "worksheet_transform_previews_selection_id_fkey"
    FOREIGN KEY ("selection_id") REFERENCES "estadistica_forms"."worksheet_transform_selections" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "worksheet_transform_previews_changeset_id_fkey"
    FOREIGN KEY ("changeset_id") REFERENCES "estadistica_forms"."worksheet_changesets" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_changesets"
  DROP CONSTRAINT "worksheet_changesets_source_check",
  ADD CONSTRAINT "worksheet_changesets_source_check"
    CHECK ("source" IN ('manual', 'revert', 'import', 'ai'));

COMMIT;
