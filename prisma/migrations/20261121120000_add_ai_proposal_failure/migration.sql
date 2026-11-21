-- Plan 10 de ai-assistant, D7: si confirmar una propuesta del chat falla con un
-- error conocido, la propuesta queda `failed` con su error público y el agente
-- continúa con el motivo. Las del MCP siguen volviendo a `ready`.
BEGIN;

ALTER TABLE "estadistica_forms"."ai_proposals" ADD COLUMN "error" JSONB;

ALTER TABLE "estadistica_forms"."ai_proposals" DROP CONSTRAINT "ai_proposals_status_check";
ALTER TABLE "estadistica_forms"."ai_proposals" ADD CONSTRAINT "ai_proposals_status_check"
  CHECK ("status" IN ('ready', 'confirming', 'confirmed', 'rejected', 'failed'));
-- Solo una propuesta fallida guarda el error.
ALTER TABLE "estadistica_forms"."ai_proposals" ADD CONSTRAINT "ai_proposals_error_check"
  CHECK (("status" = 'failed') = ("error" IS NOT NULL));

COMMIT;
