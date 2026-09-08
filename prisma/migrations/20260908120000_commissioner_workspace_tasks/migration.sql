-- Commissioner Workspace — the persisted task store.
--
-- WHY THIS TABLE EXISTS AT ALL, since the module shipped without one on purpose.
-- `lib/commissioner-ui/workspace/decision-os-client/live.ts` refused to wire
-- Workspace and gave a specific reason: `status`, `createdAt` and `updatedAt`
-- "would have to be invented (nothing tracks whether a commissioner already
-- started or finished a given item), which is exactly the fabrication this whole
-- program has never done." That reasoning was right, and it is an argument for a
-- store rather than against wiring. With rows, `created_at` is when we first
-- detected the condition, `status` is whatever the commissioner last set, and
-- nothing is invented.
--
-- 🛑 THE WRITER LANDS WITH THE READ, NEVER AFTER IT. Root CLAUDE.md's worked
-- example is `ingestCFBDStats`: a table nothing refreshes is worse than the live
-- call it replaced, because it fails silently and looks correct. The writer here
-- is `lib/commissioner-workspace/taskStore.ts`, driven by the
-- `workspace.refreshTasks` automation job.
--
-- ⚠ `last_seen_at` AND `updated_at` ARE DIFFERENT QUESTIONS AND THAT IS THE POINT.
-- The seeder re-observes every condition on a schedule. If re-observation bumped
-- `updated_at`, that column would mean "the automation ran" while still being
-- named and read as "this task changed" — the exact class of field that looks
-- meaningful and is not. So `last_seen_at` moves on every run, and `updated_at`
-- moves only when something a commissioner would notice actually changed.
--
-- No foreign key on `league_id`, for the reason `recent_player_searches` already
-- records: this schema carries more than one league id space (see the root
-- CLAUDE.md and `legacy-vs-modern-league-id-spaces`), and a commissioner's task
-- list must not fail a page render over a constraint.
--
-- Additive: one new table, no changes to existing ones, no backfill, no long lock.
--
-- NOT APPLIED. Applying a migration to production is the user's decision, not the
-- author's and not the pusher's — root CLAUDE.md, "A MIGRATION IS NOT PUSHABLE
-- WORK". Until it is applied, `commissioner_os_live_ready_workspace` stays off and
-- the module serves stub/demo exactly as it does today.

CREATE TABLE IF NOT EXISTS "commissioner_workspace_tasks" (
  "id"                   TEXT NOT NULL,
  "league_id"            TEXT NOT NULL,

  -- Stable identity for a DETECTED condition, e.g. `data-stale:v1` or
  -- `inactive-managers:v1`. It is what makes the seeder idempotent: re-running it
  -- must touch the existing row, never add a second copy of the same finding.
  -- Versioned in the string so that changing what a detector means can deliberately
  -- open a new task rather than silently rewriting the old one's history.
  "source_key"           TEXT NOT NULL,

  "title"                TEXT NOT NULL,
  "description"          TEXT NOT NULL,

  -- Workspace's own six-state vocabulary: open | in_progress | waiting_on_manager
  -- | waiting_on_league_vote | completed | archived. Left as TEXT rather than a
  -- Postgres enum so adding a state is a code change and not a lock.
  "status"               TEXT NOT NULL DEFAULT 'open',

  -- The shared SeverityTier vocabulary: critical | elevated | standard | advisory |
  -- positive. Priority and status are deliberately different languages here, the
  -- same split Recommendations Center already draws.
  "priority"             TEXT NOT NULL DEFAULT 'standard',

  "due_at"               TIMESTAMP(3),
  "automation_candidate" BOOLEAN NOT NULL DEFAULT false,

  -- CommissionerRelatedLink[] — a pointer back to the module whose evidence
  -- justified the task. Workspace never duplicates that module's data.
  "related_links"        JSONB,

  -- Set when the commissioner resolved it, NOT when the condition cleared on its
  -- own; `auto_resolved_at` is the other one, so a queue can tell "you fixed this"
  -- from "this stopped being true".
  "resolved_at"          TIMESTAMP(3),
  "auto_resolved_at"     TIMESTAMP(3),

  "last_seen_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "commissioner_workspace_tasks_pkey" PRIMARY KEY ("id")
);

-- The idempotency guarantee the seeder depends on.
CREATE UNIQUE INDEX IF NOT EXISTS "commissioner_workspace_tasks_league_id_source_key_key"
  ON "commissioner_workspace_tasks"("league_id", "source_key");

-- The list query: one league's tasks, newest first, filtered by state.
CREATE INDEX IF NOT EXISTS "commissioner_workspace_tasks_league_id_status_idx"
  ON "commissioner_workspace_tasks"("league_id", "status");

-- The "Due Soon" queue, which is cross-league for an operator view.
CREATE INDEX IF NOT EXISTS "commissioner_workspace_tasks_status_due_at_idx"
  ON "commissioner_workspace_tasks"("status", "due_at");
