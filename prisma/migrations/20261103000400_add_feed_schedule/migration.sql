BEGIN;

-- Programación diaria del feed (plan feeds&publications, D10): a qué hora local
-- y en qué zona horaria se actualiza. El worker inserta como mucho una
-- actualización por feed y fecha local.
ALTER TABLE "estadistica_forms"."feeds"
  ADD COLUMN "refresh_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "refresh_time" TEXT
    CHECK ("refresh_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN "time_zone" TEXT
    CHECK (char_length("time_zone") BETWEEN 1 AND 64);

-- Hora y zona van juntas, y activar la programación exige las dos.
ALTER TABLE "estadistica_forms"."feeds"
  ADD CONSTRAINT "feeds_schedule_complete_check"
    CHECK (
      ("refresh_time" IS NULL) = ("time_zone" IS NULL)
      AND (NOT "refresh_enabled" OR "refresh_time" IS NOT NULL)
    );

-- Fecha local (AAAA-MM-DD) de una actualización programada; nula si se disparó
-- a mano.
ALTER TABLE "estadistica_forms"."feed_refreshes"
  ADD COLUMN "scheduled_for" TEXT
    CHECK ("scheduled_for" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Una actualización programada por feed y fecha local: varias instancias o
-- varios ticks pueden intentarlo y solo una inserción gana (D10, F15). Los
-- nulos (disparo manual) no chocan entre sí.
CREATE UNIQUE INDEX "feed_refreshes_feed_id_scheduled_for_key"
  ON "estadistica_forms"."feed_refreshes" ("feed_id", "scheduled_for");

COMMIT;
