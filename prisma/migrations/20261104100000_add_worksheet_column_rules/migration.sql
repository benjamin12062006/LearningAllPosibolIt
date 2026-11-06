BEGIN;

-- Columnas de selección y calculadas (ampliación E3.3, plan worksheets 03,
-- V1, V2, V6 y V10). `options` es la lista `[{ id, label }]` de una selección;
-- `formula` es `{ engine, expression, scale, rounding }` de una calculada, con
-- las columnas referenciadas por ID. Cada una existe solo en su tipo, y una
-- calculada no puede ser obligatoria: su valor sale del motor, no de la celda.
ALTER TABLE "estadistica_forms"."worksheet_column_versions"
  DROP CONSTRAINT "worksheet_column_versions_type_check",
  ADD CONSTRAINT "worksheet_column_versions_type_check"
    CHECK ("type" IN ('text', 'integer', 'decimal', 'date', 'boolean', 'selection', 'calculated')),
  ADD COLUMN "options" JSONB,
  ADD COLUMN "formula" JSONB,
  ADD CONSTRAINT "worksheet_column_versions_options_only_in_selection"
    CHECK (("type" = 'selection') = ("options" IS NOT NULL)),
  ADD CONSTRAINT "worksheet_column_versions_options_is_array"
    CHECK ("options" IS NULL OR jsonb_typeof("options") = 'array'),
  ADD CONSTRAINT "worksheet_column_versions_formula_only_in_calculated"
    CHECK (("type" = 'calculated') = ("formula" IS NOT NULL)),
  ADD CONSTRAINT "worksheet_column_versions_calculated_not_required"
    CHECK ("type" <> 'calculated' OR NOT "required");

COMMIT;
