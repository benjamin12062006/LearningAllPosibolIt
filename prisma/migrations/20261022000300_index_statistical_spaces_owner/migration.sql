CREATE INDEX "idx_statistical_spaces_owner_created"
  ON "estadistica_forms"."statistical_spaces" ("owner_id", "created_at" DESC, "id" DESC);
