# The Replacements — Commissioner OS Demo Package

**Status: demo-ready for an internal/first external conversation. Not a signed integration, not a
live pilot.** Everything described as "real" in this document is real and tested in this repo today
(branch `g15-event-foundation`); everything described as "future" is explicitly not built. No ROI,
retention-lift, or revenue numbers are claimed anywhere in this document — none have been measured.

**Phase D reframing note (2026-07-08):** this document is **first-client collateral for one
prospective conversation, not the top-level product definition.** The actual product is a
client-agnostic Fantasy OS Suite (Decision OS, Commissioner OS, User OS, Platform OS, future DFS
OS) — see
[`FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md`](FANTASY_OS_SUITE_CLIENT_AGNOSTIC_ROADMAP.md). This
document remains accurate and useful as-is if and when a Replacements conversation happens; it is
now understood as one instance of that broader suite's client-facing template, not the product's
ceiling.

**Date:** 2026-07-08 · **Author context:** Commissioner OS Surface Alignment, Phase B Increment 7.
**Depends on:** [`DECISION_OS_PHASE_A_IMPLEMENTATION.md`](DECISION_OS_PHASE_A_IMPLEMENTATION.md)
(the ingestion/behavioral pipeline) and
[`COMMISSIONER_OS_SURFACE_ALIGNMENT.md`](COMMISSIONER_OS_SURFACE_ALIGNMENT.md) (Phase B Increments
1–6, which built the surfaces this package demos).

**Phase C update (2026-07-08):** the technical follow-up to §7/§8/§9 of this package —
what The Replacements' adapter would actually need to do, the minimum data contract, and concrete
questions for the next call — is now written up in
[`THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md`](THE_REPLACEMENTS_PROVIDER_ADAPTER_PLAN.md). Still a
plan only — no adapter code exists yet.

**Phase C Increment 2 update (2026-07-08):** a client-facing version of that plan — sample payloads,
plain-language questions, and explicit "what we're not asking for" boundaries — is now available for
the next actual conversation with The Replacements:
[`THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`](THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md).

**Phase C Increment 3 update (2026-07-08):** a concise, live-call-ready script and talking-points
guide — pulling the highest-value points from this package, the adapter plan, and the technical
discovery handoff into something usable on the actual call — is now available:
[`THE_REPLACEMENTS_CALL_SCRIPT.md`](THE_REPLACEMENTS_CALL_SCRIPT.md).

**Demo Breadth Increment 4 update (2026-07-08):** **League Analytics is now part of the demo
surface** — a first minimal version, visible on the Commissioner Hub dashboard directly below
Mission Control (see `COMMISSIONER_OS_SURFACE_ALIGNMENT.md` §4g). It answers "what's happening in
this league over time" (activity counts, manager counts, activity trend, a retention-risk count) as
a sibling to Mission Control's "what should the commissioner do now." This is still the **first
minimal version**, not the fuller Tier 2 packaging described in §10 below — no historical/
season-over-season charting or cross-league comparison exists yet.

**Phase C Increment 5 update (2026-07-08):** a final, practical pre-call checklist consolidating
this package, the adapter plan, the technical discovery handoff, and the call script — including a
Go/No-Go checklist and a concrete demo script order — is now available:
[`THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md`](THE_REPLACEMENTS_DEMO_READINESS_CHECKLIST.md).
Review this immediately before the actual call.

---

## 1. Executive summary

AllFantasy has built a real, tested, deterministic intelligence layer — **Decision OS** — that turns
raw league activity (trades, waivers, roster moves, drafts) into commissioner-facing signals: league
health, activity trend, manager engagement, retention risk, and recommended actions. **Commissioner
OS** is the product surface on top of it — today, concretely, **Mission Control**, a single card on
the Commissioner Hub dashboard that shows all of the above for one league.

The pitch to The Replacements is not "we have a finished product to plug in." It is: **the
intelligence engine and one real, working surface already exist and are demoable today, on
AllFantasy-native and imported-league data; making it work on The Replacements' own leagues is an
integration project, not a research project.** The behavioral pipeline is provider-agnostic by
design — it already ingests imported/external activity (proven with realistically-shaped Sleeper
data) and already attributes activity to managers who have no AllFantasy account. Wiring in a new
provider means writing one adapter to an existing, documented seam — not redesigning the pipeline.

This document is the demo package: what to show, in what order, what's real vs. not yet, what data
The Replacements would need to hand over, what the integration would look like, a pilot plan, a
licensing-tier sketch, and the concrete engineering gaps that stand between this demo and a live
pilot on The Replacements' real leagues.

