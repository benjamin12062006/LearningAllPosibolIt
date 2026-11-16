BEGIN;

-- CreateTable
CREATE TABLE "estadistica_forms"."ai_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "workbook_id" TEXT NOT NULL,
    "worksheet_id" TEXT,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_conversations_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
    CONSTRAINT "ai_conversations_visibility_check" CHECK ("visibility" = 'private'),
    CONSTRAINT "ai_conversations_status_check" CHECK ("status" = 'active')
);

-- CreateTable
CREATE TABLE "estadistica_forms"."ai_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "author_id" TEXT,
    "client_message_id" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_messages_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "ai_messages_content_check" CHECK (char_length(btrim("content")) BETWEEN 1 AND 16000),
    CONSTRAINT "ai_messages_identity_check" CHECK (
      ("role" = 'user' AND "author_id" IS NOT NULL AND "client_message_id" IS NOT NULL)
      OR ("role" = 'assistant' AND "author_id" IS NULL AND "client_message_id" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "idx_ai_conversations_project_author" ON "estadistica_forms"."ai_conversations"("organization_id", "project_id", "created_by", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversation_id_sequence_key" ON "estadistica_forms"."ai_messages"("conversation_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ai_messages_conversation_id_author_id_client_message_id_key" ON "estadistica_forms"."ai_messages"("conversation_id", "author_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "worksheets_workbook_id_id_key" ON "estadistica_forms"."worksheets"("workbook_id", "id");

-- AddForeignKey
ALTER TABLE "estadistica_forms"."ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_project_id_workbook_id_fkey" FOREIGN KEY ("organization_id", "project_id", "workbook_id") REFERENCES "estadistica_forms"."workbooks"("organization_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "estadistica_forms"."ai_conversations" ADD CONSTRAINT "ai_conversations_workbook_id_worksheet_id_fkey" FOREIGN KEY ("workbook_id", "worksheet_id") REFERENCES "estadistica_forms"."worksheets"("workbook_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "estadistica_forms"."ai_conversations" ADD CONSTRAINT "ai_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "estadistica_forms"."app_users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "estadistica_forms"."ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "estadistica_forms"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "estadistica_forms"."ai_messages" ADD CONSTRAINT "ai_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "estadistica_forms"."app_users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
