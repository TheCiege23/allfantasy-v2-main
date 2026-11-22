# Fantrax NHL scoring verification — November 1, 2026

Authentic source: Top Shelf Cartel, Fantrax `u7lhl3f6mvmzwipj`, imported into staging
as `cdecc8d0-0c79-4853-9313-e900cbfb6703` with 12 populated rosters and 195 distinct players.

## Changes on current main's release branch

- Fantrax hockey categories now map to the native NHL stat keys. Goalie assists and
  penalty minutes have separate keys, retaining the league's 0.5 goalie PIM weight
  alongside its 0.2 skater PIM weight.
- Official NHL goalie per-game summaries enrich final RI boxes with goalie goals,
  assists and penalty minutes. Joins require date, name, both teams, saves and goals
  against. Ambiguous joins and conflicting boxes remain untouched.
- The existing NHL cron invokes the reconciler within its time budget, with at most
  three dates per invocation, daily caches and recent correction refreshes.
- RI refresh retains official proof only while game identity and core goalie stats agree.

## Staging evidence

- Existing guarded weekly Fantrax NHL identity job: 2,382 additive registry links;
  191/195 rostered players linked, three unmatched and one ambiguous. Zero overwrites.
- Official goalie dry run across 16 dates: 214 writable matches, 140 missing,
  six conflicts, zero ambiguous. After that full read-only validation, the guarded
  staging write applied exactly 214 rows, in addition to eight already verified rows.
- Repeat October 19 probe: eight already present, zero writes, cache hit.
- A read-only mismatch sample shows zero-stat backup goalie rows absent from the
  official appearance summary; one played goalie had a differing save total.
  Those rows are skipped, never filled with inferred zeros.

## Local evaluator evidence and remaining limits

The older, dirty working branch has the trade evaluator code, which is absent from
current main. Its league-context parser was repaired separately to recognize
`HEAD_TO_HEAD_POINTS_BASED` and re-read grouped NHL source settings retained in
`fantrax_settings.scoringSystem`. Unsupported weighted categories block scoring.
That local evaluator repair is not part of this release branch or a public deployment.

The real three-team receipt ran and rolled back both temporary trade and snapshot.
All 47 selected roster slots now have identities; 40 have sufficient complete scored
history (14/16, 13/16, 13/15). Grades and lineup deltas remain null. Every one of the
12 real rosters still contains at least one player without sufficient scored history.
The receipt retains `projectionsVerified=false`, `outcomeVerified=false` and
`contextualGradeAllowed=false`.

## Validation

- Focused TypeScript check of new modules and staging scripts: passed.
- Official goalie, official skater and captured Fantrax scoring tests: 19 passed.
- Live refresh regression, official goalie and captured scoring tests: 34 passed.
- Local legacy NHL context regressions: two passed.
- Full repository TypeScript invocation exceeded the default 4 GB heap. A replacement
  full check was interrupted by a tool-session reset; no full-repository pass is claimed.

Next: backfill actual NHL appearances from earlier dates/prior seasons and resolve
the four remaining identity gaps, then repeat the real receipt. Port the evaluator
from the dirty branch into a clean current-main branch before claiming public readiness.
