# Fantasy OS Suite — Customer Demo Readiness Audit

**Phase D Increment 13. Audit only — no new intelligence, no fake data, no code changes.** Answers one
question: is the Fantasy OS Suite ready to demo to a customer, and if not, what is the *minimum* set
of things standing in the way? Companion to
[`OS_PROGRESS_DASHBOARD.md`](OS_PROGRESS_DASHBOARD.md) (status-at-a-glance),
[`SLEEPER_PROOF_EXECUTION_PACKET.md`](SLEEPER_PROOF_EXECUTION_PACKET.md) (the fill-in-the-blanks
runbook), and [`SLEEPER_OS_SUITE_PROOF_CHECKLIST.md`](SLEEPER_OS_SUITE_PROOF_CHECKLIST.md) (the full
procedure).

**Date:** 2026-07-09 · **Branch:** `g15-event-foundation`. Latest state audited: Phase D Increment 12
(`a47dba565`) — Commissioner OS, User OS, and Platform OS all have real, tested, wired surfaces.
**Updated by Increment 14**: the two proof docs (§4 items 1/2) were corrected; §3b item 3's fix is
also now documented. §4 item 4 (live browser render of the admin panel) remains genuinely open.

---

## 1. Bottom line

**All three OS surfaces are code-complete, tested, and wired to real routes/pages.** Nothing found in
this audit requires new intelligence, new derivation logic, or new code. Every real gap found is
either (a) something that has simply never been *run* yet, or (b) an operational/environment step
that isn't written down anywhere. Zero gaps required building anything — this audit deliberately
built nothing, per its own instructions.

## 2. What was verified directly, this increment (not assumed from memory)

- `app/commissioner-hub/CommissionerHubPageClient.tsx` — confirmed live: fetches
  `/api/decision-os/mission-control` and `/api/decision-os/league-analytics` for
  `commissionerLeagues[0]?.id` (the signed-in user's own first commissioner league — session-scoped,
  not cross-user), renders `<MissionControlCard>`/`<LeagueAnalyticsCard>`.
- `app/league/[leagueId]/tabs/LeagueTab.tsx` — confirmed live: fetches
  `/api/decision-os/user-os?leagueId=...`, renders `<UserOsCard variant="league">`, unconditional on
  role (works for a commissioner or a plain member).
- `app/admin/page.tsx` — confirmed live: imports and renders `<PlatformOsOperatorPanel />` inside a
  collapsed `AccordionSection` (Increment 12).
- `app/api/cron/decision-os-snapshot-capture/route.ts` — read in full. **Real finding**: this route
  is authorized, tested, and callable on demand (`?leagueId=` or `?leagueIds=`, `Authorization: Bearer
  $CRON_SECRET` or `?secret=` in non-production) — but is referenced **nowhere** in either
  `SLEEPER_PROOF_EXECUTION_PACKET.md` or `SLEEPER_OS_SUITE_PROOF_CHECKLIST.md`. Without at least one
  call to it, every trend panel (Mission Control, League Analytics, User OS, Platform OS's trend
  coverage) will honestly report `no_snapshots` for a freshly-seeded demo league — see §4.
- `lib/adminAuth.ts` — re-confirmed `isSiteAdmin`/`ADMIN_EMAILS` is the ONLY gate on `/admin` and the
  Platform OS route (Increment 11) — there is no separate "demo mode" bypass, by design.

## 3. Demo blockers

Split into two kinds: things that need *engineering* (none found) and things that need *operational
action before the demo* (real, but zero new code).

### 3a. Engineering blockers
**None.** Every surface's logic is real, tested, and already wired. This is the headline finding.

### 3b. Operational blockers (must be done before a demo, but are execution/config steps, not code)

| # | Blocker | Why it blocks a demo | What resolves it |
| --- | --- | --- | --- |
| 1 | **The Sleeper proof chain has never been run live.** Every script in `SLEEPER_PROOF_EXECUTION_PACKET.md` is real and unit-tested, but has literally never executed against a real Sleeper account or a real database, in any environment. | You cannot demo what has never been observed to work end-to-end against real infrastructure — even though the logic is sound, a first live run could surface an environment-specific surprise (a malformed real API response, a real DB constraint, etc.) that no fixture-based test could catch. | Run the packet once, for real, well before the demo — not during it. |
| 2 | **No customer-reachable environment is established yet.** The whole harness assumes a non-prod `DATABASE_URL` reached via CLI scripts; nothing here stands up a browser-reachable app pointed at that same DB. | A customer needs to see real pages render in a real browser, not a terminal. | Either run `npm run dev` locally against the same non-prod `DATABASE_URL` used for the import/ingest scripts and screen-share, or point a Vercel preview deployment's env at that same DB. Either is zero-engineering — a deployment/logistics choice, not a code gap. |
| 3 | **The demo presenter's account must be a site admin to show the Platform OS panel.** `/admin` and `GET /api/decision-os/platform-os` are both gated by `requireAdmin`/`isSiteAdmin` (Increment 11) — there's no separate demo-mode bypass, by design (see `PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md` §17). | Without this, the Platform OS portion of the demo 403s. | Add the presenter's real account email to that environment's `ADMIN_EMAILS` env var before the demo (or use the hardcoded test account already in `lib/auth/admin.ts` if reachable in that environment). **Documented as of Increment 14** — `SLEEPER_PROOF_EXECUTION_PACKET.md`'s "Before you start" + placeholder table now name this explicitly. |

## 4. Non-blocking polish (recommended, not required)

