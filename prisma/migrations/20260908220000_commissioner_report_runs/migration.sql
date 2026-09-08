-- Commissioner Reports — the generated-artifact store.
--
-- WHY THIS TABLE EXISTS, given that Reports deliberately shipped unwired.
-- `lib/commissioner-ui/reports/decision-os-client/live.ts` declined to wire and was precise about
-- the reason: Reports is "a persisted-artifact system, the same structural class of gap as
-- Automation Center's execution log, not a porting gap." It went further and rejected generating a
-- report on the fly, because that "would still require fabricating `status`, `generatedAt` (of a
-- generation event that never happened), `format`, `sizeLabel`, and `shareLink` — every one of
-- Reports' own defining fields."
--
-- Every word of that is correct, and it is an argument for GENERATING AND KEEPING the artifact
-- rather than for leaving the module dark. Once a run really happens and its output is really
-- stored, none of those fields is invented:
--
--   generated_at   when the generator actually ran
--   status         the real outcome of that run
--   format         the format actually produced ('csv' — see below)
--   size_bytes     octet_length of the stored artifact, not a label someone typed
--   share_status   really 'private', because sharing is not built; `shareLink` stays absent
--
-- 🛑 THE ARTIFACT ITSELF IS STORED, NOT REGENERATED ON READ. If `content` were dropped and the
-- CSV rebuilt whenever someone downloaded it, `generated_at` and `size_bytes` would describe an
-- artifact that no longer exists — a file regenerated in December from a league that has moved on
-- is not the file the row claims was made in September. A report is a point-in-time record or it
-- is not a report.
--
-- ⚠ `format` IS TEXT AND TODAY ONLY EVER 'csv'. The contract's enum also allows 'pdf'; nothing
-- here generates one, so nothing here writes one. A column that can hold a value no writer
-- produces is how a UI ends up with a PDF filter that matches zero rows forever.
--
-- 🛑 NO SECOND COPY OF ANOTHER MODULE'S DATA — the module's own rule, kept literally. `content`
-- is a rendered CSV artifact, and `summary` is prose about it; neither is a queryable mirror of
-- League Analytics' warehouse. Nothing reads this table to answer a question about the league.
--
-- No foreign key on `league_id`: this schema carries more than one league id space, and a
-- commissioner's report history must not fail a page render over a constraint. Same reasoning as
-- `commissioner_workspace_tasks` and `recent_player_searches`.
--
-- Additive: one new table, no changes to existing ones, no backfill, no long lock.

CREATE TABLE IF NOT EXISTS "commissioner_report_runs" (
  "id"                 TEXT NOT NULL,
  "league_id"          TEXT NOT NULL,

  -- Which catalog entry produced this. Templates are CODE, not rows: a template is a description
  -- of a generator that exists in the repository, so storing them would let the table disagree
  -- with what the product can actually produce.
  "template_id"        TEXT NOT NULL,

  -- queued | generating | ready | failed. TEXT rather than an enum so adding a state is a code
  -- change and not a lock.
  "status"             TEXT NOT NULL DEFAULT 'ready',
  "format"             TEXT NOT NULL DEFAULT 'csv',

  -- Prose about what the artifact contains. Never the underlying data.
  "summary"            TEXT NOT NULL,

  -- The artifact. NULL only when the run failed and there is nothing to keep.
  "content"            TEXT,
  "size_bytes"         INTEGER NOT NULL DEFAULT 0,

  -- 'Scheduled' for a cron run, or how the person who asked for it should be described.
  "generated_by_label" TEXT NOT NULL DEFAULT 'Scheduled',

  -- private | shared. Only ever 'private' today; sharing has no implementation, so no row can
  -- honestly claim otherwise and no share link is stored.
  "share_status"       TEXT NOT NULL DEFAULT 'private',

  "failure_reason"     TEXT,

  "generated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "commissioner_report_runs_pkey" PRIMARY KEY ("id")
);

-- The history list: one league, newest first.
CREATE INDEX IF NOT EXISTS "commissioner_report_runs_league_id_generated_at_idx"
  ON "commissioner_report_runs"("league_id", "generated_at" DESC);

-- "when did this template last run for this league", which is what the schedule display needs.
CREATE INDEX IF NOT EXISTS "commissioner_report_runs_league_id_template_id_generated_at_idx"
  ON "commissioner_report_runs"("league_id", "template_id", "generated_at" DESC);

-- ⚠ DELIBERATELY NO UNIQUE CONSTRAINT. Repeated generations of one template are legitimate
-- history, not duplicates — that is what a report archive IS. Scheduled runs are kept to one per
-- period by the automation engine's idempotency key (which carries an ISO-week bucket), not by
-- the schema, because an on-demand run must always be allowed to proceed alongside them.
