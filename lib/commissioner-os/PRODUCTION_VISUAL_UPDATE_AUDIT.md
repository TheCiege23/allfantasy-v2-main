# Production Visual Update Audit

**Read-only investigation. No flags changed, no code changed, no
deployment triggered by this report.**

Audits why enabling `commissioner_os_live_ready_analytics` and
`commissioner_os_live_ready_mission-control` did not produce any visible
change on `https://www.allfantasy.ai/commissioner-os` or
`/commissioner-os/analytics`, despite both flags being confirmed `true`
in the production `platform_config` table.

---

## Visual Changes Expected

Per the staged rollout already executed (`STAGED_ROLLOUT_NOTE_01_ANALYTICS.md`,
`STAGED_ROLLOUT_NOTE_02_MISSION_CONTROL.md`), enabling these two flags was
expected to let Analytics and Mission Control's own `live.ts`
implementations attempt real Decision OS calls instead of short-circuiting
— i.e., the visible change expected was **demo-labeled placeholder numbers
being replaced by real, computed intelligence** (or, failing that, a
distinct "live but currently unavailable" state), not a design/layout
change. This audit does not find a separate, un-merged visual redesign
anywhere in the repo (see §1 below) — the "visual update" in question is
specifically the demo→live data transition, which both rollout notes
already flagged as suspicious and is now confirmed and fully explained
here.

---

## Current Production Behavior

Re-confirmed this pass: `/commissioner-os` and `/commissioner-os/analytics`
render byte-for-byte the same demo content as before either flag was
enabled — same KPI numbers (91 engagement score, 187 transactions), same
named examples (Sam Rivera, Priya Natarajan, Marcus Webb), same explicit
banner: *"Preview data — this dashboard is not yet connected to live
league intelligence. Every value here is demo (curated data)."* Confirmed
via direct cookie inspection that no `commissioner_os_data_mode` cookie
exists on `www.allfantasy.ai` for this (or any) session — every visitor,
including the real authenticated account used throughout this engagement,
gets the same default.

---

## Root Cause

**Two independent gates control whether real data can ever render, and
both are closed — by design, not by defect:**

