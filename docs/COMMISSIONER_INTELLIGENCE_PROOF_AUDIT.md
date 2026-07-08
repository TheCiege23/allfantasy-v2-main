# Commissioner Intelligence Hub — Proof Pass + Gap Audit (Phase 1)

**Purpose:** map the *existing* Commissioner Intelligence surface, classify each module for
demo-safety, and recommend the next phase. This is an **audit** — no new algorithms, no new
backend contracts, no live DB access.

**Date:** 2026-07-07 · **Branch:** `g15-event-foundation`

---

## Overview

`CommissionerIntelligenceHub` ([component](../components/commissioner-intelligence/CommissionerIntelligenceHub.tsx))
is a **G15.6 read-only surface** rendered at `/league/[leagueId]/intelligence`
([page](../app/league/[leagueId]/intelligence/page.tsx)). It consumes **only** the G15.5
Intelligence API + the Stories API — no DB/provider/raw access, no writes. Contract DTO types are
declared locally in the client so no server-only module is bundled.

Unlike the Manager hub, the Commissioner hub has **no client feature flag** — it is already
"on." It is instead gated by **auth** (session role) and by **data** (precomputed
`IntelligenceLeagueSnapshot` rows); when neither is present it degrades to restricted / empty
states.

---

## Module inventory + route/source map

| # | Module | Route consumed | Source (read-only) | Access | Classification |
| --- | --- | --- | --- | --- | --- |
| 1 | League Activity Summary | `GET /api/v1/intelligence/leagues/[id]/activity` | `IntelligenceLeagueSnapshot` counts | member | **display-safe** |
| 2 | League Health | `GET /api/v1/intelligence/leagues/[id]/health` | deterministic health snapshot (0–100 + status) | commissioner | **display-safe** |
| 3 | Commissioner Action Items | `GET /api/v1/intelligence/leagues/[id]/action-items` | `deriveActionItems()` (deterministic) | commissioner | **display-safe (observational alerts)** |
| 4 | League Stories | `GET /api/v1/stories/leagues/[id]/preview?type=…` | deterministic narrative builder (no LLM) | member + commissioner-only types | **display-safe (narrative, carries a safety note)** |
| 5 | League Activity Timeline (audit feed) | `GET /api/v1/intelligence/leagues/[id]/audit-feed` | event log, cursor-paginated | member | **display-safe** |

Auth is enforced server-side in `lib/intelligence/api/handlers.ts` (`requireMember` /
`requireCommissioner` → 401/403; feature-gate denial → 402). The hub's `useResource` reads
`body.data` and maps HTTP status → `loading | ok | unauthorized | forbidden | not_found | upgrade
| error`.

### Classification detail

- **Activity / Health / Audit Feed** — pure observational facts (counts, a deterministic health
  score, an event timeline). No advice.
- **Action Items** — the closest to "commissioner-action," but the messages are **observational
  alerts**, not prescriptions: `"N trade proposal(s) awaiting resolution."`, `"No league activity
  for N days."`, `"N manager(s) inactive for over 14 days."` The `severity: 'action'` label
  denotes urgency, not a prescribed move. **Note:** the API's `inactive_managers` item carries
  `meta.managerKeys` (identifiers), but the **UI renders only `message`** — the keys are not
  displayed (verified in code + tests). No recommendation of a specific move is made.
- **Stories** — auto-generated *narrative drafts* from recorded activity. The builder is
  deterministic (no LLM, no writes, no auto-post) and every card renders a **safety note**
  ("Observations, not accusations."). Commissioner-only story types (`commissioner_summary`,
  `health_narrative`) render a clean restricted state for non-commissioners.

**No module consumes an AI or recommendation endpoint.** (Asserted by the new
`proof-surface.test.tsx` route-allowlist test.)

---

## Proof-surface review