---

## 2. What The Replacements would see

A single screen — the Commissioner Hub dashboard, with the **Mission Control** card — showing, for
one real league:

- A **league health status** (excellent / healthy / watch / at_risk / critical) and a one-line
  summary, computed by a deterministic scoring engine.
- **Active vs. inactive manager counts.**
- **Trade, waiver claim, draft pick, and roster activity counts** for the league.
- An **activity trend** — is real activity (event volume) increasing, decreasing, or flat over time
  — or an honest "not enough history yet" state if snapshot history hasn't accumulated.
- **Managers at retention risk** — named, with the real behavioral reasons behind the flag (e.g.
  inactivity, declining engagement) — or "No managers currently flagged" if none.
- **Recommended commissioner actions** — concrete, prioritized ("urgent" vs "standard") suggestions
  like resolving disputes, activating trade discussion, or reaching out to inactive managers —
  or "No recommended actions right now" if the league is quiet and healthy.

Every one of those fields is either a **real, computed value** from real activity data, or an
**explicit, honest "unavailable"/"empty" state** — never a placeholder number, never a fabricated
trend line.

---

## 3. How Decision OS powers Commissioner OS

```
Raw league activity (trades, waivers, roster moves, drafts)
  → normalized into BehavioralEvents (provider-agnostic; works for AF-native AND imported leagues)
  → assembled into League/Manager Behavioral Facts (event counts, participation, per-manager engagement)
  → derived into Manager Behavioral Intelligence (participation tier, retention risk + real reasons,
    per-dimension engagement — trade/waiver/lineup/draft)
  → snapshotted daily and stored as trend history (idempotent, one row per league/manager/day)
  → federated into the existing League Health scoring engine (real inputs, unmodified scoring math)
  → composed into Mission Control: one flat, honest snapshot per league
  → rendered as a card on the Commissioner Hub dashboard
```

**Decision OS** is the "brain" — the behavioral pipeline, the facts, the derived intelligence, the
trend history. It has no UI of its own and makes no promises about what a commissioner sees; it only
produces real, honestly-labeled signals or explicit "not enough data" states.

**Commissioner OS** is the commissioner-facing product built on top of it: today, that means Mission
Control (and, less directly, the existing League Health route, and the Manager DNA/Recommendations
cards that were already live on the Commissioner Hub before this workstream started).

The key point for The Replacements: **Decision OS does not care whether a league is AF-native or
imported from an external platform.** The behavioral event format is provider-agnostic, and imported
activity is already merged into the exact same pipeline that produces Mission Control — proven with
realistically-shaped Sleeper API data, including managers who have no AllFantasy account at all
(their activity is still attributed and shown). The Replacements' leagues would flow through the
identical pipeline once a provider adapter exists (see §7).

---

## 4. Demo Flow

A concrete, step-by-step walkthrough for an internal or first external demo session.

1. **Open Commissioner Hub** (`/commissioner-hub`) for a league with real activity history.
   Point out: this is the same dashboard a commissioner already uses today — Mission Control is a
   new card on an existing page, not a separate app.

2. **Show Mission Control.** Scroll to the Mission Control card. Read the health status badge and
   summary line aloud — emphasize that this sentence is generated deterministically from real
   counts, not written by a person or an LLM.

3. **Show League Health.** Point at the health status badge and the underlying score components
   (engagement / fairness / sustainability, visible via the same federated engine if inspecting the
   API response). Explain: this is not a new scoring algorithm built for the demo — it's an existing,
   previously-built scoring engine that used to require someone to hand-type in every metric; Decision
   OS now feeds it real numbers automatically.

4. **Explain the activity trend.** Point at the trend line/badge. If the league has 2+ days of
   snapshot history, show the real direction (increasing/decreasing/flat) and the event-count delta.
   If it doesn't yet, show the honest `no_snapshots` or `insufficient_history` state and explain: this
   is what a brand-new integration looks like on day one — the system tells the truth about not
   having history yet, rather than faking a chart.

5. **Explain retention-risk managers.** Point at the list (or the "No managers currently flagged"
   state). Explain that each flagged manager has a *reason* — not just a red flag — derived from real
   behavior (e.g., inactivity, declining lineup submission), so a commissioner knows *why*, not just
   *who*.

6. **Explain recommended commissioner actions.** Point at the urgent/standard action list. Explain
   these come from the same federated health engine — not a separate AI writing arbitrary
   suggestions — so they are explainable and traceable back to the real counts that produced them.

