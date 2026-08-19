# Sleeper OS Suite — Real Execution Packet

**Phase D Increment 10, updated by Increment 14.** This is the short, fill-in-the-blanks version of
[`SLEEPER_OS_SUITE_PROOF_CHECKLIST.md`](SLEEPER_OS_SUITE_PROOF_CHECKLIST.md) — read that doc for
full explanations, troubleshooting, and boundaries. This doc is meant to be read top-to-bottom once,
then executed. Every command below is copy/paste-ready once the placeholders are filled in.

**Before you start:**
- None of this should ever point at the production database. Every script below hard-refuses the
  production host on its own, but you are the last line of defense — double-check
  `<NONPROD_DATABASE_URL>` yourself before running anything.
- **(Increment 14)** Platform OS now has a real admin route + UI (Increments 11/12), gated by the
  existing internal site-admin check. Add `<PRESENTER_ACCOUNT_EMAIL>` to that environment's
  `ADMIN_EMAILS` env var *before* the demo — there is no demo-mode bypass, by design.
- **(Increment 14)** You need a browser-reachable app pointed at `<NONPROD_DATABASE_URL>` (a local
  `npm run dev`, or a deployed preview/staging environment) — the scripts below only write to the
  database; something else has to actually render the pages for Step 5's browser checks.

---

## 0. Fill in these placeholders once, reuse them below

| Placeholder | What it is | Where it comes from |
|---|---|---|
| `<NONPROD_DATABASE_URL>` | A non-production Postgres connection string (e.g. a throwaway Neon project) | You provision this; never the production host (`ep-curly-block`) |
| `<SLEEPER_USERNAME>` | A real Sleeper username to import from | An account you control on sleeper.com |
| `<SLEEPER_SOURCE_LEAGUE_ID>` | A real Sleeper league id (recommended over letting the importer auto-discover) | From that account's Sleeper league URL, e.g. `sleeper.com/leagues/<this id>` |
| `<AF_LEAGUE_ID>` | The AllFantasy league id created by Step 1 | Printed by Step 1 as `IMPORTED_LEAGUE_ID=...` — you don't have this until after Step 1 |
| `<MANAGER_ID>` | Either a real AF `userId`, or `sleeper:<sleeperUserId>` for an external-only manager | Printed by Step 2's identity-mapping log line, or looked up in `UserProfile.sleeperUserId` |
| `<COMMISSIONER_ACCOUNT>` | The account used for Step 1 (`decision-os-nonprod-importer@allfantasy.local`) or a real account that owns the league | Created automatically by Step 1 |
| `<MEMBER_ACCOUNT>` | A second, real AF account that has claimed a *different* roster/team in the same league | You create/claim this yourself in the non-prod environment, for the manager-only browser check |
| `<PRESENTER_ACCOUNT_EMAIL>` | The real account that will show the Platform OS panel — needs `ADMIN_EMAILS` access | Can be the same as `<COMMISSIONER_ACCOUNT>`, or a separate account; you add this yourself |
| `<CRON_SECRET>` | The value of `process.env.CRON_SECRET` in the environment you're demoing in | Set by whoever configured that environment; needed only for the optional snapshot-capture step |

---

## 1. Seed one real imported Sleeper league

```
DATABASE_URL=<NONPROD_DATABASE_URL> npx tsx scripts/decision-os-import-sleeper-nonprod.ts \
  --account=<SLEEPER_USERNAME> \
  --league=<SLEEPER_SOURCE_LEAGUE_ID>
```

Look for `IMPORTED_LEAGUE_ID=<...>` in the output — that value is your `<AF_LEAGUE_ID>` for every
step below. No dry-run mode on this script (it's the existing, already-idempotent import pipeline
reused as-is; `--force` re-imports over an existing league safely if you need to rerun it).

## 2. Dry-run the real Sleeper activity ingestion first (zero writes)

```
DATABASE_URL=<NONPROD_DATABASE_URL> npx tsx scripts/decision-os-ingest-sleeper-activity-nonprod.ts \
  --afLeagueId=<AF_LEAGUE_ID> \
  --dryRun
```

Confirms real rosters/transactions/draft-picks fetch correctly and identity mapping resolves, with
**no write**. Look for `SLEEPER_ACTIVITY_INGEST_DRY_RUN_OK` and the `DRY RUN — would ingest: ...`
line. Read the identity-mapping log line (`Identity mappings: N linked to a real AF account, M
external-only`) — this is where you'll find a candidate `<MANAGER_ID>` for Step 4.

