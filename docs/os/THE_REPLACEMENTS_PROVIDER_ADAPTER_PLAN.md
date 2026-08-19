# The Replacements — Provider Adapter Technical Plan

**Status: PLAN ONLY. No adapter code exists. `"the_replacements"` has not been added to
`ImportProvider`. This document defines the contract an adapter would need to satisfy — it does not
build one.** We do not have The Replacements' actual API/data contract yet; every field below is
what Decision OS's existing pipeline requires, not a confirmed shape from their side.

**Date:** 2026-07-08 · **Branch:** `g15-event-foundation`. **Depends on:**
[`THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`](THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md)
(the business/demo package this plan makes technically concrete),
[`COMMISSIONER_OS_SURFACE_ALIGNMENT.md`](COMMISSIONER_OS_SURFACE_ALIGNMENT.md) (the surfaces this
data would power), and
[`DECISION_OS_PHASE_A_IMPLEMENTATION.md`](DECISION_OS_PHASE_A_IMPLEMENTATION.md) (the ingestion
pipeline this plan targets).

**Phase C Increment 2 update (2026-07-08):** this internal plan now has a client-facing counterpart
— [`THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md`](THE_REPLACEMENTS_TECHNICAL_DISCOVERY_HANDOFF.md)
— written for the next conversation with The Replacements themselves (sample payloads, plain-
language questions, explicit "not asking for" boundaries). Use this internal plan for engineering
scoping; use the handoff document on an actual call with them.

---

## 0. A scoping decision made while reading the existing code

There are **two different existing integration surfaces** in this repo, and this plan deliberately
targets the smaller one:

1. **`ILeagueImportAdapter`** (`lib/league-import/adapters/ILeagueImportAdapter.ts`) — the full
   "import a league into AllFantasy" contract every existing provider (Sleeper, ESPN, Yahoo,
   Fantrax, MFL, Fleaflicker) implements: `normalize(raw) → NormalizedImportResult` (league
   settings, full rosters, scoring, schedule, draft picks, transactions, standings, player map,
   identity mappings). This is what powers AllFantasy's `/import` flow — turning an external league
   into a fully playable AllFantasy league.
2. **The Decision OS activity emitter pattern** (`lib/decision-os/ingestion/sleeperActivityEmitter.ts`)
   — a narrower, provider-specific layer that only emits `RawImportedActivity[]` (trades, waivers,
   roster moves, draft picks with real timestamps and manager identity) into the Decision OS
   behavioral pipeline. It does **not** need full league settings, scoring rules, or a playable
   AllFantasy league to exist.

**Commissioner OS (Mission Control, League Health, trend, retention risk, recommended actions) only
needs #2.** The Replacements does not need to become a full AllFantasy import provider (with
playable rosters, live scoring, etc.) for Commissioner OS to work on their leagues — they need an
**activity feed**, not a **league import**. This plan is scoped to #2. If The Replacements later
wants their leagues fully playable inside AllFantasy (not the stated goal — their interest is
licensing Commissioner OS as an intelligence layer), that would be a separate, larger `ILeagueImportAdapter`
effort, out of scope here.

---

## 1. What The Replacements adapter is responsible for

A `the_replacements` activity emitter, structurally mirroring
`lib/decision-os/ingestion/sleeperActivityEmitter.ts`, responsible for exactly three things — and
nothing else:

1. **Parse The Replacements' native data shapes** (whatever their API/export actually returns —
   unknown until we have their contract) into the provider-neutral `RawImportedActivity` shape
   already defined in `lib/decision-os/ingestion/importedActivityNormalizer.ts`:
   `{ provider, leagueId, activityType, providerEventId, occurredAt, managerSourceIds, payload }`.
2. **Resolve manager identity** via the existing `ExternalIdentityMapping` mechanism
   (`lib/league-import/mappers/ExternalIdentityMapper.ts` + `lib/league-import/types.ts`) — the SAME
   identity system Sleeper already uses, not a new one. A manager with no AllFantasy account is
   still attributable via a provider `stable_key`.
