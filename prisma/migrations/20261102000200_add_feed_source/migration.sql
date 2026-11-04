BEGIN;

-- Fuente remota del feed (plan feeds&publications, D9): la URL del CSV y cómo
-- leerlo, igual que una importación subida. La comprobación de la URL (https,
-- sin credenciales, destino público) la hace la API al guardarla y al
-- descargar; la base solo limita longitudes y valores.
ALTER TABLE "estadistica_forms"."feeds"
  ADD COLUMN "source_url" TEXT
    CHECK (char_length("source_url") BETWEEN 1 AND 2048),
  ADD COLUMN "source_id_column" TEXT
    CHECK (char_length("source_id_column") BETWEEN 1 AND 128),
  ADD COLUMN "source_delimiter" TEXT
    CHECK ("source_delimiter" IN ('comma', 'semicolon'));

-- La fuente va completa o no va: sin URL no hay columna ni separador.
ALTER TABLE "estadistica_forms"."feeds"
  ADD CONSTRAINT "feeds_source_complete_check"
    CHECK (
      ("source_url" IS NULL) = ("source_id_column" IS NULL)
      AND ("source_url" IS NULL) = ("source_delimiter" IS NULL)
    );

COMMIT;