If you see `WARNING: ... zero transactions AND zero draft picks`, manually check the Sleeper API URL
it prints before proceeding — see the full checklist's Troubleshooting section.

## 3. Run it for real (writes activity rows)

```
DATABASE_URL=<NONPROD_DATABASE_URL> npx tsx scripts/decision-os-ingest-sleeper-activity-nonprod.ts \
  --afLeagueId=<AF_LEAGUE_ID>
```

Same command as Step 2, minus `--dryRun`. Safe to re-run any time (idempotent writer). Look for
`SLEEPER_ACTIVITY_INGEST_OK`.

## 4. Capture a real behavioral snapshot (optional, recommended before presenting)

```
curl "<your-app-base-url>/api/cron/decision-os-snapshot-capture?leagueId=<AF_LEAGUE_ID>&secret=<CRON_SECRET>"
```

Not required — every OS surface degrades honestly without it (trend shows `no_snapshots`). But if you
want a real trend line during the demo, call this once now (right after Step 3, so it reflects real
ingested activity), then again later with real elapsed time before you actually present. This route
already exists and is already tested (`app/api/cron/decision-os-snapshot-capture/route.ts`) — it was
simply never mentioned in this packet until Increment 14.

## 5. Verify all three OS surfaces resolve (read-only)

```
DATABASE_URL=<NONPROD_DATABASE_URL> npx tsx scripts/decision-os-suite-conformance.ts \
  --leagueIds=<AF_LEAGUE_ID> \
  --managerId=<MANAGER_ID>
```

Look for `SUITE_CONFORMANCE_RESULT: N/N checks passed.` Every line should be `✅`. A `❌` means a
composition failed to resolve — not "zero activity" (see the full checklist §4 for that
distinction) — and is worth investigating before moving to the browser steps.

## 6. Browser verification

1. Sign in as `<COMMISSIONER_ACCOUNT>`, visit `/commissioner-hub` — confirm Mission Control + League
   Analytics render with real counts.
2. Sign in as `<COMMISSIONER_ACCOUNT>`, visit `/league/<AF_LEAGUE_ID>` — confirm the User OS ("Your
   Team") card renders.
3. Sign in as `<MEMBER_ACCOUNT>` (plain member, not commissioner), visit `/league/<AF_LEAGUE_ID>` —
   confirm the same User OS card renders identically for a non-commissioner role. This is the
   concrete manager-only proof.
4. **(Increment 14)** Sign in as `<PRESENTER_ACCOUNT_EMAIL>` (must already be in `ADMIN_EMAILS` for
   this environment), visit `/admin`, open the **"Platform OS"** panel, paste `<AF_LEAGUE_ID>`
   (comma-separated with a second league id for a richer demo) into the textarea, click **Fetch** —
   confirm the aggregate snapshot renders.

---

## Command order, at a glance

```
1. decision-os-import-sleeper-nonprod.ts              (writes: League/LeagueTeam/Roster + import audit)
2. decision-os-ingest-sleeper-activity-nonprod.ts --dryRun   (writes: none)
3. decision-os-ingest-sleeper-activity-nonprod.ts            (writes: DecisionOsImportedActivity)
4. GET /api/cron/decision-os-snapshot-capture          (writes: one BehavioralSnapshot row; optional)
5. decision-os-suite-conformance.ts                    (writes: none — read-only)
6. Browser: /commissioner-hub, /league/<AF_LEAGUE_ID>, and /admin (Platform OS panel) as up to
   three different accounts
```

## What this packet does NOT do

- Does not touch the production database — every script hard-refuses the production host
  (`ep-curly-block`) on its own.
- Does not fabricate any league, activity, or manager identity — every value is a real Sleeper API
  response, a real persisted AF row, or an honest zero/empty/skipped result.
- Does not auto-discover leagues — every league id used above is one you explicitly obtained and
  passed in.
- Does not touch Redraft/Start-Draft/PR-#166/AF-hosted-league work, DFS OS, or `the_replacements`
  provider work.
- Does not grant admin access automatically — `<PRESENTER_ACCOUNT_EMAIL>`'s `ADMIN_EMAILS` entry is a
  manual environment-configuration step you must do yourself before Step 6.4.