| # | Item | Why it matters | Effort | Status |
| --- | --- | --- | --- | --- |
| 1 | **Seed at least one, ideally two, real snapshots before the demo** via `GET /api/cron/decision-os-snapshot-capture?leagueId=<AF_LEAGUE_ID>&secret=$CRON_SECRET` (non-production only). Without this, every trend panel honestly shows "no snapshots yet" — accurate, but the least visually interesting state Mission Control/League Analytics/User OS/Platform OS can be in. | Trend movement (`increasing`/`decreasing`/`stable`) is one of the more compelling signals in the whole suite; showing it requires 2+ captures with real elapsed time between them. | One extra `curl`/browser call per capture, zero code. | **Documented as of Increment 14** — new §3c/Step 4 in the checklist/packet. |
| 2 | **`SLEEPER_OS_SUITE_PROOF_CHECKLIST.md` §8 was stale.** It read "Platform OS has no route or UI" — not true since Increments 11/12 (a real authorized route + a real admin panel exist). | Would have read as inaccurate/confusing if shown alongside a working demo. | One-paragraph doc correction. | **Fixed in Increment 14** — §8 rewritten with the real route/UI + a browser verification step. |
| 3 | **Import a second real Sleeper league before the demo**, ideally one with different health characteristics than the first. | Platform OS's actual value (a healthy/at-risk split, an intervention queue) is far more visible with 2+ leagues of different health than with a single league (which trivially aggregates to "1 of 1"). | Re-run the import script once more with a second `--league=`. Fully supported today — the import/conformance/Platform-OS-panel scripts already accept multiple explicit league ids. | **Recommended step documented as of Increment 14** — checklist §8 and packet Step 6.4 both suggest a second league; running it is still an operational step. |
| 4 | **The Platform OS admin panel has never been rendered in a live browser**, only in isolated component tests (`@testing-library/react`/JSDOM). Unit tests can't catch integration-level surprises (hydration warnings, a CSS regression, an unexpected redirect). | Reduces (does not eliminate) confidence that the panel looks right the first time a real admin loads `/admin`. | A single smoke-test page load in whatever environment hosts the demo, before presenting. | Still open — no browser-reachable environment was available to verify this in Increment 12 or 13; unchanged this increment. |

## 5. Future / explicitly non-blocking items

These are real, tracked, and unrelated to whether a demo of the *current* feature set can happen:

- Whether the richer, shadow-gated Phase 5.3/5.4 intelligence is ever cut over internally — decided
  **no** (`PLATFORM_INTELLIGENCE_CUTOVER_ADR.md`, Increment 9). The current demo doesn't need it.
- Whether the external hosted Intelligence API (`/api/v1/intelligence/*`) is ever enabled in
  production — a separate business/ops decision, unrelated to an internal customer demo of
  Commissioner/User/Platform OS.
- Sleeper ingestion is not wired into the live production backfill/sync call site — expected and
  fine, since the demo path is explicitly non-production by design.
- Snapshot-capture cron is not registered in `vercel.json` for automatic scheduling — fine for a
  one-off demo (manual capture per §4 item 1 is sufficient); only matters for a persistent, always-
  fresh demo environment.
- DFS OS does not exist — explicitly out of scope, pending legal/compliance review.

## 6. Exact demo route/script sequence

Combines the existing `SLEEPER_PROOF_EXECUTION_PACKET.md` steps with the two real gaps found in §3b/
§4 (site-admin setup, snapshot capture) that the packet itself doesn't currently mention.

```
0. [Environment] Add the presenter's account email to ADMIN_EMAILS in the demo environment.
   [Environment] Confirm a browser-reachable app (local `npm run dev` or a Vercel preview) is pointed
                 at the SAME non-prod DATABASE_URL the scripts below will use.

1. [Script]  decision-os-import-sleeper-nonprod.ts        → get AF_LEAGUE_ID
   (optional, for a richer Platform OS view) repeat once more for a second real league.

2. [Script]  decision-os-ingest-sleeper-activity-nonprod.ts --dryRun   → verify before writing
3. [Script]  decision-os-ingest-sleeper-activity-nonprod.ts            → real activity written

4. [Script]  GET /api/cron/decision-os-snapshot-capture?leagueId=<AF_LEAGUE_ID>&secret=$CRON_SECRET
             → capture snapshot #1 now
   (later, with real elapsed time before the demo) → capture snapshot #2, so trend shows real
             movement instead of "no snapshots yet"

5. [Script]  decision-os-suite-conformance.ts              → confirm every check is ✅

6. [Browser] Sign in as <COMMISSIONER_ACCOUNT> → /commissioner-hub
             → show Mission Control + League Analytics cards (real counts + trend if step 4 ran twice)

7. [Browser] Same account → /league/<AF_LEAGUE_ID>
             → show the User OS ("Your Team") card

8. [Browser] Sign in as <MEMBER_ACCOUNT> (plain member, not commissioner) → /league/<AF_LEAGUE_ID>
             → show the same User OS card rendering identically for a non-commissioner role

9. [Browser] Sign in as the site-admin-authorized presenter account → /admin → open "Platform OS"
             → paste the AF_LEAGUE_ID(s) → Fetch → show the aggregate snapshot (counts, intervention
             queue, trend coverage, provenance)
```

## 7. Boundaries honored (this increment)

- No new intelligence, derivation, or composition logic built.
- No fake/demo data introduced — every recommendation above operates on real Sleeper API data and
  real, already-built pipelines; nothing is fabricated.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- No code changes at all this increment — audit + doc updates only.
- No production DB touched; every referenced script still hard-refuses the production host.
- PR #183 untouched, still draft, not merged.
- No DFS OS work.
- No retention-lift, ROI, or engagement-improvement claims anywhere in this document.
