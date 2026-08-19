# The Replacements — Demo Readiness Checklist & Runbook

**Purpose:** the final, practical "are we actually ready" document before the first Commissioner OS
demo/discovery call with The Replacements. It consolidates the demo package, the provider adapter
plan, the technical discovery handoff, the call script, and the current state of the built surfaces
into one checklist — not a new document to read on the call, but the one to review beforehand.

**Companion documents:**
[`THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`](THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md),
[`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`](THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md),
[`THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`](THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md),
[`THE_REPLACEMENTS_CALL_SCRIPT.md`](THE_REPLACEMENTS_CALL_SCRIPT.md),
[`COMMISSIONER_OS_SURFACE_ALIGNMENT.md`](COMMISSIONER_OS_SURFACE_ALIGNMENT.md).

**Phase D reframing note (2026-07-08):** this checklist is **first-client collateral for one
prospective conversation, not the top-level product roadmap.** The product itself is a
client-agnostic Fantasy OS Suite — see
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md). Use
this checklist as-is if and when a Replacements call happens; treat it as the template a future
client's equivalent checklist would follow, not as the definition of what's being built.

---

## 1. Executive Summary

Commissioner OS has two real, tested, visible surfaces today — **Mission Control** and **League
Analytics** — both live on the Commissioner Hub dashboard, both powered by the same real Decision OS
behavioral pipeline, both honestly degrading when data isn't available. That is enough to run a real
demo and a real technical discovery conversation with The Replacements today.

What does **not** exist yet: any actual connection to The Replacements' data, a provider adapter for
them, or any measured outcome. This checklist exists to keep the demo honest about that line — show
what's real, say plainly what isn't, and leave the call with a concrete next step, not an
overpromise.

---

## 2. Current Demo-Ready Surfaces

| Surface | Status |
| --- | --- |
| **Commissioner Hub dashboard** | Real, live page. The same one AllFantasy commissioners already use. |
| **Mission Control card** | Real, tested, visible. Shows league health status, activity trend, active/inactive manager counts, trade/waiver/draft/roster activity, named managers at retention risk with real reasons, and recommended commissioner actions. |
| **League Analytics card** | Real, tested, visible, directly below Mission Control. Shows activity trend, manager counts, activity counts, and a bare retention-risk count — the "what's happening over time" view, deliberately lighter than Mission Control's "what to do now" view. |
| **Decision OS-federated League Health** | Real, tested. The scoring engine behind Mission Control's health status is fed real trade/waiver/manager/trend counts, not hand-typed metrics. |
| **Activity trend states** | Real. Shows a genuine increasing/decreasing/flat signal once 2+ days of snapshot history exist for a league; honestly shows `no_snapshots`/`insufficient_history` otherwise. |
| **Retention-risk signals** | Real, derived from actual behavioral inactivity patterns — named + reasoned in Mission Control, counted in League Analytics. |

Everything in this table is real and tested on AllFantasy's own (native or imported) league data
today. None of it requires any code written specifically for this demo — it's the same code real
users' data runs through.

---

## 3. What To Show In The Demo

- The Commissioner Hub dashboard itself, as a real, already-in-use page.
- The Mission Control card: health status, trend, manager counts, activity counts, named
  retention-risk managers with reasons, recommended actions.
- The League Analytics card directly below it: the same underlying data, reshaped as a
  "what's happening over time" view.
- At least one honest "not enough data yet" state (`no_snapshots` or `insufficient_history`) if the
  demo league doesn't have 2+ days of snapshot history — this is a **feature to point out**, not a
  bug to hide (see the call script §6 for exact language).
- The three-step explanation of how integration works (they send activity → Decision OS scores it →
  Commissioner OS shows it) if a technical question comes up.

## 4. What To Avoid Showing

- Anything implying a finished integration with The Replacements exists — none does.
- Any specific retention/engagement percentage or dollar figure — none has been measured.
- The Commissioner Intelligence Hub (`/league/[id]/intelligence`, the separate 7-module system) as
  if it were connected to Decision OS — it is not, and is out of scope for this conversation
  entirely.
