BEGIN;

-- Las filas y el trabajo de una importación no tienen sentido sin su snapshot:
-- al borrar el snapshot se borran con él. Las relaciones superiores
-- (projects → catalog_snapshots y app_users → projects) siguen en RESTRICT.
ALTER TABLE "estadistica_forms"."catalog_rows"
  DROP CONSTRAINT "catalog_rows_snapshot_id_fkey",
  ADD CONSTRAINT "catalog_rows_snapshot_id_fkey"
    FOREIGN KEY ("snapshot_id")
    REFERENCES "estadistica_forms"."catalog_snapshots" ("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "estadistica_forms"."catalog_import_jobs"
  DROP CONSTRAINT "catalog_import_jobs_project_id_snapshot_id_fkey",
  ADD CONSTRAINT "catalog_import_jobs_project_id_snapshot_id_fkey"
    FOREIGN KEY ("project_id", "snapshot_id")
    REFERENCES "estadistica_forms"."catalog_snapshots" ("project_id", "id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
