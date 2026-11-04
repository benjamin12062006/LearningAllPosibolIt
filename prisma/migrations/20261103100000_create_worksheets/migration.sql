BEGIN;

-- Libros y hojas libres con esquema y revisión inicial (ampliación E3.1, plan
-- worksheets 01). Todas las tablas llevan `organization_id` y se enlazan con
-- FK compuestas: un libro, una hoja o una revisión no pueden quedar en otra
-- organización que la de su proyecto (W1). Ninguna FK borra en cascada desde
-- proyectos: las revisiones no se pierden al borrar (W11).
-- Los nombres de restricciones e índices son los que genera Prisma.

-- Destino de las FK compuestas `(organization_id, project_id)`.
CREATE UNIQUE INDEX "projects_organization_id_id_key"
  ON "estadistica_forms"."projects" ("organization_id", "id");

CREATE TABLE "estadistica_forms"."workbooks" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  -- Para que «Precios» y « precios» sean el mismo nombre (W5).
  "name_normalized" TEXT NOT NULL CHECK ("name_normalized" = lower(btrim("name"))),
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "workbooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "estadistica_forms"."worksheets" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "workbook_id" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  "name_normalized" TEXT NOT NULL CHECK ("name_normalized" = lower(btrim("name"))),
  -- Solo hojas libres por ahora; las vistas vinculadas llegan en E8.
  "mode" TEXT NOT NULL CHECK ("mode" = 'free'),
  "schema_version" INTEGER NOT NULL CHECK ("schema_version" >= 1),
  -- Cuántas revisiones lleva; es la versión que comparará el apply de E4.
  "generation" INTEGER NOT NULL CHECK ("generation" >= 1),
  -- Nulo solo dentro de la transacción que crea la hoja: la revisión inicial
  -- se inserta después de la hoja y el puntero se fija antes de confirmar.
  "head_revision_id" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheets_pkey" PRIMARY KEY ("id")
);

-- Una fila por columna y versión de esquema. `column_id` no cambia al
-- renombrar ni al mover la columna (H4).
CREATE TABLE "estadistica_forms"."worksheet_column_versions" (
  "organization_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL CHECK ("schema_version" >= 1),
  "column_id" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  "name_normalized" TEXT NOT NULL CHECK ("name_normalized" = lower(btrim("name"))),
  "type" TEXT NOT NULL
    CHECK ("type" IN ('text', 'integer', 'decimal', 'date', 'boolean')),
  -- Hasta 200 columnas (H4).
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 199),
  "required" BOOLEAN NOT NULL,
  CONSTRAINT "worksheet_column_versions_pkey"
    PRIMARY KEY ("worksheet_id", "schema_version", "column_id")
);

-- Revisiones inmutables de una hoja, numeradas desde 1 (H5).
CREATE TABLE "estadistica_forms"."worksheet_revisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "worksheet_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" >= 1),
  "schema_version" INTEGER NOT NULL CHECK ("schema_version" >= 1),
  -- `initialize` es la revisión vacía al crear la hoja; E4 añadirá las demás.
  "source" TEXT NOT NULL CHECK ("source" IN ('initialize')),
  "row_count" INTEGER NOT NULL CHECK ("row_count" >= 0),
  "created_by" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "worksheet_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workbooks_project_id_name_normalized_key"
  ON "estadistica_forms"."workbooks" ("project_id", "name_normalized");

CREATE UNIQUE INDEX "workbooks_organization_id_project_id_id_key"
  ON "estadistica_forms"."workbooks" ("organization_id", "project_id", "id");

-- Libros de un proyecto, del más reciente al más antiguo.
CREATE INDEX "idx_workbooks_project_created"
  ON "estadistica_forms"."workbooks" ("organization_id", "project_id", "created_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "worksheets_workbook_id_name_normalized_key"
  ON "estadistica_forms"."worksheets" ("workbook_id", "name_normalized");

CREATE UNIQUE INDEX "worksheets_organization_id_id_key"
  ON "estadistica_forms"."worksheets" ("organization_id", "id");

-- Hojas de un libro, de la más reciente a la más antigua.
CREATE INDEX "idx_worksheets_workbook_created"
  ON "estadistica_forms"."worksheets" ("organization_id", "workbook_id", "created_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "worksheet_column_versions_worksheet_id_schema_version_name__key"
  ON "estadistica_forms"."worksheet_column_versions" ("worksheet_id", "schema_version", "name_normalized");

CREATE UNIQUE INDEX "worksheet_column_versions_worksheet_id_schema_version_posit_key"
  ON "estadistica_forms"."worksheet_column_versions" ("worksheet_id", "schema_version", "position");

CREATE UNIQUE INDEX "worksheet_revisions_worksheet_id_sequence_key"
  ON "estadistica_forms"."worksheet_revisions" ("worksheet_id", "sequence");

-- Destino de la FK compuesta del puntero al head.
CREATE UNIQUE INDEX "worksheet_revisions_worksheet_id_id_key"
  ON "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id");

ALTER TABLE "estadistica_forms"."workbooks"
  ADD CONSTRAINT "workbooks_organization_id_project_id_fkey"
    FOREIGN KEY ("organization_id", "project_id")
    REFERENCES "estadistica_forms"."projects" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."workbooks"
  ADD CONSTRAINT "workbooks_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheets"
  ADD CONSTRAINT "worksheets_organization_id_project_id_workbook_id_fkey"
    FOREIGN KEY ("organization_id", "project_id", "workbook_id")
    REFERENCES "estadistica_forms"."workbooks" ("organization_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- El head solo admite una revisión de la propia hoja: la FK incluye su id.
ALTER TABLE "estadistica_forms"."worksheets"
  ADD CONSTRAINT "worksheets_id_head_revision_id_fkey"
    FOREIGN KEY ("id", "head_revision_id")
    REFERENCES "estadistica_forms"."worksheet_revisions" ("worksheet_id", "id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheets"
  ADD CONSTRAINT "worksheets_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_column_versions"
  ADD CONSTRAINT "worksheet_column_versions_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_revisions"
  ADD CONSTRAINT "worksheet_revisions_organization_id_worksheet_id_fkey"
    FOREIGN KEY ("organization_id", "worksheet_id")
    REFERENCES "estadistica_forms"."worksheets" ("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."worksheet_revisions"
  ADD CONSTRAINT "worksheet_revisions_created_by_fkey"
    FOREIGN KEY ("created_by")
    REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
