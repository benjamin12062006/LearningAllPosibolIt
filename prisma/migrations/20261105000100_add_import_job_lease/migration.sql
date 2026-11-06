BEGIN;

-- Lease y token de ejecución para los trabajos de importación (plan jobs&files,
-- D4–D6). Sustituyen a `interruptRunning`: un trabajo `running` lo lleva solo
-- quien tiene su token y mientras su lease no venza; si vence, otro proceso lo
-- recupera y lo vuelve a poner en cola. Un reintento vuelve a `queued` con
-- `run_after` en el futuro, así que los estados públicos no cambian.
--
-- `run_after` nulo significa «listo ya». Solo lo rellena un reintento, con el
-- reloj de la base. Sin valor por defecto, Prisma no lo calcula en el cliente
-- (que lo enviaría sin zona horaria, bitácora 04 de feeds).
ALTER TABLE "estadistica_forms"."catalog_import_jobs"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  ADD COLUMN "run_after" TIMESTAMPTZ(3),
  ADD COLUMN "lease_until" TIMESTAMPTZ(3),
  ADD COLUMN "execution_token" TEXT;

-- Transición (D6): un trabajo que esté `running` al migrar lo llevaba un proceso
-- con el código anterior. Se le da un lease ya vencido y un token que nadie
-- tiene, para que la primera pasada lo recupere como un fallo temporal.
UPDATE "estadistica_forms"."catalog_import_jobs"
SET
  "lease_until" = CURRENT_TIMESTAMP,
  "execution_token" = gen_random_uuid()::text
WHERE "status" = 'running';

ALTER TABLE "estadistica_forms"."catalog_import_jobs"
  ADD CONSTRAINT "catalog_import_jobs_lease_check"
    CHECK (("status" = 'running') = ("lease_until" IS NOT NULL)),
  ADD CONSTRAINT "catalog_import_jobs_token_check"
    CHECK (("lease_until" IS NULL) = ("execution_token" IS NULL));

COMMIT;
