# ADR — Rich Platform Intelligence (Phase 5.3/5.4/5.5+) Cutover Decision

**Status:** Accepted (no-cutover for internal use; external hosted-API path already has its own,
narrower, already-Accepted authorization that remains at "staging-verified, not production-enabled").
**Date:** 2026-07-08 · **Branch:** `g15-event-foundation`. **Phase D Increment 9** (successor to
[`PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md`](PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md) and
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md)).

---

## 0. Executive summary

This ADR was requested to answer one question: should the richer Phase 5.3 (`LeagueBehavioralIntelligence`)
/ 5.4 (`PlatformBehavioralIntelligence`) pipeline move from shadow-gated to cut over? Auditing the
actual ADR trail (not just the code) surfaced a real, load-bearing distinction that the question as
posed conflates **two different consumption models**, each with its own separate authorization
history:

1. **AllFantasy-internal consumption** (a hypothetical internal UI reading Phase 5.3/5.4 directly,
   the way Mission Control reads League Health) — **still genuinely shadow-gated.** No ADR
   authorizes this path. **Decision: do not cut over.** The minimum Platform OS composition
   (`lib/decision-os/platformOs.ts`, Increment 4) remains the correct choice for internal surfaces.
2. **External hosted Intelligence API** (`/api/v1/intelligence/*`, a third-party-facing,
   API-key-gated, tenant-isolated product) — has its **own, already-Accepted ADR chain** (5.5
   through 5.10) that designed, built, and **staging-verified** this exact cutover already. The code
   is real and wired. **What remains is a production-enablement decision** (issuing real tenant API
   keys, setting two environment variables in a real environment) — a business/ops decision, not a
   code gap, and explicitly out of scope for this increment to make.

Both paths stay exactly where they are after this ADR. **No cutover is executed by this document.**

---

## 1. What exists today (code-verified, not guessed)