7. **Explain how external data feeds Decision OS.** Walk through §3's diagram verbally: any league
   activity — regardless of which platform it originated on — becomes the same `BehavioralEvent`
   shape once normalized. Point to the fact that this has already been proven with realistically-
   shaped Sleeper data, including a manager with no AllFantasy account, whose activity still showed
   up correctly attributed. The pitch: The Replacements' data would go through the same seam.

---

## 5. Current built surfaces (what exists today, code-verified)

| Surface | What it is | Status |
| --- | --- | --- |
| Decision OS behavioral pipeline | Event normalization, facts, per-manager intelligence, retention risk, engagement tiers | Real, tested, live-wired into the Commissioner Hub dashboard |
| Imported/external activity ingestion | Provider-agnostic normalizer + idempotent writer + Sleeper emitter, proven with realistically-shaped Sleeper data (not a live Sleeper API pull) | Real, tested; not yet wired into the production Sleeper backfill call site |
| Behavioral snapshot + trend history | Daily snapshot capture, idempotent by (league, manager, day), a callable capture job/route | Real, tested; **not scheduled to run automatically** (route exists, `vercel.json` registration is a deliberate future step) |
| League Health federation | Existing scoring engine now fed real Decision OS counts via an explicit opt-in contract; legacy contract untouched | Real, tested; no live UI caller of the raw `/api/league-health` route itself (Mission Control reads the same underlying composition function directly) |
| **Mission Control** | Single composition (`lib/decision-os/missionControl.ts`) + read API + a visible card on the Commissioner Hub dashboard | Real, tested, **visible today** |
| **League Analytics** | Single composition (`lib/decision-os/leagueAnalytics.ts`) + read API + a visible card on the Commissioner Hub dashboard, directly below Mission Control | Real, tested, **visible today** — first minimal version only (counts + single-league trend; no season history or cross-league comparison) |
| The Replacements provider adapter | — | Does not exist. Not started (see §7/§9). |
| Commissioner Intelligence Hub (7-module hub) | A separate, older intelligence system (`/league/[id]/intelligence`) built on a different event taxonomy | Real, live, but **not connected to Decision OS** — a separate, larger migration decision, not part of this demo package |

---

## 6. What is real vs. unavailable vs. future

**Real, today, code-verified:**
- League health scoring, fed by real trade/waiver/manager/draft counts.
- Active/inactive manager counts, retention-risk flags with real reasons.
- Trade, waiver, draft, and roster activity counts.
- Provider-agnostic activity ingestion (proven with Sleeper-shaped data) including managers with no
  AllFantasy account.
- Idempotent daily snapshot capture, safe to re-run without duplicating data.
- Mission Control card, visible on the Commissioner Hub dashboard.

**Honestly unavailable (by design, not a bug) until certain conditions are met:**
- Activity trend direction — requires at least 2 days of captured snapshot history for a given
  league. Reports `no_snapshots` or `insufficient_history` until then.
- Retention-risk list — empty (not fabricated) for a league with no managers currently at risk.
- Recommended actions — empty (not fabricated) for a healthy, quiet league.
- Any of the above for a league Decision OS cannot read at all — degrades to an explicit
  "unavailable" state, never a guessed value.

**Future — explicitly not built yet:**
- A dedicated Mission Control or League Analytics page/route (today each is one card on an existing
  dashboard).
- A **broader** League Analytics — season-over-season history, cross-league comparison — beyond the
  first minimal, single-league, current-counts-plus-trend version now live.
- A real, live scheduler running the snapshot-capture job automatically (the job/route exists and is
  tested; nothing currently invokes it on a recurring schedule).
- A The Replacements provider adapter (see §7).
- Any measured retention, engagement-lift, or ROI outcome from Commissioner OS — **none has been
  measured on any league, AF-native or imported.**

---

## 7. Integration Inputs Needed From The Replacements

To run Decision OS + Commissioner OS on The Replacements' real leagues, the following would need to
be provided (via API access, data export, or webhook — the exact mechanism is a technical
integration decision, not assumed here):

- **League IDs** — a stable, unique identifier per league.
- **Manager/team IDs** — a stable, unique identifier per manager/team, independent of any
  AllFantasy account (Decision OS already supports "external-only" managers with no AF account).
- **Rosters** — current and historical roster composition per team.
- **Matchups** — weekly matchup/schedule data (supports future engagement-dimension work; not
  required for what Mission Control shows today).
- **Transactions** — a general transaction feed, or the more specific categories below.
- **Waivers** — waiver claims: who claimed what, when, and the outcome (awarded/failed).
- **Trades** — trade proposals and their resolution (accepted/rejected/expired), and who was
  involved.
