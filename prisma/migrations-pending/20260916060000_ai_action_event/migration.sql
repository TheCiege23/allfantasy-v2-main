-- AiActionEvent — the table `lib/chimmy-actions/server-store.ts` has always written to and that
-- has never existed.
--
-- `createActionEvent` calls `(prisma as any).aiActionEvent.create(...)`. There is no such model in
-- schema.prisma, schema_from_db.prisma or tenancy.prisma, so every call throws,
-- `/api/ai/actions/events` returns 500 "Failed to persist action event", and every Chimmy
-- follow/completion rate built on these rows reads a table that was never there. The `as any` cast
-- is precisely why the typecheck could not see it.
--
-- NOT APPLIED. It sits in migrations-pending/ because `prisma migrate deploy` reads the DIRECTORY,
-- not git — see the README beside this file. Moving it into prisma/migrations/ is the deliberate,
-- authorised act.
--
-- GENERATED, NOT TYPED: `prisma migrate diff --from-schema-datamodel <pre> --to-schema-datamodel
-- prisma/schema.prisma --script`, run against a 127.0.0.1:1 sentinel so the CLI could not reach
-- .env (production). Hand-writing this is how seven index names drifted on the last one.
--
-- ⚠ WHEN THIS IS APPLIED, REMOVE THE `as any` CASTS IN server-store.ts IN THE SAME CHANGE.
-- Until the client is regenerated they cannot come off (the model is not on the client type yet),
-- and while they stay on, nothing typechecks this table's usage — which is the condition that let
-- a phantom model live in the tree.

-- CreateTable
CREATE TABLE "ai_action_events" (
    "id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "league_id" TEXT,
    "team_id" TEXT,
    "sport" TEXT,
    "event" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_action_events_user_id_timestamp_idx" ON "ai_action_events"("user_id", "timestamp");

-- CreateIndex
CREATE INDEX "ai_action_events_league_id_idx" ON "ai_action_events"("league_id");

-- CreateIndex
CREATE INDEX "ai_action_events_action_type_idx" ON "ai_action_events"("action_type");

-- CreateIndex
CREATE INDEX "ai_action_events_event_idx" ON "ai_action_events"("event");

