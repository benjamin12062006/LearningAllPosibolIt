BEGIN;

-- Importar XLSX a un borrador de hoja (ampliación E5.2, plan imports&exports
-- 01, D14). La migración de E5.1 ya está aplicada: no se edita, se amplía
-- aquí la lista de formatos. PostgreSQL nombró la restricción en línea de
-- `format` como `worksheet_imports_format_check`.

ALTER TABLE "estadistica_forms"."worksheet_imports"
  DROP CONSTRAINT "worksheet_imports_format_check",
  ADD CONSTRAINT "worksheet_imports_format_check"
    CHECK ("format" IN ('csv', 'xlsx'));

COMMIT;