### Gate A — `commissioner_os_data_mode` cookie (session-level, blocks first)
`resolveServerDataMode()` (`lib/commissioner-os/demo-mode/resolveServerDataMode.ts:5-8`)
reads *only* this cookie and falls back to `DEFAULT_DATA_MODE = 'demo'`
(`lib/commissioner-os/demo-mode/constants.ts:17`) whenever it's absent or
invalid. The only UI control that ever sets this cookie,
`DataModeIndicator`, contains:
```ts
if (process.env.NODE_ENV === 'production') return null
```
(`components/commissioner-os/demo-mode/DataModeIndicator.tsx:35`) — a
deliberate, documented choice ("deliberately not shown in production...
not as a control a real customer should ever see"). **There is no other
code path anywhere in the repo that sets this cookie.** This means no
session — commissioner, regular manager, or admin — can ever reach `live`
mode in Production today, regardless of any `isLiveReady` flag. This gate
is checked *before* `isLiveReady()` is ever consulted (`getDecisionOSClient()`
/ `getDecisionOSAdapter()` resolve the mode first, then dispatch to
`stub`/`demo`/`live` — `isLiveReady()` only runs *inside* the `live`
implementation once selected).

### Gate B — Decision OS Intelligence API enablement (environment-level, blocks second)
Even hypothetically bypassing Gate A, `analytics/decision-os-client/live.ts`
(and `decision-os-client/live.ts` for Mission Control) call
`callDecisionOS('analytics', '/api/v1/intelligence/league?...')`, which
reaches `lib/decision-os/behavioral/api/gate.ts:81`:
```ts
if (process.env.DECISION_OS_INTELLIGENCE_API_ENABLED !== 'true') {
  return { ok: false, status: 503, error: { code: 'INTELLIGENCE_UNAVAILABLE', ... } }
}
```
`DECISION_OS_INTELLIGENCE_API_ENABLED` (and `DECISION_OS_BASE_URL`,
`DECISION_OS_API_KEY`) remain Preview-only in Vercel — confirmed again via
`vercel env ls` this pass — by deliberate design from Phase 4.5/4.6, so
that landing the deployment code itself could not accidentally turn on
live intelligence for real users. Confirmed live via direct call:
`GET https://www.allfantasy.ai/api/v1/intelligence/league?...` still
returns `503 INTELLIGENCE_UNAVAILABLE` right now, flags notwithstanding.

**Net effect: the two flags enabled in the staged rollout are real,
correctly-set, and completely inert given the current state of Gates A
and B.** This is not a bug introduced by this rollout — it is the
intended layered-safety design working exactly as documented in three
separate places (`demo-mode/README.md`, `liveReadiness.ts`'s own header
comment, and this session's own two prior rollout notes, which already
flagged this as an "important, honest finding" before this audit was
requested).

---

## Answers to the Seven Questions

1. **Which visual changes exist in the repo?** The full demo/live/stub
   per-module architecture (12 namespaces, each with `demo.ts`/`live.ts`/
   `stub.ts` and a matching `components/commissioner-os/<module>/`
   directory) already exists and is fully built. There is no separate,
   not-yet-merged visual redesign found anywhere in the repository — see
   §2/§3.
2. **Which branch/commit contains them?** `main`, via `eaf9d2414` ("Add
   Commissioner OS platform (Phases 0.1-3.15)") and subsequent
   Commissioner-OS-path commits (`62cfa9ce3`, `a3dfe937a`, `3a24e05b3`,
   `e4c1a4375`, `8322ac99e`, `c3da2ded8`). `git log --all` across every
   local and remote-tracking branch in this repo shows **zero** other
   commits touching `components/commissioner-os`, `app/commissioner-os`,
   or `lib/commissioner-os` since 2026-06-01 — no orphaned visual work
   exists on any other branch.
3. **Merged into `main`?** Yes — `git merge-base --is-ancestor eaf9d2414 origin/main` confirms it directly.
4. **Did Production deploy a commit that includes them?** Yes — the live
   deployment (`dpl_E9yJM3rBYydaa84AmJUmT9JBGStU`, built from merge commit
   `fb5df9004`) has `eaf9d2414` as an ancestor; already independently
   confirmed in `PRODUCTION_VALIDATION_REPORT.md` (all 13 routes render
   the full component tree, not a 404 or stub).
5. **Are flags or `commissioner_os_data_mode` preventing rendering?**
   Yes — both, stacked (Gates A and B above). Gate A is the binding
   constraint (it blocks first, in every session, unconditionally in
   production); Gate B would independently also block even if A were
   somehow bypassed.
6. **Is the UI still intentionally showing demo/preview states?** Yes,
   explicitly — the on-page banner text and `System Status: Preview mode`
   line say so directly; this is disclosed to the user, not hidden.
7. **Are any visual components dead code or unwired?** No. Every one of
   the 13 Commissioner OS routes returns `200` and renders its full
   corresponding `components/commissioner-os/<module>/` tree (re-verified
   this pass and in `PRODUCTION_VALIDATION_REPORT.md`). No orphaned,
   unimported, or "V2/new/draft"-named component files were found under
   `components/commissioner-os/`.

---

## Files / Branches Involved

- `lib/commissioner-os/demo-mode/resolveServerDataMode.ts`,
  `lib/commissioner-os/demo-mode/constants.ts` — Gate A's implementation.
- `components/commissioner-os/demo-mode/DataModeIndicator.tsx:35` — the
  production `NODE_ENV` check that makes Gate A unreachable today.
- `lib/decision-os/behavioral/api/gate.ts:81` — Gate B's implementation.
- `lib/commissioner-os/analytics/decision-os-client/live.ts`,
  `lib/commissioner-os/decision-os-client/live.ts` (Mission Control) —
  where both gates are actually exercised in the request path.
- **Branch:** everything lives on `main` only (via `claude/hungry-swartz-45f298` → PR #116, plus the pre-existing `eaf9d2414` platform commit already on `main` beforehand). No other branch contains relevant, un-merged work.

---

## Safe Next Action

**No code change is required or recommended to "fix" this** — both gates
are deliberate safety design, not defects, and this audit was explicitly
read-only per your instruction. The decision is a product/process one,
with two independent, separately-approvable levers:

1. **To make the two already-enabled flags visible to *anyone* for
   internal verification** (without exposing this to real customers):
   the lowest-risk option is a narrow, explicit exception to
   `DataModeIndicator`'s production check — e.g. gate it on an
   allow-listed admin/internal email or a separate internal-only query
   param/secret, rather than removing the `NODE_ENV === 'production'`
   check outright. This is a small, additive change to one file, not a
   redesign — but it *is* a code change, so it should wait for your
   explicit go-ahead, not be inferred from this audit.
2. **To make real users actually see live data**, Gate B must also open:
   `DECISION_OS_INTELLIGENCE_API_ENABLED`/`DECISION_OS_BASE_URL`/
   `DECISION_OS_API_KEY` need real Production values — a deliberate,
   separate go-live decision already flagged as pending in
   `PRODUCTION_GO_NO_GO_REPORT.md` and `PRODUCTION_VALIDATION_REPORT.md`,
   not something this audit recommends doing implicitly.

**Recommend holding the staged rollout exactly where it is** — do not
enable Recommendations, Notifications, Activity, Search, League Health,
or Manager Intelligence yet, and do not change Gate A or Gate B — until
you decide which of the two levers above (if either) you actually want
opened, and for whom (internal QA only, vs. real customers).