- **Drafts** — draft picks: who picked what, in which round/slot, and when (or at minimum, which
  draft/season a pick belongs to — Decision OS's Sleeper emitter already handles a pick with no
  granular per-pick timestamp by honestly skipping trend attribution for it rather than fabricating
  one).
- **Timestamps** — an `occurredAt` (or equivalent) for every activity item above. Decision OS's
  ingestion normalizer already refuses to fabricate a timestamp — activity without one is honestly
  skipped, not silently timestamped as "now."
- **Scoring/settings metadata** — league format, roster size, scoring rules, and similar settings
  metadata (used by the existing League Health engine's non-Decision-OS-derived fields, e.g. league
  type, number of teams).
- **Auth/tenant mapping** — a way to map a The Replacements league + manager to a stable identity
  Decision OS can key on, and a way to establish which AllFantasy/Commissioner OS tenant a given
  league's data belongs to (a multi-tenant boundary question, not yet designed — see §9).

---

## 8. Integration architecture

```
The Replacements platform
  → (their API / export / webhook — mechanism TBD, a real integration decision, not assumed)
  → NEW: "the_replacements" provider adapter
      - parses The Replacements' raw shapes (their trade/waiver/roster/draft formats)
      - emits provider-neutral RawImportedActivity records
      - mirrors the existing Sleeper emitter's pattern exactly (lib/decision-os/ingestion/sleeperActivityEmitter.ts)
  → EXISTING, UNCHANGED: importedActivityNormalizer.ts
      - deterministic natural-key idempotency
      - external-manager identity resolution (no AF account required)
      - honest skip-with-reason for anything unkeyable/unattributable
  → EXISTING, UNCHANGED: DecisionOsImportedActivity model + Prisma adapter
      - dedicated, provider-neutral storage; no AF-native table coupling; no AppUser fabrication
  → EXISTING, UNCHANGED: behavioral pipeline (facts → manager intelligence → snapshots/trend)
  → EXISTING, UNCHANGED: League Health federation + Mission Control composition
  → EXISTING, UNCHANGED: Mission Control card on the Commissioner Hub dashboard
```

The architectural claim being made here is narrow and verifiable: **every layer below "the_replacements
provider adapter" already exists, is tested, and does not need to change.** Everything above that
line — parsing The Replacements' specific data shapes into the existing provider-neutral format — is
the actual integration work, and it is scoped to be one adapter, following an existing pattern that
has already been built once (for Sleeper).

---

## 9. Pilot plan (proposed, not committed)

A conservative, staged pilot — no step here has been executed or scheduled; this is a proposed shape
for the conversation, not a project plan with dates.

1. **Data-sharing agreement** with The Replacements covering exactly the inputs in §7, including
   which leagues (a small pilot set, not their whole platform) and for how long.
