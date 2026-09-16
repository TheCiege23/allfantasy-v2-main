-- AiSavedRecommendation — the second phantom model in lib/chimmy-actions/server-store.ts.
--
-- Four accessors write and read `(prisma as any).aiSavedRecommendation` against a model that has
-- never existed, so `/api/ai/actions/recommendations` (GET + POST) and
-- `/api/ai/actions/recommendations/[id]` have been 500ing. Companion to
-- 20260916060000_ai_action_event; both casts hid both models from the typecheck.
--
-- ⚠ THIS IS THE `SavedAIRecommendation` SHAPE, NOT `UnifiedSavedRecommendation`. Those are two
-- different models of the same idea. This one is what the LIVE accessors use. The Unified one
-- (title, summary, status, isArchived, payloadHash, confidence, riskLevel, actions[]) is what the
-- separately-stubbed lib/saved-recommendations/SavedRecommendationsService.ts returns — seven
-- exports with zero prisma calls. They share six fields and diverge on the rest. Serving both from
-- one table is a product decision (superset / second table / migrate the legacy writer) and is
-- deliberately NOT taken here. Modelling the live shape is what un-breaks the two routes.
--
-- NOT APPLIED. Parked because `prisma migrate deploy` reads the DIRECTORY, not git — see the
-- README beside this file. Moving it is the authorised act.
--
-- GENERATED, NOT TYPED: `prisma migrate diff --from-schema-datamodel <pre> --to-schema-datamodel
-- prisma/schema.prisma --script`, against a 127.0.0.1:1 sentinel so the CLI could not reach .env
-- (production).
--
-- ⚠ REMOVE THE `as any` CASTS IN server-store.ts IN THE SAME CHANGE THAT APPLIES THIS. They cannot
-- come off before the client is regenerated, and while they stay on nothing typechecks this
-- table's usage — the condition that let two phantom models live in one file.

-- CreateTable
CREATE TABLE "ai_saved_recommendations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "league_id" TEXT,
    "sport" TEXT NOT NULL,
    "league_type" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "recommendation_text" TEXT NOT NULL,
    "action" JSONB NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "acted_on" BOOLEAN NOT NULL DEFAULT false,
    "acted_on_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_saved_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_saved_recommendations_user_id_saved_at_idx" ON "ai_saved_recommendations"("user_id", "saved_at");

-- CreateIndex
CREATE INDEX "ai_saved_recommendations_league_id_idx" ON "ai_saved_recommendations"("league_id");

