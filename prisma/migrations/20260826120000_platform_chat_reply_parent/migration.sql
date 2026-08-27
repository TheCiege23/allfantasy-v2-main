-- Replies in DMs and huddles: give a platform chat message a parent.
--
-- ⚠ AUTHORED AND GATED, NOT AUTO-APPLIED. `.env`/`.env.local` in this repo point
-- at PRODUCTION, so this is applied by `scripts/apply-platform-chat-reply-parent.cjs`,
-- which is report-only until passed `--apply` and names its target out loud.
-- Rehearse it against `.env.test` (ep-muddy-leaf) first. Do NOT reach for
-- `prisma migrate deploy` — see the repo notes on the inverted prod guard.
--
-- ⚠ THIS IS THE COLUMN LEAGUE CHAT ALREADY HAS. `LeagueChatMessage.parentMessageId`
-- has existed and been indexed for a long time, and `PlatformChatMessage` — the
-- table DMs and huddles actually use — never got one. That asymmetry is the whole
-- reason quoted replies shipped for league chat only.
--
-- ⚠ ADDITIVE AND NULLABLE. Every existing row is a top-level message, which is
-- exactly what NULL means here, so no backfill is needed and nothing changes for
-- rows already stored. There is no foreign key, deliberately: league chat's
-- equivalent column has none either, and a self-referencing FK with ON DELETE
-- CASCADE would silently delete a whole conversation when one message at the top
-- of it is removed.

ALTER TABLE "platform_chat_messages"
  ADD COLUMN IF NOT EXISTS "parentMessageId" TEXT;

-- Reading a thread means "every message whose parent is this one", which is an
-- index scan or a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS "platform_chat_messages_parentMessageId_idx"
  ON "platform_chat_messages" ("parentMessageId");
