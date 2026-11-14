BEGIN;

-- Los hitos de una ejecución, en orden (E6.4, D2): se guardan en la misma
-- transacción que el estado que representan y la web los reproduce por SSE
-- desde una secuencia (`after`).
CREATE TABLE "estadistica_forms"."ai_run_events" (
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "ai_run_events_pkey" PRIMARY KEY ("run_id", "sequence"),
    CONSTRAINT "ai_run_events_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "ai_run_events_type_check" CHECK ("type" IN (
      'run.queued', 'run.started', 'tool.started', 'tool.completed',
      'proposal.ready', 'run.completed', 'run.failed', 'run.cancelled'
    )),
    CONSTRAINT "ai_run_events_payload_check" CHECK (jsonb_typeof("payload") = 'object')
);

ALTER TABLE "estadistica_forms"."ai_run_events" ADD CONSTRAINT "ai_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "estadistica_forms"."ai_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
