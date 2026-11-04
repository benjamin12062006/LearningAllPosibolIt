BEGIN;

-- Feed del proyecto y sus versiones publicadas (plan feeds&publications, D5 y
-- D6). La fuente remota, la política y la programación llegan en etapas
-- posteriores con sus propias migraciones.
-- Los nombres de restricciones e índices son los que genera Prisma.
CREATE TABLE "estadistica_forms"."feeds" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  -- Cuántas veces se ha publicado: es la versión que el operador manda al
  -- publicar y la condición del UPDATE que mueve el puntero (D6).
  "generation" INTEGER NOT NULL DEFAULT 0 CHECK ("generation" >= 0),
  "published_version_id" TEXT,
  -- Solo el SHA-256 del token de entrega; nulo = entrega desactivada (D7).
  "delivery_token_hash" TEXT CHECK ("delivery_token_hash" ~ '^[a-f0-9]{64}$'),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "feeds_pkey" PRIMARY KEY ("id"),
  -- Sin publicar, generación 0 y sin puntero; tras publicar, las dos cosas. No
  -- hay operación que retire la publicación.
  CHECK (("generation" = 0) = ("published_version_id" IS NULL))
);

-- Una versión publicada tiene su propio archivo (`feeds/<id>.tsv`, enlace del
-- TSV de la exportación). Evaluación y exportación solo dan trazabilidad: si se
-- borran, la versión y su archivo siguen (D5).
CREATE TABLE "estadistica_forms"."feed_versions" (
  "id" TEXT NOT NULL,
  "feed_id" TEXT NOT NULL,
  "evaluation_id" TEXT,
  "export_id" TEXT,
  -- Nulo cuando la retención retira el archivo de una versión antigua (D14).
  "artifact_key" TEXT CHECK ("artifact_key" ~ '^[0-9a-f-]{36}\.tsv$'),
  "tsv_checksum" TEXT NOT NULL CHECK ("tsv_checksum" ~ '^[a-f0-9]{64}$'),
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" > 0),
  "row_count" INTEGER NOT NULL CHECK ("row_count" BETWEEN 1 AND 5000),
  "published_by" TEXT NOT NULL CHECK ("published_by" IN ('operator', 'refresh')),
  "created_at" TEXT NOT NULL,
  CONSTRAINT "feed_versions_pkey" PRIMARY KEY ("id")
);

-- Un feed por proyecto: un único canal, Google, en la fase B.
CREATE UNIQUE INDEX "feeds_project_id_key"
  ON "estadistica_forms"."feeds" ("project_id");

CREATE UNIQUE INDEX "feeds_delivery_token_hash_key"
  ON "estadistica_forms"."feeds" ("delivery_token_hash");

CREATE UNIQUE INDEX "feed_versions_artifact_key_key"
  ON "estadistica_forms"."feed_versions" ("artifact_key");

-- Historial de versiones de un feed, de la más reciente a la más antigua.
CREATE INDEX "idx_feed_versions_feed_created"
  ON "estadistica_forms"."feed_versions" ("feed_id", "created_at" DESC, "id" DESC);

-- Destino de la FK compuesta del puntero publicado.
CREATE UNIQUE INDEX "feed_versions_feed_id_id_key"
  ON "estadistica_forms"."feed_versions" ("feed_id", "id");

ALTER TABLE "estadistica_forms"."feeds"
  ADD CONSTRAINT "feeds_project_id_fkey"
    FOREIGN KEY ("project_id")
    REFERENCES "estadistica_forms"."projects" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- El puntero solo admite una versión del propio feed: la FK incluye el id del
-- feed. Mientras es nulo no se comprueba (F29). No hace falta que sea diferible:
-- la versión se inserta antes de mover el puntero, en la misma transacción.
ALTER TABLE "estadistica_forms"."feeds"
  ADD CONSTRAINT "feeds_id_published_version_id_fkey"
    FOREIGN KEY ("id", "published_version_id")
    REFERENCES "estadistica_forms"."feed_versions" ("feed_id", "id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."feed_versions"
  ADD CONSTRAINT "feed_versions_feed_id_fkey"
    FOREIGN KEY ("feed_id")
    REFERENCES "estadistica_forms"."feeds" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."feed_versions"
  ADD CONSTRAINT "feed_versions_evaluation_id_fkey"
    FOREIGN KEY ("evaluation_id")
    REFERENCES "estadistica_forms"."evaluations" ("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."feed_versions"
  ADD CONSTRAINT "feed_versions_export_id_fkey"
    FOREIGN KEY ("export_id")
    REFERENCES "estadistica_forms"."exports" ("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT;