- Any DFS, User OS, or full League Analytics (season history/cross-league comparison) capability —
  none exists.

---

## 5. Pre-Demo Technical Checklist

- [ ] Confirm the demo environment has at least one league with real, non-trivial trade/waiver/
      roster/draft activity — Mission Control and League Analytics are far more compelling with a
      populated league than an empty one.
- [ ] Confirm whether that league has 2+ days of captured snapshot history. If not, decide in
      advance whether to (a) show the honest `no_snapshots`/`insufficient_history` state as a
      talking point, or (b) manually invoke the snapshot-capture route
      (`/api/cron/decision-os-snapshot-capture`) for that league on 2+ different calendar days
      beforehand so a real trend is visible. Either is legitimate — just decide which on purpose,
      don't discover it live.
- [ ] Load the Commissioner Hub page once beforehand and visually confirm Mission Control and
      League Analytics both render correctly for the chosen demo league (not a blank/loading state
      at call time).
- [ ] Confirm no unrelated errors are visible in the browser console on that page.
- [ ] Have the technical discovery handoff (`THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`)
      ready to send as a leave-behind immediately after the call.

## 6. Pre-Demo Talking-Points Checklist

- [ ] Reviewed the opening positioning line and 60-second pitch (`THE_REPLACEMENTS_CALL_SCRIPT.md`
      §1–§2).
- [ ] Reviewed the "Avoid Saying" list (`THE_REPLACEMENTS_CALL_SCRIPT.md` §10) — guaranteed
      retention lift, DFS, User OS, full League Analytics, a finished adapter, private user data.
- [ ] Reviewed the honest language for an "insufficient history" trend state (§6 of this document,
      and the call script §6) so it lands as a credibility point, not an awkward gap.
- [ ] Reviewed the three-step integration explanation (call script §11) in case of a live technical
      question.
- [ ] Decided who on the call owns the closing ask (call script §16) — a concrete next step, not a
      vague "let's stay in touch."

---

## 7. Required Demo Data / Environment

- A real (not fabricated) AllFantasy league — native or previously imported — with genuine trade,
  waiver, roster, and/or draft activity. **Never fabricate demo data** to make the surfaces look
  more populated than they are.
- Optionally, 2+ days of captured behavioral snapshots for that league (see §5) if a real trend
  line is wanted for the demo.
- A signed-in commissioner session for that league, since both cards require an authenticated
  session (`GET /api/decision-os/mission-control` and `GET /api/decision-os/league-analytics` both
  401 without one).
- Nothing else — no special demo mode, no seeded fixtures, no separate demo environment is required
  or has been built.

---

## 8. Honest Unavailable States To Expect

Be ready to explain any of these as a **feature**, not a failure, if they appear during the demo:

- **`no_snapshots`** — no behavioral snapshots have been captured yet for this league. Expected for
  any league that hasn't had the snapshot-capture route invoked at least once.
- **`insufficient_history`** — exactly one snapshot exists; a trend needs at least two to compare.
- **`league_health_unavailable`** — the underlying League Health composition couldn't resolve
  (should be rare for a real, populated league; more likely for a league with a data issue).
- **"No managers currently flagged"** — a genuinely healthy league has no retention-risk managers.
  This is a correct, honest answer, not a broken feature.
- **"No recommended actions right now"** — a healthy, quiet league has nothing urgent to flag.
- **All-zero activity counts** — a league with genuinely no trade/waiver/draft/roster activity in
  the lookback window shows real zeros, not an error.

---

## 9. Questions To Ask During The Call

The same core list as the technical discovery handoff and call script, kept here for a fast
pre-call refresh:

1. Do they have a documented API, or would this start as a data export?
2. What authentication do they support for third-party read access?
3. Are their league/team/manager/event IDs permanent, or can they change or be reused?
4. Do their transactions carry real timestamps, and do they distinguish pending vs. completed?
5. How much historical activity could they provide at onboarding?
6. What volume should be expected (leagues, managers per league, weekly transaction count)?
7. Which specific leagues would they want in a pilot, and for how long?
8. Who on their side owns data-sharing/privacy sign-off?

---

## 10. Decisions Needed After The Call

