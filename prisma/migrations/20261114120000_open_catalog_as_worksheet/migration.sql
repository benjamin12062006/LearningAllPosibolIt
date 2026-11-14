BEGIN;

-- Abrir un catálogo como hoja (plan 02 de cierre, H5): una hoja nueva con las
-- cabeceras y las filas de un snapshot terminado, que recuerda de cuál salió.
-- Sin clave foránea: es procedencia, y la hoja sigue si se borra la
-- importación. Una hoja sale de otra hoja o de un catálogo, nunca de los dos.

ALTER TABLE "estadistica_forms"."worksheets"
  ADD COLUMN "source_catalog_snapshot_id" TEXT,
  ADD CONSTRAINT "worksheets_single_source"
    CHECK ("source_catalog_snapshot_id" IS NULL OR "source_worksheet_id" IS NULL);

ALTER TABLE "estadistica_forms"."worksheet_revisions"
  DROP CONSTRAINT "worksheet_revisions_source_check",
  ADD CONSTRAINT "worksheet_revisions_source_check"
    CHECK ("source" IN ('initialize', 'changeset', 'duplicate', 'catalog'));

COMMIT;
