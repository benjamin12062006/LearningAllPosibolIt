BEGIN;

-- Archivar un libro o una hoja (plan 02 de cierre, H1): se sigue pudiendo leer,
-- pero no admite borradores, importaciones ni llevarla al catálogo. Nulo es
-- «activo». El nombre de lo archivado sigue reservado: las restricciones únicas
-- no cambian, así que restaurar nunca choca con otro nombre.

ALTER TABLE "estadistica_forms"."workbooks"
  ADD COLUMN "archived_at" TEXT;

-- Duplicar una hoja (H1): la copia nace con IDs nuevos y recuerda de qué hoja
-- y de qué revisión salió. Sin clave foránea: es procedencia, no una
-- dependencia, y la copia no cambia si el origen se archiva.

ALTER TABLE "estadistica_forms"."worksheets"
  ADD COLUMN "archived_at" TEXT,
  ADD COLUMN "source_worksheet_id" TEXT,
  ADD COLUMN "source_revision_id" TEXT,
  ADD CONSTRAINT "worksheets_source_complete"
    CHECK (("source_worksheet_id" IS NULL) = ("source_revision_id" IS NULL));

-- La primera revisión de una copia no está vacía ni sale de un borrador.

ALTER TABLE "estadistica_forms"."worksheet_revisions"
  DROP CONSTRAINT "worksheet_revisions_source_check",
  ADD CONSTRAINT "worksheet_revisions_source_check"
    CHECK ("source" IN ('initialize', 'changeset', 'duplicate'));

COMMIT;
