BEGIN;

CREATE TABLE "estadistica_forms"."statistical_spaces" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  "owner_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "statistical_spaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "statistical_spaces_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "estadistica_forms"."app_users" ("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

COMMIT;