| Check | Result |
| --- | --- |
| Renders cleanly (data / empty / loading / error / restricted / upgrade) | ✅ every module owns all states |
| Avoids raw IDs | ✅ UI renders contract DTO fields only; `meta.managerKeys` never shown; audit uses `eventId` as a React key, not display |
| Avoids unsupported claims | ✅ observational counts / scores / event summaries only |
| Exposes recommendation internals | ✅ no — no recommendation engine is touched |
| Distinguishes observation vs action | ✅ action items are alerts (attention), not prescriptions; stories carry a safety note |
| Degrades honestly when data missing | ✅ empty states + commissioner-only + upgrade states, no fallback leakage |

Test coverage: existing [`hub.test.tsx`](../__tests__/commissioner-intelligence/hub.test.tsx)
(9 tests: data/empty/forbidden/upgrade/pagination/stories/no-PII) **+** new
[`proof-surface.test.tsx`](../__tests__/commissioner-intelligence/proof-surface.test.tsx)
(2 tests: no prescriptive/imperative advice language; calls only the documented read-only routes).

---

## Demo-safe vs ambiguous

**Demo-safe today (all five):** Activity, Health, Action Items, Stories, Audit Feed. The whole
surface is observational and read-only, and it already handles auth/empty/upgrade gracefully.

**Ambiguous / watch items (not blockers):**
- **Stories** are the only *generated* content. They are deterministic today, but any future move
  to an LLM narrative would need a fresh audit + the safety-note framing preserved.
- **Action Items** `meta.managerKeys` exists in the API payload (not shown in the UI). If a future
  module surfaces per-manager detail, keep identifiers out of the rendered text.

**Missing modules (candidates, do NOT exist yet):** Trade Review / Fairness, dedicated
Engagement / League Pulse, Rule / Settings Intelligence.

---

## Known blockers

1. **Live data = precomputed snapshots.** Activity/Health/Action Items read
   `IntelligenceLeagueSnapshot`; a demo needs those snapshots built for the target league.
   Same non-prod/DB reality as the Manager hub — see
   [Manager non-prod runbook](./MANAGER_INTELLIGENCE_NONPROD_VALIDATION_RUNBOOK.md). No live DB
   was accessed in this audit.
2. **No screenshotted live pass** — the hub is code-and-test-verified against realistic payloads;
   a real imported-league pass still needs an approved non-prod environment + authed commissioner.

---

## Recommended next phase (audit-corrected)

> **Finding that changes the suggested roadmap:** League **Health** and **Action Items**
> **already exist** as deterministic, display-safe contracts via the G15.5 Intelligence API.
> Building "Commissioner League Health / Action Items Display Contracts" from scratch (the pattern
> used for Manager Intelligence) would **duplicate** working surfaces. The Commissioner hub is
> further along than the Manager hub was at its Phase 1.

So the highest-value next steps are, in order:

1. **Phase 2 — Commissioner Hub demo-readiness + snapshot runbook** (mirror Manager P5 + P6):
   light polish (hero/consistency), a live-like all-modules render test, and a non-prod runbook
   that documents how to **build/seed `IntelligenceLeagueSnapshot`** for the demo league. No new
   contracts. This makes the *existing* surface demo-ready — the same wedge, faster.
2. **Phase 3 (new contract, only after a data audit)** — the first *genuinely missing* module.
   Best candidate: **Trade Review / Fairness** (deterministic, observational: open/pending trade
   counts, review windows, veto activity) or **Rule / Settings Intelligence** (deterministic:
   settings summary + drift/anomaly flags). Build with the proven pattern only if a clean,
   non-recommendation data source exists.

Do **not** re-implement Health or Action Items as new contracts.

---

## Non-prod validation needs

- An approved non-prod DB with a league that has **built `IntelligenceLeagueSnapshot` rows**
  (activity/health/action-items are empty without them).
- An authenticated **commissioner** session for the health / action-items / commissioner-only
  story cards (member session is enough for activity / audit / member stories).
- The Stories API populated (deterministic — should produce content once activity exists).

Status: **Ready to validate** the Commissioner hub under the same safe, approved-non-prod
process defined for Manager Intelligence — not yet validated against a live imported league.