3. **Hand raw activity to the existing, unchanged pipeline** — `normalizeImportedActivityBatch` →
   `writeImportedActivity` → `ImportedActivityStore`/`PrismaImportedActivityStore` →
   `DecisionOsImportedActivity` rows. The adapter does not touch the normalizer, the writer, the
   store, or the Prisma model — those are provider-agnostic and already built/tested.

The adapter is explicitly **not** responsible for: deciding idempotency keys (the normalizer derives
those), writing to the database (the store does that), computing behavioral facts, snapshots, trend,
League Health, or Mission Control (all downstream, already built, provider-agnostic).

---

## 2. Minimum viable data contract

The smallest set of fields Decision OS's existing types actually require, mapped to what The
Replacements would need to expose per activity item:

| Decision OS field (`RawImportedActivity`) | Requirement | The Replacements would need to provide |
| --- | --- | --- |
| `leagueId` | Required, stable | A stable league identifier, unique within The Replacements |
| `activityType` | One of `trade`\|`waiver`\|`roster_move`\|`draft_pick` | Whatever categorization The Replacements uses, mappable to these four |
| `providerEventId` | Required for idempotency — **without it, the item is honestly skipped, not fabricated** | A stable, unique id per transaction/pick event |
| `occurredAt` | Required, a real ISO-8601-parseable instant — **without it, the item is honestly skipped** | A real timestamp per event (not "now," not inferred) |
| `managerSourceIds` | At least one resolvable id, or the item is honestly skipped | Stable manager/team ids involved in the event |
| `payload` | Optional, carried through unmodified | Whatever raw context The Replacements wants preserved (not required for facts/trend to compute) |

**Nothing else is required at the activity level.** No roster contents, no scoring settings, no
matchup data is needed for `RawImportedActivity` itself — those only matter for the broader
`NormalizedImportResult` shape (§0), which is out of scope for this plan.

---

## 3. Provider identity model

- Add `'the_replacements'` to `IMPORT_PROVIDERS` (`lib/league-import/types.ts`) — **not done in
  this increment**, deliberately (see "Do not" list). When it happens, it is a one-line addition to
  an existing const array; no other file needs to change to accommodate a new provider name at the
  type level.
- Every `RawImportedActivity` carries `provider: 'the_replacements'` — this is how the pipeline
  keeps The Replacements' activity provenance-distinct from Sleeper/ESPN/etc. without any special-
  casing downstream (the normalizer, writer, store, and behavioral reader are all provider-blind
  past this field).

## 4. League mapping

- `leagueId` on every `RawImportedActivity` must be **The Replacements' own league id** (a
  `providerLeagueId`, in `DecisionOsImportedActivity` terms) — not an AllFantasy league id. This
  matches the existing model's `afLeagueId: String?` (nullable) vs. `providerLeagueId: String`
  (required) split: Decision OS can operate on a league that has **no** corresponding AllFantasy
  league at all.
- If/when an AllFantasy-side league mapping is desired (e.g. to unify a Replacements league with an
  existing AF-native league), that is the **AF-league/appUserId mapping enrichment** work already
  flagged as open in Phase A (`DECISION_OS_PHASE_A_IMPLEMENTATION.md` §3) — not new scope introduced
  by this plan.

## 5. Manager/team mapping

- Every manager/team The Replacements identifies needs a **stable, unique id** on their side (their
  "team id" or "manager id" — whichever is stable across a season; if both exist, prefer whichever
  one is stable across trades/roster reassignment).
- That id becomes the `source_id` of an `ExternalIdentityMapping { source_provider: 'the_replacements',
  source_id, entity_type: 'manager' }`. If a corresponding AllFantasy account is later linked,
  `af_id` gets populated; until then, a derived `stable_key` (mirroring the existing convention —
  e.g. `${provider}:${source_id}`) is used, and the manager is attributed exactly like an
  external-only Sleeper manager today — no AllFantasy account required for their activity to power
  Mission Control.
