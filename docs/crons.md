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
