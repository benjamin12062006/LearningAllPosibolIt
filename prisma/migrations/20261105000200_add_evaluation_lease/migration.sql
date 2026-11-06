BEGIN;

-- Lease y token de ejecución para las evaluaciones (plan jobs&files, D5–D7),
-- igual que en `catalog_import_jobs`: sustituyen a `interruptRunning`. Un
-- reintento vuelve a `queued` con `run_after` en el futuro, así que los estados
-- públicos no cambian. `run_after` nulo significa «listo ya»; solo lo rellena
-- un reintento, con el reloj de la base.
ALTER TABLE "estadistica_forms"."evaluations"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  ADD COLUMN "run_after" TIMESTAMPTZ(3),
  ADD COLUMN "lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "execution_token" TEXT;

-- Transición (D6): una evaluación `running` al migrar la llevaba un proceso con
-- el código anterior. Lease ya vencido y un token que nadie tiene, para que la
-- primera pasada la recupere como un fallo temporal.
UPDATE "estadistica_forms"."evaluations"
SET
  "lease_until" = CURRENT_TIMESTAMP,
  "execution_token" = gen_random_uuid()::text
WHERE "status" = 'running';

ALTER TABLE "estadistica_forms"."evaluations"
  ADD CONSTRAINT "evaluations_lease_check"
    CHECK (("status" = 'running') = ("lease_until" IS NOT NULL)),
  ADD CONSTRAINT "evaluations_token_check"
    CHECK (("lease_until" IS NULL) = ("execution_token" IS NULL));

COMMIT;
