# Cron jobs

## The rule

**Do not add a new `crons` entry to `vercel.json` if an existing job can carry
the work.** Fold it into an existing route, or into an existing cadence.

This is the same rule the repo already applies to API routes, for the same
reason: the platform has a hard ceiling, and crossing it fails *silently*.

`scripts/cron-budget-check.mjs` enforces it in CI.

## Current state (verified, not assumed)

Checked with `vercel crons ls --scope cafeconchimmy`:

- **all declared cron jobs are registered** — the project is not over any limit
- query strings in cron paths work and are officially supported
  (Vercel's own docs show `/api/crons/sync-something?hello=world`), and each
  distinct path counts as its own cron slot

That last point is the trap. `/api/cron/import-scores` and
`/api/cron/import-scores?sport=NCAAF` look like one job with a parameter. They
are **two cron slots**.

## What the guard checks

1. **Ceiling** — total declared crons stays at or under the limit in the script.
2. **No duplicate `(route, schedule)` pairs** — two entries whose paths differ
   only by query string *and* share a schedule are one job in two slots. Hard
   failure.
3. **Cadence report** — prints the schedule buckets, so a new job can be placed
   next to an existing one instead of inventing a new schedule.

Run it locally:

```bash
node scripts/cron-budget-check.mjs
```

## How to add a scheduled job

In order of preference:

1. **Extend an existing handler.** If the work belongs to a job that already
   runs, add it there. No new cron entry.
2. **Make an existing handler cover the new case by default.** This is what
   `import-scores` and `import-injuries` do: omitting `?sport=` runs *every*
   sport, so college coverage costs no extra cron slot. An explicit `?sport=`
   still runs exactly one, for admin and manual calls.
3. **Reuse an existing cadence.** If it genuinely needs its own route, give it a
   schedule that already appears in `vercel.json` rather than a new one.
4. **Only then** add an entry — and if that pushes the count near the ceiling,
   consolidate something first.

### If you fold sports (or any variant) into one handler

Two properties are easy to lose and both matter:

- **Failure isolation.** Separate cron entries had it for free: one sport's
  provider being down could not stop the other. A merged handler must catch per
  variant and keep going, not `Promise.all` and reject.
- **Per-variant gating and reporting.** The rate-limit gate and the
  "zero rows written is a failure" check are per sport. Collapsing them into one
  aggregate hides a variant that silently writes nothing.

Run them **sequentially**, not concurrently — these routes exist partly to be
gentle with rate-limited providers, and firing every variant at once undoes that.

## Further consolidation (not done)

Beyond the duplicate-slot fixes, there is room to go further:

- **Same route, different schedules** — `brackets/world-cup/cron/sync` (5 slots),
  `import-schedules` (3), `import-news` (2). A handler that selects its job from
  the current time could collapse these.
- **One dispatcher per cadence bucket.** There are far fewer distinct cadences
  than jobs, so a registry-driven dispatcher per bucket would cut the count by
  roughly three quarters and make the ceiling structurally unreachable.

Neither is done. Both change how live production jobs are invoked, and the
failure mode is silent — a job simply stops running. Do them deliberately, with
`vercel crons ls` before and after, not as a side effect of another change.

## Injury polling cadence

`/api/cron/import-injuries` runs **hourly**, not every 15 minutes.

The vendor collects injuries **twice a day** — each morning, plus roughly an hour
before each game — from official team reports only, explicitly not from reporter
observations. `contracts/rolling-insights/ENDPOINTS.yaml` records the quote and
the instruction: *"There is no point polling /injuries every 35s — the data only
changes twice a day. Poll at ~06:00 local and again at T-90m per game."*

Hourly is the closest a Vercel cron gets to that. **T-90m per game is not
expressible** — it is relative to a kickoff time, and cron schedules are absolute.
Hourly catches both the morning collection and every pre-game update within an
hour of publication, at 24 calls a day instead of 96.

⚠ THE TRADE IS REAL AND WORTH KNOWING. Worst-case staleness goes from 15 minutes
to 60. An injury designation published at 11:15 on a Sunday is now seen at 12:00
rather than 11:30, and that is a lineup-relevant hour. The saving is ~72 calls a
day, which is negligible against the ~14,000 a live Sunday costs. This cadence
matches the vendor's documented guidance; if pre-kickoff freshness turns out to
matter more than doc-conformance, `*/15` was the better setting and reverting is
one line.

For the Wed/Thu/Fri DNP / Limited / Full grid: it does not exist in this feed at
all (vendor-confirmed `WONTFIX`). Parse NFL.com injury reports separately.
