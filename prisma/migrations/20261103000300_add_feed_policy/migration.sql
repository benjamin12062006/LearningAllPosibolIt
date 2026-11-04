BEGIN;

-- Política aprobada del feed (plan feeds&publications, D11): qué revisión de
-- reglas evalúa la actualización automática y qué límites tiene que cumplir el
-- resultado para publicarse sin revisión. El servidor fija además las versiones
-- del motor y del perfil vigentes al aprobar: si cambian, hay que reaprobar.
ALTER TABLE "estadistica_forms"."feeds"
  ADD COLUMN "policy_ruleset_revision" INTEGER
    CHECK ("policy_ruleset_revision" >= 1),
  ADD COLUMN "policy_max_invalid" INTEGER
    CHECK ("policy_max_invalid" BETWEEN 0 AND 5000),
  ADD COLUMN "policy_max_excluded" INTEGER
    CHECK ("policy_max_excluded" BETWEEN 0 AND 5000),
  ADD COLUMN "policy_max_drop_percent" INTEGER
    CHECK ("policy_max_drop_percent" BETWEEN 0 AND 100),
  ADD COLUMN "policy_engine_version" TEXT,
  ADD COLUMN "policy_profile_version" TEXT,
  ADD COLUMN "policy_approved_at" TEXT;

-- La política va completa o no va.
ALTER TABLE "estadistica_forms"."feeds"
  ADD CONSTRAINT "feeds_policy_complete_check"
    CHECK (
      ("policy_ruleset_revision" IS NULL) = ("policy_max_invalid" IS NULL)
      AND ("policy_ruleset_revision" IS NULL) = ("policy_max_excluded" IS NULL)
      AND ("policy_ruleset_revision" IS NULL) = ("policy_max_drop_percent" IS NULL)
      AND ("policy_ruleset_revision" IS NULL) = ("policy_engine_version" IS NULL)
      AND ("policy_ruleset_revision" IS NULL) = ("policy_profile_version" IS NULL)
      AND ("policy_ruleset_revision" IS NULL) = ("policy_approved_at" IS NULL)
    );

-- La generación del feed al disparar: la actualización solo publica si sigue
-- siendo esa (D11). Si el operador publica a mano entretanto, no se pisa.
ALTER TABLE "estadistica_forms"."feed_refreshes"
  ADD COLUMN "expected_generation" INTEGER
    CHECK ("expected_generation" >= 0);

-- `evaluated` era el resultado provisional de E4, sin publicación.
ALTER TABLE "estadistica_forms"."feed_refreshes"
  DROP CONSTRAINT "feed_refreshes_outcome_check",
  ADD CONSTRAINT "feed_refreshes_outcome_check"
    CHECK ("outcome" IN ('published', 'unchanged', 'needs_review', 'conflict'));

COMMIT;
