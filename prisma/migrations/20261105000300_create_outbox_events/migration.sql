BEGIN;

-- Bandeja de salida (plan jobs&files, D8): un efecto que ocurre fuera de la
-- base se guarda aquí en la misma transacción que lo provoca y lo ejecuta
-- después el relay, con lease y token como los demás trabajos. Entrega «al menos
-- una vez»: cada manejador es idempotente y `done` es su recibo. `payload` lleva
-- solo claves, nunca datos del catálogo. Las fechas de creación y de proceso son
-- texto ISO, como en las demás tablas de trabajos; `run_after` nulo es «listo ya».
CREATE TABLE "estadistica_forms"."outbox_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('artifacts.delete')),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'running', 'done', 'failed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "run_after" TIMESTAMPTZ(3),
  "lease_until" TIMESTAMPTZ(3),
  "execution_token" TEXT,
  "error" JSONB,
  "created_at" TEXT NOT NULL,
  "processed_at" TEXT,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CHECK (("status" = 'running') = ("lease_until" IS NOT NULL)),
  CHECK (("lease_until" IS NULL) = ("execution_token" IS NULL)),
  CHECK (("status" IN ('done', 'failed')) = ("processed_at" IS NOT NULL)),
  CHECK (("status" = 'failed') = ("error" IS NOT NULL))
);

-- El relay recorre los pendientes del más antiguo al más nuevo.
CREATE INDEX "idx_outbox_events_ready"
  ON "estadistica_forms"."outbox_events" ("status", "created_at", "id");

COMMIT;
