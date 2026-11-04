BEGIN;

-- Actualizaciones de un feed (plan feeds&publications, D2–D4): un trabajo con
-- lease y token de ejecución. El reclamo, la recuperación de leases vencidos y
-- todas las escrituras del worker se condicionan al token vigente.
-- Los nombres de restricciones e índices son los que genera Prisma.
CREATE TABLE "estadistica_forms"."feed_refreshes" (
  "id" TEXT NOT NULL,
  "feed_id" TEXT NOT NULL,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'retry_wait', 'failed')),
  "stage" TEXT NOT NULL
    CHECK ("stage" IN ('fetch', 'import', 'evaluate', 'publish')),
  -- Fallos consumidos; esperar a que el proyecto quede libre no cuenta (D4).
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  -- Reloj de la base: todas las instancias comparan con el mismo (D2).
  "run_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMPTZ(3),
  "execution_token" TEXT,
  -- Ids previstos antes de crear cada cosa: no son FK para poder guardarlos
  -- antes de que existan (D9).
  "snapshot_id" TEXT,
  "import_job_id" TEXT,
  "evaluation_id" TEXT,
  "outcome" TEXT
    CHECK ("outcome" IN ('evaluated', 'published', 'unchanged', 'needs_review', 'conflict')),
  "error" JSONB,
  "created_at" TEXT NOT NULL,
  "finished_at" TEXT,
  CONSTRAINT "feed_refreshes_pkey" PRIMARY KEY ("id"),
  -- Solo un trabajo en curso tiene lease y token, y siempre los dos.
  CHECK (("status" = 'running') = ("lease_until" IS NOT NULL)),
  CHECK (("lease_until" IS NULL) = ("execution_token" IS NULL)),
  -- Terminado bien, con resultado; fallido, siempre con su error (en
  -- `retry_wait` se conserva el último error temporal).
  CHECK (("status" = 'succeeded') = ("outcome" IS NOT NULL)),
  CHECK ("status" <> 'failed' OR "error" IS NOT NULL),
  CHECK (("status" IN ('succeeded', 'failed')) = ("finished_at" IS NOT NULL))
);

-- Reclamo: los listos o con lease vencido, del más antiguo al más reciente.
CREATE INDEX "idx_feed_refreshes_queue"
  ON "estadistica_forms"."feed_refreshes" ("status", "run_after", "id");

-- Historial de actualizaciones de un feed.
CREATE INDEX "idx_feed_refreshes_feed_created"
  ON "estadistica_forms"."feed_refreshes" ("feed_id", "created_at" DESC, "id" DESC);

-- Una actualización activa por feed (D10). Prisma no expresa índices parciales.
CREATE UNIQUE INDEX "feed_refreshes_one_active_per_feed"
  ON "estadistica_forms"."feed_refreshes" ("feed_id")
  WHERE "status" IN ('queued', 'running', 'retry_wait');

ALTER TABLE "estadistica_forms"."feed_refreshes"
  ADD CONSTRAINT "feed_refreshes_feed_id_fkey"
    FOREIGN KEY ("feed_id")
    REFERENCES "estadistica_forms"."feeds" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