2. **Build the `the_replacements` provider adapter** (§7/§8) against real (or realistically-shaped,
   if live access isn't available yet) sample data from The Replacements, mirroring the Sleeper
   emitter's pattern and tests.
3. **Ingest a small pilot set of real leagues** into a non-production environment; verify idempotent
   re-ingestion (safe to re-run without duplicating data) and correct external-manager attribution,
   the same way Sleeper's proof was done — via realistic fixtures and non-prod DB verification before
   any production data path exists.
4. **Enable the snapshot-capture schedule** for the pilot leagues only (the job/route already exists;
   this step is registering a real schedule + `CRON_SECRET`, deliberately not done yet).
5. **Let trend history accumulate for a real window** (at minimum several days, ideally a few weeks)
   before showing trend/retention-risk signals to The Replacements' own commissioners — Mission
   Control will honestly show `no_snapshots`/`insufficient_history` until then, which should be set
   as an expectation up front, not treated as a bug.
6. **Review with The Replacements' commissioners** — get direct feedback on Mission Control's
   usefulness, before any decision to expand beyond the pilot league set.
7. **Only after review:** decide on productionizing the adapter, multi-tenant boundaries, and
   commercial terms.

No step in this plan has been started. Steps 2–4 are the concrete engineering work; steps 1, 5–7 are
business/product decisions outside engineering scope.

---

## 10. Licensing tiers / packaging suggestion (a sketch, not a commercial commitment)

This is a suggested shape for internal discussion — not a proposed price, contract, or commitment to
The Replacements.

- **Tier 1 — Mission Control + League Analytics (first minimal versions, both now live).** League
  health, activity trend, manager counts/activity, retention-risk (named managers + reasons in
  Mission Control, a count in League Analytics), recommended actions — exactly what this demo
  package shows. Lowest integration lift (one provider adapter, no new UI beyond what exists).
- **Tier 2 — Broader League Analytics** (season-over-season history, cross-league comparison — not
  built yet, only the first minimal single-league version is live today).
- **Tier 3 — Full Commissioner OS** (Tier 1/2 + a resolved Commissioner Intelligence Hub, i.e. the
  7-module hub migrated onto Decision OS, or reconciled with it — a large, separate architecture
  decision, see §11).

Packaging by *surface* (what a licensee's commissioners actually see) rather than by internal
subsystem names keeps this legible to a partner conversation and doesn't over-promise anything not
yet built.

---

## 11. Remaining engineering gaps before a live pilot

Concrete, in order of what blocks a live pilot the earliest:

1. **No `the_replacements` provider adapter exists.** `ImportProvider` currently supports `sleeper`,
   `espn`, `yahoo`, `fantrax`, `mfl`, `fleaflicker` — not The Replacements. This is the single biggest
   blocker to any real integration (§7/§8/§9 step 2).
2. **No real API/data access to The Replacements exists in this environment.** All ingestion proof so
   far uses realistically-shaped fixture data (matching real provider API shapes), not a live pull —
   this is true for Sleeper too, and would be equally true for The Replacements until a real
   data-sharing agreement and API/export access exists.
3. **The snapshot-capture job is not scheduled anywhere.** The route/job exist and are tested, but
   nothing invokes them automatically — trend history will not accumulate for any league, pilot or
   otherwise, until a real schedule is registered (a deliberate, separate deployment decision, not a
   code gap).
4. **`ingestSleeperImportedActivity` (and by extension, any future provider's ingestion entry point)
   is not wired into the real production import/backfill call site yet** — today it's invoked by
   tests, not by a live import job.
5. **AF-league/manager identity mapping enrichment is incomplete** — imported managers without an
   AllFantasy account are correctly attributed as "external-only" today, but there's no enrichment
   step yet that upgrades that attribution to a confirmed AF identity when one later exists.
6. **No multi-tenant boundary design exists** for "which Commissioner OS tenant does this externally-
   sourced league's data belong to" — needed before onboarding a real external partner's leagues,
   not needed for a same-tenant demo.
7. **Mission Control has no page of its own** — it is one card on the Commissioner Hub dashboard.
   Fine for a demo; a licensing conversation may want a dedicated, embeddable surface eventually.
8. **League Health and Mission Control have not been validated against real, non-fixture production
   data at any meaningful volume** — all real-data proofs to date used a throwaway, non-production
   Neon database with realistic but synthetic fixtures.

---

## 12. What Not To Promise Yet

- **DFS OS.** Does not exist. Not scoped. Not part of this conversation.
- **User OS.** Does not exist. Not scoped. Not part of this conversation.
- **Full/broader League Analytics.** A first minimal version is now live (counts + single-league
  trend), but season-over-season history and cross-league comparison do not exist and are not
  scoped.
- **A fully productionized The Replacements adapter.** No adapter exists yet (§11 item 1). What can be
  promised is an existing, proven pattern (the Sleeper emitter) that a new adapter would follow —
  not a finished integration.
- **Production cron/scheduling**, unless and until deliberately enabled. The snapshot-capture route
  exists and is tested but is not registered in `vercel.json` and has no `CRON_SECRET` assumption
  about any specific environment. Enabling it for any real pilot is a distinct, deliberate step.
- **Any retention lift, engagement lift, or ROI number.** None has been measured, on any league,
  AF-native or imported, pilot or otherwise. Do not cite a percentage, a dollar figure, or a claim of
  "leagues stay X% more active" in any conversation until real measurement exists. This document
  makes zero such claims and none should be improvised in a live demo either.

---

## 13. Boundaries honored (this increment)

- No code changes required or made to ship this package — it is a documentation deliverable, per
  the increment's own scope ("if low-risk, add a small internal demo route... otherwise, document
  only"). No existing "small, clear demo-route pattern" was found that this package needed beyond
  what Increment 6 already built (the Mission Control card itself *is* the demo surface) — adding a
  separate "demo mode" route or flag was judged to be new scope, not a documentation task, so it was
  not built.
- No League Analytics, DFS OS, User OS, or The Replacements provider adapter built.
- No fake/demo data added anywhere.
- No production DB touched; no production cron enabled.
- PR #183 untouched, still draft, not merged.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
