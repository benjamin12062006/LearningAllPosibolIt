BEGIN;

-- Vistas guardadas de una hoja (plan 02 de cierre, H4): un filtro, un orden y
-- las columnas visibles con nombre. No cambian ningún valor de la hoja (12).
-- Una vista personal solo la ve quien la creó; una del equipo, todos los
-- miembros. `query` tiene la forma de `rows/query` y se valida al guardarla y
-- al usarla contra las columnas de la hoja en ese momento.

CREATE TABLE "estadistica_forms"."worksheet_saved_views" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "name_normalized" TEXT NOT NULL,
  "visibility" TEXT NOT NULL CHECK ("visibility" IN ('personal', 'team')),
  "query" JSONB NOT NULL CHECK (jsonb_typeof("query") = 'object'),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_saved_views_pkey" PRIMARY KEY ("id")
);

-- El nombre es único entre las vistas de una persona en la hoja.
CREATE UNIQUE INDEX "worksheet_saved_views_worksheet_id_owner_id_name_normalized_key"
  ON "estadistica_forms"."worksheet_saved_views" ("worksheet_id", "owner_id", "name_normalized");

CREATE INDEX "idx_worksheet_saved_views_worksheet_created"
  ON "estadistica_forms"."worksheet_saved_views" ("organization_id", "worksheet_id", "created_at" DESC);

ALTER TABLE "estadistica_forms"."worksheet_saved_views"
  ADD CONSTRAINT "worksheet_saved_views_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_saved_views"
  ADD CONSTRAINT "worksheet_saved_views_owner_id_fkey"
    FOREIGN KEY ("owner_id")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
