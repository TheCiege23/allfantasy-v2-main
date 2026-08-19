# Sleeper OS Suite Proof Checklist

**Status: verification procedure + harness. No production data touched. No fake data used anywhere
in this procedure — every step either reads/writes real (if currently activity-empty, or now
real-activity-populated per Increment 7) imported league data, or honestly reports why a signal
isn't populated yet.**

**Date:** 2026-07-09 · **Branch:** `g15-event-foundation`. **Phase D Increment 6, updated by
Increment 7, hardened into an operator-ready runbook by Increment 8, updated for real Platform OS
route/UI + snapshot capture by Increment 14** (successor to
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md),
[`USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md`](USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md), and
[`PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md`](PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md)). See also
[`CUSTOMER_DEMO_READINESS_AUDIT.md`](CUSTOMER_DEMO_READINESS_AUDIT.md) (Increment 13) for the full
demo-readiness picture this update closes the documentation gaps for.

---

## 1. What this proves, and what it honestly does not yet

This procedure proves that **Commissioner OS, User OS, and Platform OS all resolve correctly
against a real, non-prod database, for a real (Sleeper-imported) league** — the same code path used
in production, run against real infrastructure instead of a unit-test fixture.

**As of Increment 7, it can also populate real, non-zero trade/waiver/draft-activity signals** for
that same league — see the new §3b. The standard Sleeper import pipeline (§3) populates
`League`/`LeagueTeam`/`Roster` (so the league is real, navigable, and viewable) but never populated
`DecisionOsImportedActivity` (the table Decision OS's behavioral pipeline reads) on its own — this
was already flagged in
[`DECISION_OS_PHASE_A_IMPLEMENTATION.md`](DECISION_OS_PHASE_A_IMPLEMENTATION.md) §3 and
[`USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md`](USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md) §11.
**Increment 7's new orchestration script (§3b) closes this gap** — it fetches that same league's
real trades/waivers/roster-moves/draft-picks from the public Sleeper API and runs them through the
already-built Phase A pipeline. **Honesty caveat, carried forward from every prior "real Sleeper"
step in this workstream:** this script's logic is real and type-correct, reusing only already-tested
pipeline pieces, but has **not been executed against a live Sleeper league in this sandbox** — there
is no live network access here. Running it for real, against a real non-prod database and a real
Sleeper league, is the next concrete step (§10).

---

## 2. Prerequisites

- A non-production `DATABASE_URL` (e.g. a throwaway Neon project, the same kind used for every
  other real-DB proof in this workstream — never the production host, `ep-curly-block`, which every
  script below hard-refuses).
- Node + `npx tsx` available (already a repo dependency).
- No production DB credentials should ever be set in the shell running these commands.
- **(Increment 14, if doing §3c snapshot capture)** `CRON_SECRET` must be set in the environment you
  call `/api/cron/decision-os-snapshot-capture` against.
- **(Increment 14, if doing §8's browser step)** The presenter's account email must already be in
  that environment's `ADMIN_EMAILS` env var (or match a hardcoded test account in `lib/auth/admin.ts`)
  — this is required before the demo, not something any script here configures for you.
- A browser-reachable app pointed at the same `DATABASE_URL` (a local `npm run dev`, or a deployed
  preview/staging environment) — the scripts below only write to the database; something else needs
  to actually render the pages for §6/§7/§8's browser steps.

---

## 3. Step 1 — Seed one real imported Sleeper league (existing script, unchanged)

```
DATABASE_URL=<your-nonprod-db> npx tsx scripts/decision-os-import-sleeper-nonprod.ts \
  --account=<a real Sleeper username> \
  --league=<a real Sleeper league id, recommended over discovery>
```

This runs the **actual production import pipeline** (`runImportedLeagueNormalizationPipeline` →
`buildCanonicalImportBundle` → `persistImportWithCanonicalAudit`), sourced from the **public Sleeper
API** (a real, live fetch — not a fixture), against your non-prod database only. It creates a
dedicated, clearly-named importer account (`decision-os-nonprod-importer@allfantasy.local`) to own
the import, and prints:

```
IMPORTED_LEAGUE_ID=<leagueId>
```

**Save this `leagueId`** — every following step uses it explicitly. This script was not written or
modified for this increment; it already existed and is reused as-is.

---

## 3b. Step 1.5 — Ingest that same league's REAL Sleeper activity (Increment 7, flag hardened in Increment 8)

```
DATABASE_URL=<same-nonprod-db> npx tsx scripts/decision-os-ingest-sleeper-activity-nonprod.ts \
  --afLeagueId=<leagueId from step 1> \
  [--weeks=<N, default 18>] [--dryRun]
```

**`--dryRun` (Increment 10):** runs every real step (league lookup, real Sleeper roster/transaction/
draft-pick fetch, real identity-mapping resolution) but stops before the actual write, printing the
same counts a real run would under a `DRY RUN` prefix and a distinct
`SLEEPER_ACTIVITY_INGEST_DRY_RUN_OK` sentinel. Use this first on a real run to confirm the league id,
DB connectivity, and identity mapping all resolve as expected with zero risk, then re-run the exact
same command without `--dryRun` to actually write. (The writer itself is already idempotent/safe to
re-run — see below — so `--dryRun` is an added zero-write checkpoint, not a fix for an unsafe path.)

**Flag name note (Increment 8):** this script's flag is `--afLeagueId`, deliberately **not**
`--league` — §3's `decision-os-import-sleeper-nonprod.ts` uses `--league` for the **Sleeper source**
league id, the opposite meaning. Using the same flag name across both scripts in this same proof
chain would be a real, easy copy/paste mistake; they're named differently on purpose.

**Safe to re-run.** The underlying writer is idempotent by natural key (proven in Phase A's own
tests) — re-running this script for the same league converges to updated rows, never duplicates.
Re-run it later to pick up new real activity that happened since the last run.

**New file: `scripts/decision-os-ingest-sleeper-activity-nonprod.ts`** — closes the gap that used to
be described in this section as still-open. Reuses the existing, unchanged Phase A pipeline
end-to-end (`ingestSleeperImportedActivity` → normalizer → writer → `PrismaImportedActivityStore`) —
this script's only new logic is orchestration:

1. Looks up the already-imported AF `League` row (from §3) and confirms it's a real
   `platform: 'sleeper'` league with a real `platformLeagueId` — refuses honestly otherwise.
2. Fetches that league's **real rosters** from the public Sleeper API
   (`lib/sleeper-client.ts`'s `getLeagueRosters`), and collects every real Sleeper roster-owner user
   id.
3. Builds a **real** manager identity mapping for each owner: looks up
   `UserProfile.sleeperUserId` (the real, persisted, unique reverse-lookup already used elsewhere in
   this codebase, e.g. `app/league/[leagueId]/page.tsx`) to find a linked AllFantasy account if one
   exists; falls back to an honest `stable_key`-only, external-only mapping when none does — never
   fabricating an AF account.
4. Fetches that league's **real transactions** (Sleeper's endpoint is per-week — loops over
   `--weeks` weeks, default 18, a fixed honest NFL-season upper bound) and **real draft picks** (via
   the league's real drafts list), using the draft's own real `start_time` when present, or an
   honest `null` (never invented) when it isn't.
5. Calls `ingestSleeperImportedActivity` with all of the above — the SAME emitter/normalizer/writer
   code Phase A already built and tested on fixtures, now fed real Sleeper API data for the first
   time.
6. Prints a full writer summary (created/updated/skipped counts, skip reasons, external-only-manager
   count, per-activity-type counts) — honest, never claims success it can't show.
7. **(Increment 8)** If rosters resolved but BOTH transactions and draft picks came back completely
   empty, prints an explicit `WARNING` and a direct Sleeper API URL to manually check. Necessary
   because `lib/sleeper-client.ts`'s fetchers catch every error and silently return `[]` — without
   this warning, a genuinely quiet league and a silently-failed fetch (wrong league id, network
   hiccup, Sleeper API downtime) would look identical in the script's own log output.

**New file: `scripts/decision-os-ingest-sleeper-activity-helpers.ts`** — the pure, unit-tested seam
behind the script: real-Sleeper-API-shape reconciliation (`SleeperTransaction` →
`SleeperTransactionRaw`; a raw draft-pick response item → `SleeperDraftPickRaw`, returning `null`
rather than fabricating a pick when required fields are missing), the week-range builder, real
draft-timestamp extraction, the identity-mapping builder (with an injectable AF-account lookup so
it's testable without a database), and the silent-fetch-failure warning check (Increment 8). 19
tests in `__tests__/decision-os/ingest-sleeper-activity-helpers.test.ts`.

**Honesty caveat:** this script has not been run against a live Sleeper league in this sandbox (no
live network access here) — the logic is real and reuses only already-tested pieces, but running it
for real against a real non-prod database and a real Sleeper league is the concrete next step, not
something this increment could execute itself.

---

## 3c. Step 1.75 — Capture a real behavioral snapshot (Increment 14, optional but recommended before a demo)

```
curl "<your-app-base-url>/api/cron/decision-os-snapshot-capture?leagueId=<leagueId from step 1>&secret=<CRON_SECRET>"
```

(Non-production only, per that route's own `authorizeCron` — in production this same call requires an
`Authorization: Bearer $CRON_SECRET` header instead of `?secret=`. Either way, `CRON_SECRET` must
already be set in whatever environment's `.env` you're hitting.)

This calls the existing, already-tested `GET /api/cron/decision-os-snapshot-capture` route
(`app/api/cron/decision-os-snapshot-capture/route.ts`, Commissioner OS Surface Alignment Phase B
Increment 4) — real, authorized, callable on demand, but **not registered in `vercel.json`**, so it
never runs automatically. Without at least one call to it, League Health/Mission Control/League
Analytics/User OS/Platform OS will all honestly report `no_snapshots` for their trend panels — a
correct but visually flat state for a first-time run.

**Optional, not required for correctness** — every OS surface degrades honestly with zero snapshots.
**Recommended before presenting a demo**: call this once now (ideally right after §3b, so the
snapshot reflects real ingested activity, not a pre-ingestion zero baseline), then call it again later
with real elapsed time before actually presenting — trend direction (`increasing`/`decreasing`/
`stable`) needs 2+ captures with a real time gap between them, which is exactly the kind of signal a
customer demo benefits from showing. Re-calling this route for the same league is safe (each call is
an independent capture, not a destructive overwrite).

**This step was found missing from this checklist, not missing from the codebase** — the route itself
has existed and been tested since before this workstream began; Increment 14 is the first time this
checklist mentions it.

---

## 4. Step 2 — Run the OS Suite conformance script (new this increment)

```
DATABASE_URL=<same-nonprod-db> npx tsx scripts/decision-os-suite-conformance.ts \
  --leagueIds=<leagueId from step 1> \
  --managerId=<see the managerId value convention below>
```

**`--managerId` value convention (Increment 8 clarification):** §3b's identity mapping (§3b step 3)
assigns each real Sleeper manager EITHER a real AF `userId` (if `UserProfile.sleeperUserId` links
one) OR an honest `stable_key` of the exact shape `sleeper:<sleeperUserId>` (external-only, no AF
account). To check User OS for the importer account itself, pass their real AF `userId`. To check it
for an external-only manager (no AF account, the core "prove it works without one" case), pass the
`sleeper:<sleeperUserId>` string, not the bare Sleeper id and not an AF id that doesn't exist.

**New file: `scripts/decision-os-suite-conformance.ts`** — READ-ONLY, mirrors the exact safety
contract of every existing `scripts/decision-os-*-nonprod.ts` script (skips cleanly without
`DATABASE_URL`, hard-refuses the production host). Unlike the sibling
`decision-os-world-conformance.ts`, it has **no auto-discovery fallback** — `--leagueIds` is
required and explicit, by design, matching this increment's own instruction.

For each supplied league, it calls the real, production compositions directly:
- `resolveMissionControlSnapshot` (Commissioner OS)
- `resolveLeagueAnalyticsSnapshot` (Commissioner OS, sibling surface)
- `resolveUserOsSnapshot` (User OS — only if `--managerId` is supplied, checked against the first
  supplied league)
- `resolvePlatformOsSnapshot` (Platform OS — aggregates across ALL supplied leagues in one call)

...and reports a pass/fail line per check plus a real detail string (e.g.
`status=healthy activeManagers=8 trades=0 waivers=0`), using the same `✅`/`❌` reporter convention as
`decision-os-world-conformance.ts`.

**Read `✅`/`❌` precisely — they mean "resolved" vs "failed to resolve," not "has activity" vs
"empty" (a real distinction, clarified in Increment 8):** every check's PASS/FAIL is driven by
whether the underlying composition resolved at all (`leagueHealth.available` / `available` on the
snapshot), not by whether its counts are non-zero. A league with genuinely zero activity (§3b not
yet run, or a real but quiet league) still shows **`✅` with honest zero counts in the detail
string** (e.g. `activeManagers=0 trades=0`) — that is a passing check. A **`❌`** means the
composition itself could not resolve (e.g. the league id is wrong, the Prisma delegate isn't
generated, or a genuine exception) — a real problem worth investigating, unrelated to whether §3b
has been run. See §11 for concrete troubleshooting steps if you see a `❌`.

**New file: `scripts/decision-os-suite-conformance-helpers.ts`** — the pure, unit-tested seam behind
the script (host/production-refusal checks, explicit-only CLI arg parsing, the check-line
formatter), extracted specifically so this increment has a real seam to add tests against per its
own instruction. 12 tests in
`__tests__/decision-os/suite-conformance-helpers.test.ts` — all passing, no DB required.

---

## 5. The gap that WAS open, now closed at the code level (Increment 7)

~~Previously: to see real, non-zero trade/waiver/roster-activity signals, a league additionally
needed real rows in `DecisionOsImportedActivity`, and no orchestrating step connected the real
Sleeper fetchers to the already-built ingestion pipeline for an already-imported league.~~

**Increment 7 built that orchestrating step** — §3b, `scripts/decision-os-ingest-sleeper-activity-nonprod.ts`.
It pulls a real, already-imported league's real Sleeper transactions/rosters/draft picks and runs
them through the exact same emitter/normalizer/writer pipeline Phase A already built and tested on
fixtures, with a real (not fabricated) manager identity mapping built from the persisted
`UserProfile.sleeperUserId` reverse-lookup.

**What remains, honestly:** this script has not been executed against a live Sleeper league in this
sandbox (no live network access here). Running §3 → §3b → §4 in sequence, against a real non-prod
database and a real Sleeper league, is the concrete way to fully close this out — see §10.

---

## 6. Step 3 — Browser verification for Commissioner OS

1. Sign in as the importer account (`decision-os-nonprod-importer@allfantasy.local`, or whichever
   real account you used in §3) against the same non-prod environment.
2. Visit `/commissioner-hub`.
3. Confirm the **Mission Control** card renders for the imported league (league health status,
   activity trend, manager/activity counts, retention-risk section, recommended actions) — real
   counts if §3b was run for this league; honest zero/empty states otherwise.
4. Confirm the **League Analytics** card renders directly below it, showing the same underlying
   counts reshaped for the "what's happening over time" framing.

## 7. Step 4 — Browser verification for User OS

1. While signed in as any account with a real claimed team/roster in the imported league (the
   importer account itself, or a second account that has claimed a different roster in the same
   league — see
   [`USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md`](USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md) §14 for
   the confirmed access-control path), visit `/league/<leagueId>`.
2. Confirm the **Your Team** card (User OS) renders next to the existing Manager DNA/Recommendations
   cards, showing team health, an activity summary, and league trend — real if §3b was run for this
   league; an honest zero baseline otherwise.
3. **This is the concrete way to prove the manager-only role** — repeat with a second account that
   is a plain member (not commissioner) of the same league, confirming the same card renders
   identically for them.

## 8. Step 5 — Platform OS (Increment 14: real admin route + UI now exist)

**Updated in Increment 14 — this section was stale.** It previously said Platform OS had no route or
UI; that has not been true since Increments 11/12: Platform OS now has an authorized route
(`GET /api/decision-os/platform-os`) and a real admin panel (`/admin` → "Platform OS" section). The
§4 script run below still works and is still useful for a scriptable/CI-style check, but a demo
should use the real browser panel, not just the script.

**Prerequisite specific to this step**: whoever presents this part of the demo must have their
account email listed in that environment's `ADMIN_EMAILS` env var (or match one of the hardcoded
test accounts in `lib/auth/admin.ts`) — Platform OS's route and `/admin` itself are both gated by the
same internal site-admin check (`requireAdmin`/`isSiteAdmin`, see
[`PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md`](PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md) §17), and there
is no separate demo-mode bypass, by design. This is an environment-configuration step, not something
any script here can do for you.

**Script check (works today, no browser needed):**

```
DATABASE_URL=<same-nonprod-db> npx tsx scripts/decision-os-suite-conformance.ts \
  --leagueIds=<leagueId from step 1> \
  --managerId=<see the managerId value convention above>
```

Confirm `Platform OS aggregates N explicit league(s)` reports the correct `totalMonitoredLeagues`
matching however many `--leagueIds` were supplied, and that `healthy`/`atRisk`/`unavailable` sum
correctly.

**Browser check (Increment 12, the real demo step):**

1. Sign in as the site-admin-authorized presenter account (see the prerequisite above), against the
   same non-prod environment.
2. Visit `/admin`, open the collapsed **"Platform OS"** panel.
3. Paste the same explicit league id(s) used above (comma-separated if more than one) into the
   textarea and click **Fetch**.
4. Confirm the panel renders: monitored/healthy/at-risk/unavailable league counts, active/inactive
   manager counts, trade/waiver/draft/roster activity totals, the intervention queue (or its honest
   empty state), trend coverage, provenance, and any warnings — every field `resolvePlatformOsSnapshot`
   returns, nothing hidden.
5. For a richer demo, repeat step 3 with a **second** real imported league's id alongside the first —
   Platform OS's healthy/at-risk split and intervention queue are far more visually compelling with
   2+ leagues than with a single one.

---

## 9. Troubleshooting (Increment 8)

Concrete, real failure modes an operator running this end-to-end is likely to actually hit:

- **§3b refuses with "not a Sleeper-imported league".** The `--afLeagueId` you passed either
  doesn't exist or has `platform` set to something other than `'sleeper'` — double-check you copied
  `IMPORTED_LEAGUE_ID` from §3's own output, not the `--league` (Sleeper source id) you passed
  *into* §3.
- **§3b refuses with "the decisionOsImportedActivity Prisma delegate is not generated".** Run
  `prisma generate` against a schema that includes the `DecisionOsImportedActivity` model in this
  environment first (see `DECISION_OS_PHASE_A_IMPLEMENTATION.md` for why this is a real, known
  environment-setup step, not a script bug).
- **§3b prints the `WARNING: ... zero transactions AND zero draft picks` line.** Manually hit the
  Sleeper API URL the warning prints in a browser. If it returns real data, something in the
  script's fetch path is wrong (open an issue); if it returns an empty array, the league genuinely
  has no activity yet — a normal outcome for a very new league, not a bug.
- **§4 (`decision-os-suite-conformance.ts`) shows a real `❌`, not just zero counts.** Per §4's own
  clarification, `❌` means the composition itself failed to resolve — not that activity is
  low/absent (that's an honest `✅` with zero counts). Check: is the league id correct? Is
  `DATABASE_URL` pointed at the same non-prod database §3/§3b used? Did §3 actually succeed (check
  its own exit code/output)?
- **User OS check in §4 shows `user_os_unavailable`.** Confirm the `--managerId` you passed actually
  has a resolvable identity for this league — either a real AF `userId` that owns a roster, or the
  exact `sleeper:<sleeperUserId>` stable-key form for an external-only manager (see §4's
  `--managerId` value convention). A raw, un-prefixed Sleeper user id will not resolve.
- **The browser shows a real session but no cards render on `/commissioner-hub` or
  `/league/<leagueId>`.** Confirm you're signed in as an account that actually has access to this
  specific league (§6/§7) — `isOwner` or a real claimed `LeagueTeam`/`Roster` row, per
  `USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md` §14. Being signed in generally is not sufficient.

---

## 10. Summary checklist

- [ ] Ran `decision-os-import-sleeper-nonprod.ts` against a non-prod DB, got a real
      `IMPORTED_LEAGUE_ID`.
- [ ] Ran `decision-os-ingest-sleeper-activity-nonprod.ts` against that same league id, reviewed the
      writer summary (created/updated/skipped counts, external-only-manager count).
- [ ] (Optional, recommended before a demo — Increment 14) Called
      `/api/cron/decision-os-snapshot-capture?leagueId=...` at least once; called it again later with
      real elapsed time if a real trend line should show in the demo.
- [ ] Ran `decision-os-suite-conformance.ts` against that league id (+ a manager id), reviewed the
      pass/fail + detail lines — non-zero activity expected now that §3b has run.
- [ ] Verified Mission Control + League Analytics render in the browser at `/commissioner-hub`,
      showing real counts.
- [ ] Verified the User OS card renders in the browser at `/league/<leagueId>`, for both a
      commissioner-role account and a plain-member account, if a second claimed account is
      available.
- [ ] Confirmed the presenter's account has `ADMIN_EMAILS` access in this environment, then verified
      the Platform OS panel renders at `/admin` with the real league counts (Increment 14).
- [ ] Did NOT run any of this against the production database host.
- [ ] Did NOT fabricate any activity, league, or manager data at any step.

---

## 11. Boundaries honored (this increment)

- No production DB touched — every script hard-refuses the production host.
- No auto-discovery of leagues — `decision-os-suite-conformance.ts` and
  `decision-os-ingest-sleeper-activity-nonprod.ts` both require explicit, single/multi leagueId(s).
- No fake/demo data anywhere — every value is either a real Sleeper API response, a real persisted
  AF row, or an honest zero/empty/skipped result; nothing fabricated, including manager identity
  (an AF account is only linked when a real `UserProfile.sleeperUserId` match exists).
- The DecisionOsImportedActivity ingestion gap is now closed at the code level (§3b/§5) — not yet
  executed against a live Sleeper league in this sandbox (no live network access here); that
  execution is the concrete remaining step, not a design gap.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- No DFS OS work. No `the_replacements` provider work.
- No shadow-gated Phase 5.3/5.4/5.5 pipeline crossed — this procedure only exercises the
  already-cut-over Mission Control/League Analytics/User OS/Platform OS compositions and Phase A's
  already-built ingestion pipeline.
- PR #183 untouched, still draft, not merged.
- No measured retention/engagement/ROI outcome claimed anywhere in this document — Increment 8 is
  runbook hardening (clarity, safety checks, troubleshooting), not a measurement of any outcome.
- **(Increment 14)** No new authorization surface introduced — §8's admin panel/route reuse the
  existing site-admin gate (`requireAdmin`/`isSiteAdmin`, Increment 11), unchanged. No new code was
  written this increment — documentation corrections only, reflecting Platform OS's real route/UI
  (Increments 11/12) and the pre-existing snapshot-capture route that this checklist had simply never
  mentioned before.
