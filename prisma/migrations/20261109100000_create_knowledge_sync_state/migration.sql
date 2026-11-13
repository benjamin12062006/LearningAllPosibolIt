BEGIN;

-- Qué fuentes de cada proyecto están ya en el índice de conocimiento del servicio
-- de IA y con qué huella (plan E6, D15–D16). Sin clave foránea a `projects`: si
-- el proyecto se borra, esta fila es lo que recuerda que hay que quitarlo de
-- Qdrant.

CREATE TABLE "estadistica_forms"."knowledge_sync_state" (
  "project_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL CHECK (
    "source_type" IN (
      'organization', 'project', 'workbook', 'worksheet', 'catalog',
      'evaluation', 'ruleset', 'feed', 'changeset', 'worksheet_import'
    )
  ),
  "source_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{32}$'),
  "synced_at" TEXT NOT NULL,
  CONSTRAINT "knowledge_sync_state_pkey"
    PRIMARY KEY ("project_id", "source_type", "source_id")
);

COMMIT;