- **No new identity system is proposed.** This reuses `ExternalIdentityMapper`/`ExternalIdentityMapping`
  exactly as they exist today.

## 6. Roster mapping

- **Not required for the minimum viable Commissioner OS data contract (§0, §2).** Roster
  composition only matters if The Replacements wants a fuller `ILeagueImportAdapter`-style import
  (out of scope here — see §0). Commissioner OS's Mission Control, League Health, trend, and
  retention-risk signals are all derived from *activity* (trades/waivers/roster moves/drafts), not
  from current roster snapshots.
- If a `roster_move` activity type is emitted (a manager adding/dropping a player outside a waiver
  process), only the participating `managerSourceIds` are required — not full roster contents.

## 7. Transaction mapping

- A generic "transaction" concept, if The Replacements has one, should be split by the adapter into
  the three specific `activityType`s Decision OS understands (`trade`, `waiver`, `roster_move`) —
  mirroring exactly how `sleeperActivityEmitter.ts`'s `TRANSACTION_TYPE_MAP` splits Sleeper's
  `type: 'trade'|'waiver'|'free_agent'` into the same three buckets. Any transaction type The
  Replacements has that doesn't map cleanly to one of these three should be **skipped with a
  reason**, not force-mapped.
- **Only "completed"/final transactions should ever be emitted.** Pending, proposed, vetoed, or
  cancelled transactions must never be treated as having happened — mirrors the existing
  `TRANSACTION_NOT_COMPLETE` skip rule exactly.

## 8. Waiver mapping

- `activityType: 'waiver'`. Requires: which manager was awarded the claim (`managerSourceIds`), a
  stable event id (`providerEventId`), and a real timestamp for when the claim was **processed/
  resolved** (not when it was submitted, unless The Replacements only exposes submission time — in
  which case that is what gets used, honestly, and should be documented as such rather than implied
  to be a resolution time).
- FAAB/priority/claim details (if The Replacements has them) can be carried in `payload` for
  reference — not required for the behavioral pipeline's own counts (which only need the fact that
  a waiver claim occurred, by whom, and when).

## 9. Trade mapping

- `activityType: 'trade'`. Requires: **every manager involved** in `managerSourceIds` (a trade
  between two teams needs both, so both get attributed — matching the existing pipeline's
  `trade_created`/`trade_accepted` dual-attribution for a 2-manager trade, so league trade counts
  are not double- or under-counted).
- A stable event id and the trade's **finalized/accepted** timestamp (not the proposal timestamp,
  unless that's genuinely the only timestamp The Replacements exposes — again, document the
  distinction rather than assume).

## 10. Draft mapping

- `activityType: 'draft_pick'`. Requires: a way to key a pick uniquely **across drafts and
  seasons** — mirrors the existing `MISSING_DRAFT_CONTEXT` rule (`pick_no` alone is not sufficient;
  needs a draft id or season to disambiguate).