- Whether The Replacements wants to move toward a real technical integration (in which case:
  proceed to adding the `the_replacements` provider stub — see §12/Increment 6 recommendation) or
  needs more time/internal discussion first (in which case: leave them the technical discovery
  handoff and pause).
- Which specific leagues (if any) they're willing to provide sample/sandbox data for.
- Who the ongoing technical point of contact is on both sides.
- Whether a follow-up technical call is needed before any adapter work starts, and who schedules it.

---

## 11. Engineering Gaps Before A Live Pilot

Unchanged from the provider adapter plan (`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md` §11/§24) —
restated here for a fast pre-call refresh:

1. No `the_replacements` provider adapter exists — `ImportProvider` still only supports `sleeper`,
   `espn`, `yahoo`, `fantrax`, `mfl`, `fleaflicker`.
2. No real API/data access to The Replacements exists in this environment — everything proven so
   far uses realistically-shaped fixture data (true for Sleeper too, historically).
3. The snapshot-capture job is not scheduled anywhere — it exists and is tested, but nothing invokes
   it automatically yet.
4. Sleeper's own ingestion entry point is not wired into the production backfill call site yet — a
   preview of what a future Replacements adapter would also need.
5. AF-league/manager identity mapping enrichment is incomplete.
6. No multi-tenant boundary design exists — fine for a single pilot partner, blocks a second.
7. Mission Control and League Analytics both have no dedicated page — they're cards on the
   Commissioner Hub dashboard only.
8. Nothing has been validated against real, production-scale data volume — all real-data proofs to
   date used a throwaway, non-production database with realistic synthetic fixtures.

None of these block the demo itself — they block a **live pilot**, which is a later step (see the
provider adapter plan's own pilot plan, §9).

---

## 12. Go / No-Go Checklist

**Go** if all of the following are true:
- [ ] A real (non-fabricated) demo league with genuine activity is available and loads correctly.
- [ ] Mission Control and League Analytics both render without errors for that league.
- [ ] The presenter has reviewed the call script's opening, pitch, and "Avoid Saying" sections.
- [ ] The presenter is prepared to say plainly that no retention/ROI numbers exist yet, if asked.
- [ ] The technical discovery handoff is ready to send as a leave-behind.
- [ ] A concrete closing ask (sample data / sandbox access / scheduled technical follow-up) is
      agreed internally before the call starts.

**No-Go** — delay the call — if any of the following are true:
- [ ] No real, populated demo league is available (and fabricating one is not an acceptable
      substitute — see §7).
- [ ] Mission Control or League Analytics is erroring or blank for the intended demo league and
      there's no time to fix it beforehand.
- [ ] Nobody on the call is prepared to answer basic technical questions from §9, or to say "we
      don't have that yet" honestly when true.
- [ ] There is pressure to promise a specific retention/ROI number to close the deal — do not do
      this; delay and realign internally instead.

---

## 13. Demo Script Order

The concrete order to walk through, matching the call script's own walkthrough section:

1. **Open Commissioner Hub** — establish this is a real, already-live page.
2. **Show Mission Control** — health status, trend, manager/activity counts, named retention-risk
   managers, recommended actions.
3. **Show League Analytics** — the same underlying data, reshaped for "what's happening over time."
4. **Explain League Health** — the scoring engine behind Mission Control's status, now fed real
   data instead of hand-typed metrics.
5. **Explain Decision OS in the background** — the pipeline that turns raw activity into these
   signals, provider-agnostic by design.
6. **Explain the integration data needed** — stable IDs, timestamps, activity events; nothing more.
7. **Ask for pilot sample data** — the concrete closing ask: a small non-production export or
   sandbox access for 2–3 leagues, plus a scheduled technical follow-up.

---

## 14. Boundaries honored (this increment)

- No adapter code written. `IMPORT_PROVIDERS` not modified.
- No further League Analytics work beyond the existing minimal surface.
- No DFS OS, User OS work.
- No fake/demo data introduced anywhere in this document or the codebase.
- No production DB touched; no production cron enabled.
- PR #183 untouched, still draft, not merged.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- No retention-lift or ROI numbers claimed anywhere in this document.
