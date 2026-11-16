BEGIN;

-- Plantillas de mapeo de importación (plan 02 de cierre, H3): la parte de las
-- opciones de una importación que no depende del archivo (modo, clave,
-- separador decimal, etiquetas de booleanos y columnas), guardada con nombre
-- para una hoja. Las columnas van por ID, como en la importación: si una se
-- borra, la plantilla sigue y falla al usarse, con el error del mapeo.

CREATE TABLE "estadistica_forms"."worksheet_import_mappings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_normalized" TEXT NOT NULL,
  "mapping" JSONB NOT NULL CHECK (jsonb_typeof("mapping") = 'object'),
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_import_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worksheet_import_mappings_worksheet_id_name_normalized_key"
  ON "estadistica_forms"."worksheet_import_mappings" ("worksheet_id", "name_normalized");

CREATE INDEX "idx_worksheet_import_mappings_worksheet_created"
  ON "estadistica_forms"."worksheet_import_mappings" ("organization_id", "worksheet_id", "created_at" DESC);

ALTER TABLE "estadistica_forms"."worksheet_import_mappings"
  ADD CONSTRAINT "worksheet_import_mappings_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_import_mappings"
  ADD CONSTRAINT "worksheet_import_mappings_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
