# Commissioner OS — Phase C0.5 + C5 foundation handoff

**Date:** 2026-09-10
**Scope:** canonical Commissioner league profile (C0.5) + versioned template runtime foundation (C5).
**Status:** foundation landed. Two non-executing proof templates. No schema migration. No UI.

Read this before continuing Commissioner OS work. It records what already existed, what was
deliberately *not* built, and the three or four decisions that are load-bearing and easy to undo by
accident.

---

## 1. The audit, and the part that changed the plan

The brief proposed building a `CommissionerLeagueProfile` resolver with "exact precedence rules,
alias-preserving logic". **Most of that already exists and is better than a fresh implementation
would be.**

| Question | Existing authority | Verdict |
|---|---|---|
| What format IS this league? | `lib/trade-intel/leagueFormatRules.ts` → `readFormatRules` | **Canonical. Do not duplicate.** |
| Concept + modifiers + alias tags + pricing base, with provenance | `lib/league-rules/resolveLeagueRules.ts` | **Canonical. Composed, not re-derived.** |
| Where are alias tags stored? | `lib/league-contract/conceptAliasTags.ts` | Canonical single reader. |
| Public concept → format id + alias | `lib/league-creation/canonical/normalizeConcept.ts` | Canonical writer-side. |
| Documented rules per concept (phases, actions, elimination) | `lib/league-rules/conceptCatalog.ts` | Canonical index. **Not an engine.** |
| Can AllFantasy write here? | `lib/league/write-authority.ts` (`NATIVE`/`SHADOW`/`CONNECTED`) | **Canonical. Reused instead of a new enum.** |
| Commissioner / co-commissioner / member / viewer | `lib/league/permissions.ts` → `LeagueRole` | Canonical (but imports prisma — see §4). |
| One-concept automation dispatch | `lib/specialty-automation/` | **Untouched. Still canonical.** |

Three findings that materially changed the design:

1. **`resolveLeagueRules` is already pure, already alias-preserving, and already separates
   `concept` from `pricingBaseFormat`.** It carries the measured lesson that `aliasTags` is
   overloaded: 183 of 271 production leagues carry `['idp']`, and reading the first alias as a
   format demoted 97 dynasty leagues to redraft. Writing a second classifier would have rebuilt that
   bug under a new name. **The profile calls it and carries its whole output on `profile.rules`.**

2. **`lib/league-rules/conceptCatalog.ts` already contains a `survivor_guillotine` entry** — the
   Survivor All-Stars Guillotine concept, catalog-only (`formatRulesConcept: null`), with the
   published phases. And **`lib/trade-intel/survivorGuillotine.ts` already holds `LINEUP_SCHEDULE`,
   `SUPERFLEX_WEEK`, `STANDARD_IDOL_LAST_WEEK`, `GAUNTLET_IDOL_LAST_WEEK`.** The template fixture
   *imports* those rather than restating them, so there is one truth source for the dated schedule.

