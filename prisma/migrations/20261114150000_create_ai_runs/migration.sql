BEGIN;

-- Una ejecución del agente por mensaje de la persona (E6.3a, D1). Las fechas
-- son texto ISO en UTC, como el resto de tablas de IA.
CREATE TABLE "estadistica_forms"."ai_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_message_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT,
    "answer_message_id" TEXT,
    "error" JSONB,
    "credential_hash" TEXT,
    "claim_token" TEXT,
    "lease_until" TEXT,
    "deadline_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "started_at" TEXT,
    "finished_at" TEXT,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_runs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled')),
    CONSTRAINT "ai_runs_outcome_check" CHECK (
      ("status" = 'succeeded' AND "outcome" IN ('answered', 'confirmation_required', 'needs_clarification', 'limit_reached'))
      OR ("status" <> 'succeeded' AND "outcome" IS NULL)
    ),
    CONSTRAINT "ai_runs_context_check" CHECK (jsonb_typeof("context") = 'object'),
    CONSTRAINT "ai_runs_credential_check" CHECK ("credential_hash" IS NULL OR "credential_hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ai_runs_credential_only_running_check" CHECK ("status" = 'running' OR "credential_hash" IS NULL)
);

-- Las llamadas de la pasarela: se deduplican por `callId` (D7).
CREATE TABLE "estadistica_forms"."ai_run_calls" (
    "run_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "arguments_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" JSONB,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "ai_run_calls_pkey" PRIMARY KEY ("run_id", "call_id"),
    CONSTRAINT "ai_run_calls_mode_check" CHECK ("mode" IN ('execute', 'prepare')),
    CONSTRAINT "ai_run_calls_status_check" CHECK ("status" IN ('succeeded', 'failed')),
    CONSTRAINT "ai_run_calls_arguments_hash_check" CHECK ("arguments_hash" ~ '^[a-f0-9]{64}$')
);

-- Lo que el agente preparó y espera la confirmación de la persona (D6).
CREATE TABLE "estadistica_forms"."ai_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "run_id" TEXT,
    "credential_id" TEXT,
    "operation" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "target" JSONB,
    "summary" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "decided_at" TEXT,

    CONSTRAINT "ai_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_proposals_status_check" CHECK ("status" IN ('ready', 'confirming', 'confirmed', 'rejected')),
    CONSTRAINT "ai_proposals_hash_check" CHECK ("hash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ai_proposals_summary_check" CHECK (char_length(btrim("summary")) BETWEEN 1 AND 2000),
    CONSTRAINT "ai_proposals_origin_check" CHECK ("run_id" IS NOT NULL OR "credential_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "ai_runs_conversation_id_user_message_id_key" ON "estadistica_forms"."ai_runs"("conversation_id", "user_message_id");
CREATE UNIQUE INDEX "ai_runs_answer_message_id_key" ON "estadistica_forms"."ai_runs"("answer_message_id");
-- Una sola ejecución activa por conversación (D1).
CREATE UNIQUE INDEX "ai_runs_one_active_per_conversation" ON "estadistica_forms"."ai_runs"("conversation_id") WHERE "status" IN ('queued', 'running');
CREATE INDEX "idx_ai_runs_status_created" ON "estadistica_forms"."ai_runs"("status", "created_at");
-- Una propuesta por ejecución (D6).
CREATE UNIQUE INDEX "ai_proposals_run_id_key" ON "estadistica_forms"."ai_proposals"("run_id");

ALTER TABLE "estadistica_forms"."ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "estadistica_forms"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_runs" ADD CONSTRAINT "ai_runs_user_message_id_fkey" FOREIGN KEY ("user_message_id") REFERENCES "estadistica_forms"."ai_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_runs" ADD CONSTRAINT "ai_runs_answer_message_id_fkey" FOREIGN KEY ("answer_message_id") REFERENCES "estadistica_forms"."ai_messages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_runs" ADD CONSTRAINT "ai_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "estadistica_forms"."app_users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_run_calls" ADD CONSTRAINT "ai_run_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "estadistica_forms"."ai_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_proposals" ADD CONSTRAINT "ai_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "estadistica_forms"."ai_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "estadistica_forms"."ai_proposals" ADD CONSTRAINT "ai_proposals_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "estadistica_forms"."app_users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
