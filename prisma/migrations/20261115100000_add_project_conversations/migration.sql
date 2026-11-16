BEGIN;

ALTER TABLE "estadistica_forms"."ai_conversations"
    ALTER COLUMN "workbook_id" DROP NOT NULL,
    ADD CONSTRAINT "ai_conversations_worksheet_requires_workbook_check"
        CHECK ("worksheet_id" IS NULL OR "workbook_id" IS NOT NULL),
    ADD CONSTRAINT "ai_conversations_organization_id_project_id_fkey"
        FOREIGN KEY ("organization_id", "project_id")
        REFERENCES "estadistica_forms"."projects"("organization_id", "id")
        ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