- **A real per-pick timestamp is often unavailable from providers** (Sleeper doesn't expose one
  either) — if The Replacements can't provide one, the existing pattern is to supply a single
  known-real timestamp for the whole draft (e.g. the draft's start time) rather than inventing a
  per-pick time, exactly as `emitSleeperDraftPickActivity` does today. If no real timestamp exists
  at all, the pick is honestly skipped (`MISSING_OCCURRED_AT`), not silently timestamped as "now."

## 11. Timestamp requirements

- Every activity item needs a **real, parseable ISO-8601 timestamp** representing when the event
  actually occurred (or, for drafts, when the draft/pick genuinely happened per §10's caveat).
- Timestamps drive: idempotency-adjacent ordering, snapshot/trend period bucketing (daily, UTC
  calendar day — see `derivePeriodKey` in `lib/decision-os/snapshot/behavioralSnapshotCapture.ts`),
  and the "is activity trending up or down" signal itself. **A fabricated or "now"-substituted
  timestamp would corrupt trend data silently** — this is exactly why the existing pipeline refuses
  to guess and skips instead.

## 12. Scoring/settings metadata requirements

- **Not required for Mission Control, League Health's Decision-OS-derived fields, trend, retention
  risk, or recommended actions** — none of those read scoring/settings metadata (they're all
  activity-derived).
- **Only relevant for the small number of `LeagueHealthInput` fields that stay at their schema
  default** unless supplied explicitly (`numTeams`, `waiverType`, `tradeReviewProcess`,
  `leagueType`, `playoffTeams`, etc. — see `fieldProvenance` in
  `lib/decision-os/leagueHealthAlignment.ts`, which labels exactly these as `'schema_default'` today
  even for AllFantasy-native leagues that haven't supplied overrides). If The Replacements wants
  these fields to read real values instead of defaults, they'd need to supply basic league settings
  (team count, waiver type, playoff format) as `overrides` to the existing
  `resolveDecisionOsLeagueHealth(leagueId, overrides)` call — a contract that already exists and
  needs no new code.

## 13. Auth/security expectations

- **Not designed yet — this section states requirements, not a design.** Whatever mechanism is used
  to call The Replacements' API (or receive their export/webhook), it must:
  - Never expose The Replacements' credentials/tokens to client-side code.
  - Be stored using this repo's existing secrets convention (environment variables, not
    hardcoded) — mirroring how `CRON_SECRET` and other provider credentials are already handled.
  - Be scoped to read-only access to activity data — the adapter never needs write access to The
    Replacements' platform.
- The Decision OS-facing side already has an auth precedent to mirror: the snapshot-capture cron
  (`app/api/cron/decision-os-snapshot-capture/route.ts`) uses `Authorization: Bearer ${CRON_SECRET}`.
  A future "trigger a Replacements sync" job/route would follow the same pattern, not invent a new
  one.

## 14. Tenant/client isolation requirements

- **Not designed yet.** Today, `DecisionOsImportedActivity` has no concept of "which licensee does
  this row belong to" — it is scoped by `provider` + `providerLeagueId` only. For a single pilot
  partner (The Replacements) reading only their own leagues, this is sufficient as-is.
- **Before onboarding a second external licensee** (or before The Replacements' own leagues need to
  be isolated from any other tenant's), a real tenant/client boundary would need to be designed —
  this is explicitly flagged as unbuilt in the demo package (§11 item 6 of
  `THE_REPLACEMENTS_COMMISSIONER_OS_DEMO_PACKAGE.md`) and is not solved by this plan.

## 15. Sync/backfill strategy

- Mirrors the existing Sleeper pattern: `ingestSleeperImportedActivity` is a single entry point that
  takes a batch of provider-shaped payloads and idempotently syncs them. A `the_replacements`
  equivalent (`ingestTheReplacementsImportedActivity`, structurally identical) would do the same.
- **Historical backfill** (bringing in a league's full trade/waiver/draft history at onboarding
  time) reuses the exact same idempotent-by-`providerEventId` mechanism — running the same backfill
  twice converges, never duplicates (proven for Sleeper in
  `__tests__/decision-os/sleeper-imported-activity-emitter.test.ts`).
- **Not designed yet:** how often/on what trigger a backfill or incremental sync actually runs
  against The Replacements' real API. That depends entirely on what their API supports (polling?
  webhooks? a bulk export?) — unknown until we have their contract (see §17 questions).

## 16. Live update strategy

- **Not designed yet**, for the same reason as §15 — depends on what The Replacements' platform can
  push or expose. Two plausible shapes, neither committed:
  - **Polling:** a scheduled job (mirroring the existing, already-built-but-unregistered
    `/api/cron/decision-os-snapshot-capture` pattern) periodically calls a `the_replacements` sync
    entry point for pilot leagues.
  - **Webhook-driven:** The Replacements pushes events to a new AllFantasy-side endpoint, which
    converts them to `RawImportedActivity` and calls the same normalizer/writer/store pipeline
    on receipt.
- Either shape reuses the same downstream pipeline unchanged — the choice only affects how activity
  *arrives*, not how it's processed once it does.

## 17. Error handling and honest degradation

The adapter must inherit — not weaken — the three independent honest-degradation layers this
pipeline already enforces (mirroring `sleeperActivityEmitter.ts`'s own documented discipline):

1. **Adapter/emitter layer:** skip (with a reason) any activity shape it cannot safely interpret —
   an unrecognized transaction type, a non-final/pending transaction, a draft pick with no safe
   context to key it. Never guess a category, a status, or an id.
2. **Normalizer layer (unchanged):** skip (with a reason —
   `MISSING_PROVIDER_EVENT_ID`/`MISSING_OCCURRED_AT`/`NO_ATTRIBUTABLE_MANAGER`) anything missing a
   real id, a real timestamp, or an attributable manager.
3. **Writer/store layer (unchanged):** skip (with a reason) anything a concrete store cannot
   represent.

At every layer, a skip is **surfaced and countable** (`WriteImportedActivitySummary.skippedReasons`),
never silently dropped and never papered over with a fabricated value. Commissioner OS surfaces
(Mission Control, League Health) already degrade honestly on top of this (`no_snapshots`,
`insufficient_history`, all-zero counts, explicit "unavailable" states) — a Replacements adapter
that skips a lot of activity at onboarding just means those surfaces show smaller, honest numbers,
not broken ones.

## 18. Pilot validation checklist

Before any real Replacements data reaches a shared/staging environment, mirroring exactly how the
Sleeper emitter was proven (non-prod Neon project, realistic fixtures, before any production path
existed):

- [ ] Adapter emits `RawImportedActivity` correctly for a realistic sample of The Replacements'
      actual API/export shapes (trade, waiver, roster move, draft pick).
- [ ] A trade with 2+ managers produces correct dual attribution (both managers show the trade in
      their activity; league trade count is not double- or under-counted).
- [ ] An external-only manager (no AllFantasy account) is correctly attributed via `stable_key` and
      shows up in Mission Control's `managerCounts`/`activity` correctly.
- [ ] Re-running the same backfill batch twice converges (no duplicate rows) — verified against a
      throwaway non-prod database, the same technique used for Sleeper (`cool-lab-87438174`).
- [ ] Activity with a missing/invalid timestamp, missing event id, or unattributable manager is
      honestly skipped, not fabricated, and the skip is visible in the write summary.
- [ ] A pilot league with genuinely zero activity yields an honest zero/`no_events` snapshot, not an
      error.
- [ ] After 2+ real days of captured snapshots, `leagueTrend` and League Health's `decisionOs.trend`
      report a real `available: true` trend (not `no_snapshots`/`insufficient_history`) for at least
      one pilot league.
- [ ] Mission Control renders correctly for a real pilot league end-to-end (health status, counts,
      trend, retention risk, recommended actions) — reusing the existing card, no new UI work
      required if the data contract above holds.

---

## 19. Minimum Data Required For Commissioner OS Demo

The smallest viable dataset that powers everything Mission Control, League Health, activity trend,
retention-risk managers, and recommended commissioner actions currently show:

- **Trades:** who was involved, when finalized, a stable event id.
- **Waiver claims:** who was awarded, when processed, a stable event id.
- **Roster moves** (adds/drops outside a waiver process, if The Replacements has this concept):
  who acted, when, a stable event id.
- **Draft picks:** who picked, in which draft/season (for keying), and one real timestamp for the
  draft as a whole if per-pick timestamps aren't available.
- **A stable manager/team id** per participant in every item above (no AllFantasy account
  required).
- **A stable league id.**

That is genuinely everything. No roster contents, no scoring rules, no matchup/schedule data, no
chat logs, and no subscription/billing data are required for the demo's core signals — those all
derive purely from the activity stream above, exactly as they do for AllFantasy-native leagues today.

---

## 20. Data Nice-To-Haves

Not required for the current demo, but would each unlock or improve a specific future signal:

- **Historical seasons** — would let trend/retention-risk signals start with real history from day
  one at pilot onboarding, instead of needing 2+ days of live snapshot accumulation first.
- **Chat/activity signals** (league chat message volume, reactions, etc.) — `LeagueHealthInput` has
  a `chatMessageCount` field that stays at schema default today for every league, native or
  imported; a real feed here would improve League Health's engagement scoring specifically.
- **Commissioner actions** (settings changes, dispute resolutions, manual roster edits) — would feed
  `commissionerActionsThisSeason`/`commissionerActionCount`, currently only populated from
  AF-native/redraft commissioner-action events.
- **Invite/renewal signals** (a manager declining to renew, a league failing to fill) — this is
  exactly the kind of signal a real **retention-risk feature** (as opposed to the current
  behavioral-inactivity-only proxy) would need; flagged as an open Decision OS feature gap in
  `COMMISSIONER_OS_SURFACE_ALIGNMENT.md` §7 item 7.
- **Subscription/league-creation metrics** — would be needed for any future platform-level
  (cross-league) benchmarking or a League-Analytics-style surface, neither of which exists yet.
- **Support tickets or churn markers** — the closest thing to a real, external retention-outcome
  signal; would be the only honest way to eventually validate whether Commissioner OS's
  retention-risk flags actually correlate with real churn. **No such validation exists today, and
  none should be implied until this data exists and is analyzed.**

---

## 21. Adapter Architecture

```
The Replacements API / export / webhook   (unknown shape — no contract yet)
  ↓
NEW: the_replacements activity emitter        (lib/decision-os/ingestion/theReplacementsActivityEmitter.ts — NOT BUILT)
  - parses The Replacements' raw shapes
  - resolves manager identity via ExternalIdentityMapper (existing, unchanged)
  - emits RawImportedActivity[]
  ↓
EXISTING, UNCHANGED: importedActivityNormalizer.ts
  - deterministic natural-key idempotency (deriveActivityNaturalKey)
  - honest skip-with-reason for anything unkeyable/unattributable
  ↓
EXISTING, UNCHANGED: importedActivityWriter.ts + ImportedActivityStore / PrismaImportedActivityStore
  - idempotent upsert by naturalKey
  - honest per-record skip reporting
  ↓
EXISTING, UNCHANGED: DecisionOsImportedActivity (Prisma model)
  - provider-neutral row storage, no AF-native FK coupling, no AppUser fabrication
  ↓
EXISTING, UNCHANGED: importedActivityToEvents.ts → BehavioralEvent[]
  ↓
EXISTING, UNCHANGED: behavioral facts (assembleLeagueBehavioralFacts / assembleManagerBehavioralFacts)
  ↓
EXISTING, UNCHANGED: snapshot capture + trend (behavioralSnapshotCapture.ts / behavioralTrend.ts)
  ↓
EXISTING, UNCHANGED: League Health federation (leagueHealthAlignment.ts) + Mission Control (missionControl.ts)
  ↓
EXISTING, UNCHANGED: MissionControlCard on the Commissioner Hub dashboard
```

Everything below the first box already exists, is tested, and requires zero changes to onboard a
new provider — this is the same claim the demo package makes, now spelled out at the file/module
level.

---

## 22. What We Cannot Build Until They Provide Data

- **The real adapter implementation.** Without The Replacements' actual API/export shapes, only a
  plan (this document) is possible — any code written against a guessed shape would need to be
  rewritten once the real contract is known, which is why no adapter code was written this
  increment.
- **Real retention-lift measurement.** Even once a pilot is live, measuring whether Commissioner OS
  changes retention requires a real baseline and a real observation window on The Replacements'
  side — not something this plan or any engineering work alone can produce.
- **Production tenant mapping.** Requires knowing whether The Replacements is the only external
  licensee being onboarded, or one of several — a business/product decision, not an engineering one.
- **Production scheduler configuration.** The snapshot-capture cadence for real Replacements leagues
  depends on how "live" they need trend data to feel and on their own API's rate limits — both
  unknown until we're talking to their engineering team.
- **Production auth integration.** Depends entirely on what auth mechanism The Replacements' API
  actually offers (API key, OAuth, signed webhooks, etc.) — cannot be designed in the abstract.

---

## 23. Questions To Ask The Replacements

Concrete, and meant to be asked on the next call:

1. **Do you have a documented API, or would this be a data export/webhook integration?** (Determines
   §15/§16's sync strategy entirely.)
2. **What's your auth model for third-party API access** — API key, OAuth2, signed webhooks,
   something else?
3. **Do you expose stable, permanent ids for leagues, teams/managers, and individual transactions**
   (trades/waivers/picks)? Are any of those ids ever reused or recycled?
4. **Do transactions carry a real timestamp**, and if so, is it a submission time, a
   finalized/processed time, or both?
5. **How do you distinguish a pending/proposed transaction from a finalized one** (status field,
   separate endpoints, something else)?
6. **Do your drafts have a stable draft id**, and is there any per-pick timestamp, or only a
   whole-draft start time (or none at all)?
7. **Can a manager/team exist on your platform without a linked AllFantasy account** — i.e., do you
   expect us to ever need to resolve identity to an existing AF user, or are all pilot participants
   external-only?
8. **What historical depth can you provide at onboarding** — a full season, multiple seasons, or
   only forward-looking activity from the integration's start date?
9. **What's your expected data volume and rate limits** — number of leagues, managers per league,
   and roughly how many transactions/week, so a sync/backfill cadence can be sized appropriately?
10. **Do you have (or want) chat activity, commissioner-action logs, invite/renewal events, or churn
    signals** — none are required for the current demo, but knowing what exists shapes what's worth
    prioritizing next (§20).
11. **Which specific leagues would be in a pilot**, and for how long, before any broader
    conversation about scaling to more of your platform?
12. **Who owns data-sharing/privacy sign-off on your side**, and what would that agreement need to
    cover (§9's pilot plan step 1)?

---

## 24. What remains before adapter implementation

In order of what blocks implementation the earliest:

1. **A real data-sharing conversation with The Replacements** answering §23's questions — nothing in
   §15/§16/§13 (sync strategy, live-update strategy, auth) can be designed further without this.
2. **Confirmation that `IMPORT_PROVIDERS` gets a `'the_replacements'` entry** — a one-line, low-risk
   change, deliberately not made this increment per explicit instruction.
3. **A real or realistically-shaped sample of The Replacements' actual data** to write the emitter
   against (mirroring how the Sleeper emitter was built and tested against real Sleeper API shapes,
   not guesses).
4. **A non-prod database to run the pilot validation checklist (§18) against** — the same throwaway-
   Neon-project technique already used for Sleeper, reusable here.
5. **A tenant/isolation decision (§14)** if The Replacements will not be the only external licensee.

---

## 25. Boundaries honored (this increment)

- No adapter code written. No `RawImportedActivity` emitter for The Replacements exists.
- `IMPORT_PROVIDERS` NOT modified — `'the_replacements'` was not added.
- No League Analytics, DFS OS, or User OS work.
- No fake/demo data introduced anywhere in this document or the codebase.
- No production DB touched; no production cron enabled.
- PR #183 untouched, still draft, not merged.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- No retention-lift or ROI numbers claimed anywhere in this document.