3. **`lib/league-templates/` already exists and is a different thing.** It is a creation-wizard
   prefill payload (`LeagueTemplatePayload` — clone an existing league's settings). No phases, no
   capabilities, no versioning, no runtime. The name collision is real. The new work lives under
   `lib/commissioner-os/template/` so the distinction is visible in every import path.

**No STOP condition was hit.** Nothing existing solves the multi-capability / versioned-template
problem; `resolveSpecialtyConceptKey` returns exactly one concept, which is the limitation the whole
phase exists to remove.

### 1a. There is already a Commissioner OS *observation* stack. It is a different half.

Found during the audit and worth knowing before the next phase, because it is where this profile
eventually plugs in:

- `lib/shared-services/commissioner/` — `CommissionerContextAssembler`, `LeagueHealthService`,
  `CommissionerAttentionService`, `CommissionerRankingService`, `CommissionerBriefService`,
  `CommissionerShadowService`. Built shadow-mode in the Fantasy OS Migration Plan, Phase 10.
- `lib/shared-services/league-hub/commissionerOsContext.ts` — the assembler that gave that package
  its first real consumer. It reads already-persisted output of `lib/drama-engine/`,
  `lib/rivalry-engine/` and `lib/rankings-engine/draft-grades.ts` and never recomputes them.
- `app/commissioner-os/` — the UI surface. Untouched here, per the brief.

That stack answers **Observe**. This phase answers **what league is this, and what may we do to it**.
They are complementary, not competing, and nothing in this phase modifies any of it.

⚠ **One thing to carry forward about role resolution.**
`lib/shared-services/commissioner/CommissionerAuthorization.ts` documents a real gap in its own
docstring: `resolveCommissionerAccess` wraps `getLeagueRole()`, which for imported leagues reflects
*who imported the league*, not verified commissioner status. `commissionerOsContext.ts` deliberately
uses `resolveActiveLeagueContext`'s `isCommissioner` instead, which trusts a recorded
`commissionerVerification` attestation for MFL/ESPN/Yahoo. **`CommissionerLeagueProfile.commissionerRole`
is an input — whoever wires a request path should feed it the attestation-aware answer, not a naive
`getLeagueRole` call.** See also memory note `three-session-gates-login-redirect-trap`.

---

## 2. Files added

Nothing was modified. Every file below is new.

```
lib/commissioner-os/
  index.ts                                  barrel
  capabilities.ts                           CommissionerCapabilityId + composition (the additive layer)
  authority.ts                              WriteAuthority × effect scope → canExecute/canPrepare/canVerify
  ruleEffects.ts                            14-effect vocabulary, mapped onto existing ActionTypes
  profile/
    types.ts                                CommissionerLeagueProfile
    resolveCommissionerLeagueProfile.ts     the pure builder
    templatePin.ts                          the ONE reader for the settings pin
  template/
    types.ts                                LeagueTemplateDefinition + validator
    registry.ts                             exact-pin resolution, no "latest" fallback
    planTemplateActions.ts                  the deterministic planner
    definitions/
      eflPromotionRelegationDynasty.ts      proof fixture, executionEnabled: false
      survivorAllStarsGuillotine.ts         proof fixture, executionEnabled: false

__tests__/commissioner-os/
  leagueProfile.test.ts
  templateContract.test.ts
  templateRuntime.test.ts

docs/commissioner-os/PHASE_C0.5_C5_HANDOFF.md   (this file)
```

---

## 3. Schema migration: **not necessary, and deliberately not taken**

`League.settings` is `Json?` with `settingsSnapshotVersion Int?` already versioning it, and
`ConceptRulesSlice.extensions` is the documented extension point that `readConceptAliasTags` already
uses. The template pin lives at:

```
settings.conceptRules.extensions.commissionerTemplate = { id, version }
```

read by exactly one module (`profile/templatePin.ts`), following the `conceptAliasTags.ts`
precedent. `validateConceptRulesShape` in the specialty pipeline already guards that object's shape.

A dedicated column would be a migration — a separate deploy decision belonging to the user, not
something to take on a foundation phase's say-so — for a field nothing writes yet.

---

## 4. Architecture decisions worth defending

### 4.1 The profile composes; it never re-derives

`resolveCommissionerLeagueProfile` makes **one** call to `resolveLeagueRules` and every format fact
comes out of it. `profile.rules` carries the whole resolution so callers can reach the provenance —
`rules.keeper.maxKeepers.provenance === 'schema_default'` means the row carries Prisma's
`@default(3)` and *nobody is known to have chosen it*.

### 4.2 Unknown format degrades. It does not become redraft.

`toFormatId` in `lib/league/format-engine.ts` returns `'redraft'` for anything unrecognised and is
right to, for a create form that has to offer something. In Commissioner OS that default switches
off every specialty behaviour a league has and reports itself healthy. So the profile does its own
**strict** lookup and returns `canonicalFormatId: null`, `formatBasis: 'unresolved'`,
`resolution: 'degraded'`.

### 4.3 Format precedence (and why the order matters)

1. `concept.flattenedOnto` → `formatBasis: 'flattened_base'` (KOTH→redraft, Royal/Pirate→dynasty)
2. `concept.id` when it is a `LeagueFormatId` → `'concept_id'`
3. `pricingBaseFormat` when it is a `LeagueFormatId` → `'pricing_base'`
4. the **pinned template's** `baseFormatId` → `'template_base'`
5. `null` → `'unresolved'` + degraded

`conceptId` is reported separately and never overwritten, so the profile says *"King of the Hill, on
a redraft shell"* rather than picking one and erasing the other.

**Step 4 is last on purpose.** A pin is the least-verified input; a league mis-pinned to the wrong
template must not report the wrong format with full confidence. It exists for the genuinely
unclassifiable case — `survivor_guillotine` is a catalog-only concept whose id is not a
`LeagueFormatId` and whose classifier answer is `other`.

### 4.4 Capabilities are a SET — this is the whole point of C0.5

`composeCapabilities` unions four independent sources: format, catalog concept, modifiers, template.
A template can only **add**; it can never subtract, because a template that could remove
`elimination.guillotine` from a guillotine league would be describing a different league than the
one the classifier found.

`profile.legacySpecialtyConceptKey` carries `resolveSpecialtyConceptKey`'s answer **verbatim** —
computed from the same row, not derived from capabilities. `dispatchConceptHandler` is untouched.
A regression test asserts the carried value equals a direct call for eleven league shapes.

### 4.5 Authority reuses `WriteAuthority` — a deliberate deviation from the brief

The brief proposed `native_write | connected_write | read_only | manual_unknown`.
`lib/league/write-authority.ts` already owns this question and is already what every mutation route
returns to the client. The four map onto three without loss, and `manual_unknown` is already handled:
`resolveWriteAuthority` **fails safe to SHADOW** for an unrecognised or empty platform.

**Authority is per-ACTION, not per-league.** An effect declares an `EffectScope`:

- `internal` — AllFantasy owns it outright (phases, tribes, tiers, commissioner tasks, draft slots).
  Sleeper has never heard of a tribe. AF executes these for real even on a shadow league.
- `external` — the host platform is the system of record when imported (roster slots, bench size,
  FAAB, actual roster releases).

| scope | NATIVE | CONNECTED | SHADOW |
|---|---|---|---|
| internal | execute / prepare / verify | execute / prepare / verify | **execute** / prepare / verify |
| external | execute / prepare / verify | execute / prepare / verify | **no execute**, prepare per-effect, verify per-effect |

`canVerify` is **not** "we will notice eventually" — it is true only when a later import can
establish the effect landed, declared per effect as `verifiableFromImport`.

**Being commissioner confers no external write access.** Role gates whether a human may *ask*;
platform decides whether AF can *carry it out*.

### 4.6 Versioning: exact pin or nothing

`resolveTemplate(id, version)` resolves the exact pair or returns `null`. **There is no "latest"
fallback anywhere**, not even when only one version exists. A silent upgrade would change the rules
of a running season with no conflict, no error, no failing test and nothing for a commissioner to
notice. `latestVersionOf` exists for **new leagues only**.

A rules change means a **new version entry**, never an edit to a published one. The test suite pins
each published version's capability list so editing `1.0.0` in place fails loudly.

### 4.7 Idempotency

```
commissioner-os:<leagueId>:<season>:<templateId>@<version>:<effectId>:<occurrence>
```

Every part is load-bearing. Dropping the **version** would let a rules change re-fire an effect that
already ran. Dropping the **occurrence** would collapse the Gauntlet's three weekly double
eliminations into one — not a duplicate-suppression win, six teams that never leave.

**The key deliberately excludes the trigger**, unlike `buildIdempotencyKey` in the specialty
pipeline. There the unit is one automation *pass*; here it is "this scheduled effect, once per
season", so a manual re-run must not plan a week-11 elimination a second time under a fresh key.

### 4.8 Determinism

No clock, no randomness, no DB, no set-iteration order. Actions sort by `(week, effectId,
occurrence)` so reordering a template's `scheduledEffects` array cannot change a plan. The one place
the format genuinely needs randomness — the week 7 tribe shuffle — is planned as an action carrying
`seedRequired: true` for its executor. A planner that rolled dice would break idempotency outright.

### 4.9 Non-executing fixtures are enforced, not documented

`executionEnabled: false` on both templates. `planTemplateActions` requires **three independent
conditions** for `executable: true` — the template permits execution, the effect has a real engine
(`executorStatus === 'engine'`), and the platform grants authority. A test asserts that
`ELIMINATE_ROSTER` on a **native** league, with a genuine engine behind it, is still refused.

---

## 5. Reuse map — what stays canonical

| Behaviour | Canonical module | Commissioner OS relationship |
|---|---|---|
| Format classification | `lib/trade-intel/leagueFormatRules.ts` | called through `resolveLeagueRules` |
| Concept/modifier/provenance | `lib/league-rules/` | called; whole output carried on `profile.rules` |
| Alias tag storage | `lib/league-contract/conceptAliasTags.ts` | called through `resolveLeagueRules` |
| Guillotine elimination | `lib/guillotine/GuillotineEliminationEngine.ts` | pointed at by `ELIMINATE_ROSTER` |
| Guillotine roster release | `lib/guillotine/GuillotineRosterReleaseEngine.ts` | pointed at by `RELEASE_ROSTER` |
| Guillotine roster expansion | `lib/guillotine/rosterExpansionEngine.ts` | pointed at by `ADD_ROSTER_SLOT` (not wired to a schedule) |
| Survivor state machine | `lib/survivor/gameStateMachine.ts` | pointed at; **not rewritten** |
| Survivor All-Stars schedule | `lib/trade-intel/survivorGuillotine.ts` | **imported** — one truth source for weeks |
| Promotion / relegation | `lib/promotion-relegation/` | pointed at by `PROMOTE_TEAM`/`RELEGATE_TEAM` |
| Tournament advancement | `lib/tournament/` | reachable via `advancement.tournament` capability |
| Big Brother phase machine | `lib/big-brother/BigBrotherPhaseStateMachine.ts` | reference architecture; untouched |
| Specialty automation dispatch | `lib/specialty-automation/` | **untouched**; legacy key carried verbatim |
| Write authority | `lib/league/write-authority.ts` | reused as the authority enum |
| Action type strings | `lib/specialty-automation/actionPlans.ts` | reused wherever one exists |

`ruleEffects.ts` reuses five existing `actionType` strings (`eliminate_roster`,
`release_to_waiver_pool`, `promote_team`, `relegate_team`, `commissioner_task`). That matters more
than it looks: `persistAutomationActions` persists by `actionType`, so a second vocabulary would
produce rows every existing reader silently ignores.

---

## 6. Gaps — explicitly NOT implemented

**Contract-level**

- Chimmy automation policy system (auto/notify/ask/guide/never). Only the per-template *default*
  field exists, and nothing reads it to decide behaviour.
- Natural-language execution. Chimmy is not wired to these actions at all, per the brief.
- Governance, financial obligations, conditional asset obligations. Named as `deferredModules` on
  the EFL template; no schema, no engine.
- `networkMembership` is a caller-supplied passthrough. **Nothing in this repo populates it.**
- No executor exists for 9 of the 14 rule effects (`executorStatus` says which per effect).

**EFL**

- `PromotionEngine` decides by standings zone alone. It has **no concept of a playoff-decided slot**,
  which is half of EFL's rule (bottom auto-relegates; next two play off, loser goes down).
- No Max PF freeze snapshot at regular-season completion.
- No 32-slot custom rookie order generator.

**Survivor All-Stars**

- Match Play pairing (manual today; a guided mini-snake matchup draft is wanted).
- Tribe Champion selection — consensus and in-app voting, with the no-repeat-until-everyone-has-served rule.
- Seeded random tribe shuffle; schoolyard Gauntlet draft; swap token execution.
- Gauntlet idol ownership detection from imported roster data.
- Reward FAAB grants.
- Scheduled roster-slot / bench executors — `rosterExpansionEngine` is not wired to any schedule.
- **Survivor privacy / blind mode for a participating commissioner is a known unsafe area and was
  not touched.** The repo's own audit records generic Survivor as not production-safe.

**Deliberately untouched, per the brief**

Commissioner Hub UI, Calendar, Communications Center, dues tracking, conditional trades, Decision OS
observation model, and every existing specialty handler.

---

## 7. Recommended next phase

1. **EFL template implementation.** It is the cheapest real win: the promotion/relegation engine,
   models and route already exist, and the missing pieces are two bounded modules (playoff-decided
   slots, Max PF freeze) rather than a new subsystem. It also exercises the pin → profile →
   capability → plan path end to end on a real league.
2. **Survivor runtime privacy hardening** — before anything else Survivor-shaped. A participating
   commissioner seeing blind-mode state is a correctness and trust problem, and every later Survivor
   feature inherits it.
3. **Survivor All-Stars template implementation**, on top of (2).

Do **not** start the automation policy system before (1). It has no consumer until a template can
actually execute something.

---

## 7a. Verification actually run (2026-09-10)

- **Focused suite:** `npx vitest run __tests__/commissioner-os/{leagueProfile,templateContract,templateRuntime}.test.ts`
  → **3 files, 84 tests, all passing.**
- **Positive control:** the flattened-alias branch in `resolveCanonicalFormat` was mutated to `null`
  and the suite went **red on 2 tests** (Pirate/Vampire and King of the Hill), then restored and
  verified byte-identical against a backup with `diff -q`. A green check that has never gone red is
  not evidence.
- **Validator positive controls** are permanent, in `templateContract.test.ts`: deliberately broken
  templates must produce `phase_next_missing`, `initial_phase_missing`, `no_terminal_phase`,
  `duplicate_effect_id`, `version_not_semver`.
- **Typecheck:** full repo, unpiped, sentinel `DONE=2` (exit 2 is normal — this repo carries an error
  baseline). **148 `error TS` lines**, no crash dump, no `Cannot find module`. In range of the
  documented ~145–157 baseline. **Zero in `lib/commissioner-os/`.**
- **Compile-set control:** `tsc --noEmit --listFilesOnly` confirms **all 12** new `lib/commissioner-os/`
  files are in the compile set — so "zero errors in my files" is a measurement, not an empty run.
  The same listing confirms the **3 test files are NOT in the compile set**, which is repo-wide
  behaviour (`tsconfig.json` excludes every test pattern), not something special about them.

⚠ **This typecheck was run in the shared working tree, which held several other sessions'
uncommitted work. Per this repo's own rule, that number is not a baseline for any commit.** It is
reported as a total with that caveat attached, which is information; "zero in my files" without it
would not be.

**Pre-existing failures, unrelated and not introduced here.** A broader run of the
`__tests__/commissioner-os` path showed 5 failing files / 10 failing tests. Every new file in this
phase is untracked and **no existing file was modified**, so these predate the change. Two named
examples: `eslintBoundary.test.ts` fails on four `lib/commissioner-ui/` restricted-import violations
a peer introduced in the dirty tree (that test scans `lib/commissioner-ui` and `app/commissioner-os`,
not `lib/commissioner-os`), and `commissionerOsRecommendations.test.ts` fails on a mocked context
assembler.

---

## 8. Traps for whoever picks this up

- **Do not add a "latest version" fallback to `resolveTemplate`.** It looks like a convenience and it
  is a silent rules change on a live season.
- **Do not derive `legacySpecialtyConceptKey` from capabilities.** It would change what
  `dispatchConceptHandler` dispatches — a behaviour change smuggled into a foundation change.
- **Do not import `lib/league/permissions.ts` at runtime from the pure core.** It imports prisma, and
  importing `@prisma/client` populates `process.env` from `.env`, which in this repo points at
  production. `LeagueRole` is a **type-only** import; `commissionerRole` arrives as an input.
- **Do not renumber or reuse a `ScheduledRuleEffect.id` inside a published version.** The planner
  derives idempotency from it. For `ELIMINATE_ROSTER` that means eliminating a second team.
- **Tier 1 is the HIGHEST tier.** `LeagueDivision.tierLevel` ascends downward and `PromotionEngine`
  reads `fromTierLevel` as the division being relegated *from*. Backwards relegates the champions.
- **Tests are never typechecked in this repo** (`tsconfig.json` excludes every test pattern and
  `next.config.js` sets `typescript.ignoreBuildErrors`). A wrong mock or a wrong type in a test file
  goes red only when a human runs the suite.