| Layer | File(s) | Status |
| --- | --- | --- |
| Phase 5.2 — Manager Behavioral Intelligence | `lib/decision-os/behavioral/manager-intelligence.ts` | Real, tested, **already cut over** — Commissioner OS (Mission Control, League Analytics, User OS) already calls this directly for retention risk / team health. |
| Phase 5.3 — League Behavioral Intelligence | `lib/decision-os/behavioral/league-intelligence.ts` (`deriveLeagueBehavioralIntelligence`) | Real, tested. Own ADR: shadow-only until a **Phase 5.4** cutover ADR. No internal-UI cutover ADR exists. |
| Phase 5.4 — Platform Behavioral Intelligence | `lib/decision-os/behavioral/platform-intelligence.ts` (`derivePlatformBehavioralIntelligence`) | Real, 88-test-covered, and **already wired end-to-end** inside `real-data-provider.ts` (confirmed in the Platform OS audit). Own ADR: shadow-only until a **Phase 5.5** cutover ADR. |
| Phase 5.5 — Intelligence API Boundary Design | `lib/decision-os/behavioral/ADR_F5_5_INTELLIGENCE_API_BOUNDARY.md` | **Accepted.** This IS the "Phase 5.5 cutover ADR" Phase 5.4's docstring names. But it explicitly designs a **hosted, external, multi-tenant, API-key-gated** product (endpoint matrix, tier permissions, rate limits, versioning) — and explicitly states "this ADR governs the design... no routes, no DB access, no live auth plumbing. Those are Phase 5.6 deliverables." It does **not** authorize, and was never intended to authorize, a same-app internal UI reading Phase 5.3/5.4 directly. |
| Phase 5.6–5.8 — API routes, handlers, real provider | `app/api/v1/intelligence/platform/route.ts` (+ `league`, `manager`), `lib/decision-os/behavioral/api/intelligence-handlers.ts`, `real-data-provider.ts` | Real, exists as actual route files. Routes call `resolveDataProvider()` (see next row) — **not** hardcoded to a stub, contrary to a stale comment in `real-data-provider.ts` (corrected this increment, §6). |
| Phase 5.9 — Real Provider Opt-In | `lib/decision-os/behavioral/api/provider-selector.ts`, `ADR_F5_9_REAL_PROVIDER_OPT_IN.md` (Accepted) | **Real, already implemented.** `resolveDataProvider()` reads `DECISION_OS_INTELLIGENCE_API_PROVIDER` at call time — `'real'` → the actual behavioral pipeline; anything else → stub → `503`. This env flag **is the cutover mechanism** for the external API, and it already exists in code. |
| Phase 5.10 — Staging Verification | `ADR_F5_10_STAGING_VERIFICATION.md` (Status: **COMPLETE**) | The external API path was verified end-to-end against a real **staging** Neon database (`ep-winter-salad`), explicitly "before any production cut-over." Production cutover is named as a distinct, later, not-yet-taken step. |
| Minimum Platform OS (this workstream) | `lib/decision-os/platformOs.ts` (Increment 4) | Real, tested, deliberately **narrower** — composes only the already-cut-over Commissioner OS data (Mission Control/League Analytics), explicit league lists, no route (an unresolved operator-authorization question, §15 of the Platform OS audit — a *different*, same-app internal question, unrelated to the external API's tenant/key model). |

**Correction after direct verification (an earlier draft of this ADR overclaimed here — caught before
finalizing):** `.env.staging` (checked into this repo) **does** set
`DECISION_OS_INTELLIGENCE_API_ENABLED=true` and `DECISION_OS_INTELLIGENCE_API_PROVIDER=real`, plus
three real test API keys (`INTELLIGENCE_API_TEST_KEYS`, one per tier: commissioner/manager/platform)
— genuinely matching ADR_F5_10's "COMPLETE" staging verification claim, not just a historical
one-time test. **`vercel.json` and no `.env.production`-equivalent set these values** — production
remains unconfigured, consistent with ADR_F5_10's own framing that production enablement is a
distinct, deliberate, not-yet-taken step. (A sibling worktree's own local `.env` also has these
flags set — irrelevant to this repo's own state, noted only to avoid conflating a different
session's local config with this one.)

---

## 2. What minimum Platform OS already provides

Per Increment 4/§10 of `PLATFORM_OS_CLIENT_INTELLIGENCE_AUDIT.md`: total monitored leagues,
healthy/at-risk split (from real `engine.overallStatus`), aggregate manager/activity counts, a
retention-risk count, an intervention queue built from real per-league urgent recommended actions,
and trend-coverage reporting — all composed from data **already live in production** via Mission
Control/League Analytics, for an **explicit** caller-supplied set of leagues. No route/UI yet
(§15's operator-authorization gap, unrelated to anything in this ADR).

## 3. What the richer pipeline would add

- **Phase 5.3 per-league:** a richer `leagueEngagementTier`, activity-tier dimensions with
  per-manager rates (not just counts), a **deterministic customer-facing recommendations list**
  (`LeagueCommissionerRecommendation[]`, own ADR gate — see `COMMISSIONER_OS_SURFACE_ALIGNMENT.md`
  §4e for why Mission Control deliberately didn't use this), and structured health-narrative inputs.
- **Phase 5.4 platform-wide:** a real activity heatmap (day-of-week × hour-of-day), a
  recency-based engagement momentum signal, commissioner-quality distribution, and a more
  sophisticated multi-pass intervention-opportunity list (capped, prioritized by combined
  retention+workload signals) — genuinely richer than Platform OS's own single-pass
  urgent-action-count approach.
- **The external hosted API (5.5-5.10), if ever production-enabled:** the whole tenant/API-key/
  rate-limit/versioning/telemetry apparatus for licensing this intelligence to **external**
  consumers — a fundamentally different product surface than anything AllFantasy-internal.

## 4. Current blockers

**For internal same-app use (path 1):**
- No ADR authorizes reading Phase 5.3/5.4 directly into an internal AllFantasy UI. ADR_F5_5
  authorizes only the external hosted-API consumption model — a different question entirely.
- Writing such an ADR would need to decide: does an internal UI read the SAME `real-data-provider.ts`
  composition the external API uses (coupling an internal surface's behavior to a design built for
  external tenants/rate limits/versioning), or build a parallel, internal-only composition (more
  work, cleaner separation)? Not decided here — a real design question for whoever picks this up.

**For the external hosted API (path 2):**
- Staging has real *test* API keys (`INTELLIGENCE_API_TEST_KEYS` in `.env.staging`, one per tier) —
  but no evidence of a real *production* tenant-issuance workflow (a durable API-key store, a signup/
  billing flow, real non-test tenants) anywhere in this repo.
- A production enablement decision (`DECISION_OS_INTELLIGENCE_API_ENABLED=true` +
  `DECISION_OS_INTELLIGENCE_API_PROVIDER=real` in a real production environment, plus real — not
  test — tenant keys) — explicitly a business/ops decision per ADR_F5_10's own framing, not a code
  gap.
- No evidence of ongoing telemetry/alerting (completeness SLA, latency, error-rate thresholds —
  all specified in ADR_F5_5 §Telemetry Requirements) actually wired to a live observability
  platform.

## 5. Safety / authorization requirements (if either path is pursued later)

- **Path 1 (internal):** would need its own explicit ADR, following this workstream's own
  established discipline (e.g. `leagueHealthAlignment.ts`'s "federate vs replace" decision) —
  scoping exactly which Phase 5.3/5.4 fields reach which internal surface, and why doing so is
  lower-risk than the narrower Platform OS composition it would supersede or extend.
- **Path 2 (external API):** ADR_F5_5 already specifies the requirements in full (tenant isolation,
  scope/tier gating, rate limits, PII/anonymization rules, versioning, telemetry) — nothing new to
  add here. The remaining work is executing that design in a real environment with real tenants,
  which is out of scope for a code audit.

## 6. Test requirements

- **Path 1:** none needed yet — no code change is being made toward this path.
- **Path 2:** ADR_F5_10 already reports staging verification COMPLETE. Production readiness would
  additionally need: real tenant/API-key issuance tests, rate-limit enforcement tests under load,
  and telemetry-pipeline tests (completeness/latency/error-rate alerting) — none of which exist yet
  in this repo, consistent with production not being enabled.

## 7. Recommended decision

**No cutover, for either path, in this increment.** Specifically:

- **Path 1 (internal UI reading Phase 5.3/5.4 directly): remain shadow-gated.** The minimum Platform
  OS composition (`lib/decision-os/platformOs.ts`) is the correct, already-built, lower-risk answer
  for any current internal need. Revisit only if/when a specific internal surface genuinely needs
  the richer signals (the activity heatmap, momentum signal, or Phase 5.3's deterministic
  recommendations) enough to justify writing a dedicated ADR for that specific exposure.
- **Path 2 (external hosted API): remain at "staging-verified, not production-enabled."** The code
  and design are real and further along than a first read of `real-data-provider.ts`'s own (stale)
  comment suggested — but flipping it on for real external tenants is a business decision (who is
  the first licensee, what's the pricing/tier, who owns API key issuance and telemetry) that this
  session has no basis to make, and that the task's own "do not promise ROI/retention lift" and
  "cross the shadow-gated cutover" instructions correctly keep out of scope.

---

## 8. A small, safe, gate-respecting fix made this increment

`lib/decision-os/behavioral/api/real-data-provider.ts` line 251 read *"Routes currently use
stubDataProvider (Phase 5.7); swap to this in Phase 5.9."* — this is **stale**: Phase 5.9 already
happened (`provider-selector.ts`'s `resolveDataProvider()` is real and wired; the route files call it
directly, not a hardcoded stub). Left uncorrected, this comment actively misleads a future reader
into re-auditing a gap that no longer exists. Corrected to describe the current, accurate state —
zero behavior change, no gate crossed, pure observability/clarity improvement, per this increment's
own instruction (§Do #4).

---

## 9. Consequences

### Positive
- The actual state of the "shadow-gated cutover" question is now precise and documented, not a
  single blurred gate — future work can target the *specific* path (internal vs external) that
  matters, instead of re-litigating a conflated question.
- A real documentation bug (the stale Phase 5.9 comment) is fixed, at zero risk.
- No new architecture surface, no new gate crossed, no production/DB/env changes.

### Accepted limitations
- This ADR does not resolve path 1's "internal vs external composition" design question — it
  identifies it as the real open question for whoever picks up path 1 later.
- This ADR does not make the business decision path 2 requires — it only clarifies that the
  remaining blocker there is business/ops, not engineering.

---

## 10. Boundaries honored (this increment)

- No cutover executed — both paths remain exactly where they were, more precisely documented.
- No production DB touched. No auto-discovery of leagues.
- No fake data, no ROI/retention-lift claims.
- The one code change made (§8) is a doc-comment correction with zero behavior change — does not
  cross any gate.
- PR #183 untouched, still draft, not merged.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched. No DFS OS work. No
  `the_replacements` provider work.
