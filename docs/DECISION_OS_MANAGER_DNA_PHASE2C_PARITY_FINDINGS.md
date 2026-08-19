# Manager DNA De-duplication — Phase 2C Prerequisite Findings

**Status:** Prerequisite work only. No AI consumer (AI Coach, Trade Analyzer, Trade Proposal Generator) migrated. No live routes touched. No changes to `lib/manager-dna.ts` or to `ManagerDnaProfile`'s existing shape.
**Branch:** `g15-event-foundation`
**Follows:** `docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md` §6–§8, Phase 2B commit `f1581dcd8`

## What was built

1. **`lib/decision-os/phase6/dna/formatForPrompt.ts`** — `formatManagerDnaForPrompt(profile: ManagerDnaProfile): string`, the missing LLM-prompt-text equivalent of legacy `formatDNAForPrompt()` identified as the audit's biggest gap (§6). Purely additive — no existing Phase 6 DNA file was modified, no output shape changed.
2. **`__tests__/decision-os/phase6/manager-dna-prompt-format.test.ts`** — 11 tests: empty-string silence for `'unknown'` identity, stability/determinism, title-casing, confidence/completeness rendering, traits rendering (present and absent), warnings rendering (present and absent), a check that the internal `derivation` audit trail never leaks into prompt text, and a frozen-text regression snapshot.
3. **`__tests__/decision-os/phase6/manager-dna-legacy-parity-harness.test.ts`** — a runnable comparison harness driving legacy `computeManagerDNA()` (real function, Prisma + Sleeper API mocked at the module boundary, zero network/DB access) and canonical `assembleManagerDna()` (real function) against three synthetic scenarios, documented below.

## Why the harness can't do a literal side-by-side "same input" comparison

This was flagged as the central risk in the original audit and is confirmed, not resolved, by this work: **legacy and canonical have no shared input format.** Legacy computes `DNAMetrics` (10 numeric 0–1 dials) directly from raw Sleeper trade/waiver records. Canonical computes categorical dimensions from Decision OS's `ManagerPatternGroupInput`/`ManagerSignalInput` (detected behavioral-event patterns + aggregate engagement signals). There is no lossless translation between them — the harness instead constructs *thematically equivalent* synthetic scenarios in both input languages and compares what each engine independently concludes.

## Findings from the three synthetic scenarios

| Scenario | Legacy output | Canonical output | Gap / alignment |
|---|---|---|---|
| **Aggressive risk-taking trader** (high trade volatility, buy-low pattern, active engagement) | `archetype: 'The Gambler'`, `confidence: 0.36` | `primaryIdentity: 'serial_trader'`, `riskTendency: 'risk_taking'`, `confidence: 0.75` | **No shared vocabulary.** Thematically related (both flag a high-risk trader) but the labels don't map — "The Gambler" has no canonical equivalent string, and nothing in either engine declares them equivalent. Any future shim that needs to preserve legacy label text would have to hand-author this mapping, not derive it. |
| **Waiver-heavy, low trade activity** | `archetype: 'The Waiver Hawk'` | `primaryIdentity: 'waiver_hawk'` | **The one case where the literal English words match.** This is very likely coincidence — both teams independently reached for the same natural label for the same obvious behavior — not evidence of a systematic mapping for the other 7 legacy / 8 canonical labels. |
| **Near-zero activity (no trades, no waiver claims)** | `archetype: 'The Architect'`, `confidence: 0` (found empirically — see below) | `profiles: []` (no manager entry at all, since no patterns/signals were supplied) | **Real, previously-undocumented gap.** Legacy's zero-signal defaults (`patience` defaults to 0.82 when trade count is 0; `riskTolerance` defaults to 0 when no trades are analyzable) happen to satisfy "The Architect"'s check (`patience >= 0.65 && riskTolerance <= 0.45 && pickHoarding >= 0.5`) — **not** the true "nothing matched" fallback (`'The Balanced GM'`, which only fires when every archetype check fails). A manager with literally no history gets a specific, confident-sounding archetype label. The only honest signal is a separately-computed `confidence` of exactly `0` here — a caller has to know to check it independently of the label; legacy's own `formatDNAForPrompt()` does this (goes silent below 0.15), but nothing enforces it elsewhere. Canonical has no equivalent failure mode: with nothing supplied, there's no profile to mislabel, and with a manager present but under `MIN_COMPLETENESS` (20), Phase 6 emits the literal string `'unknown'` rather than a real archetype name. |

## What this harness proves and what it does not

**Proves:** both engines are independently invocable, deterministic, and produce internally-consistent output for hand-constructed scenarios. The three-way comparison surfaced one genuine, previously-undocumented correctness gap in legacy (the zero-signal-defaults-to-a-named-archetype behavior above) that is worth knowing about regardless of any migration decision.

**Does not prove:** that Decision OS's real behavioral-event pipeline, for real leagues in production today, has equivalent historical depth to what legacy computes directly from live Sleeper trade history. That was the audit's stated central risk (§7 step 2, "Risks to watch"), and it is a **data completeness question**, not a code-correctness question — it requires running both engines against real league data (not synthetic fixtures) and measuring, for a representative sample of active leagues, how often canonical produces `'unknown'` where legacy would have produced a real (if sometimes over-confident, per the finding above) archetype. This harness does not attempt that, and nothing in this phase touches real production data.

## Is Phase 2D (migrating one AI consumer) safe to start?

**Not yet — one prerequisite remains unaddressed, and it's the one that matters most.**

- The formatter (prerequisite #1) is done, tested, and ready to be consumed.
- The parity harness (prerequisite #2) exists and runs, and has already found one legacy correctness gap worth fixing or at least flagging to whoever eventually owns that migration decision.
- **What's still missing:** real-data evidence that canonical's behavioral-event pipeline reaches enough leagues/managers with enough history to not regress the AI Coach / Trade Analyzer / Trade Proposal Generator experience by suddenly going silent (`formatManagerDnaForPrompt` returns `''` for `'unknown'`) for users who currently get a (possibly over-confident, see finding above) legacy profile. Recommend running the synthetic-harness pattern established here against a sample of real leagues' actual behavioral-event data before choosing a first consumer to migrate in Phase 2D — that's a data-availability check, not more code, and should be quick relative to the actual migration.

Given that, **Phase 2D should start with the real-data completeness check above, not with migrating a consumer.** If that check comes back healthy (canonical reaches a similar or better fraction of managers with a non-`'unknown'` profile compared to legacy's non-default-fallback rate), AI Coach is the safest of the three consumers to migrate first — it already tolerates missing personalization gracefully (unlike Trade Analyzer/Trade Proposal Generator, which more directly shape a monetary-feeling recommendation), so a silent formatter for `'unknown'` managers degrades gracefully there first.

## Files changed in this phase

- `lib/decision-os/phase6/dna/formatForPrompt.ts` (new)
- `__tests__/decision-os/phase6/manager-dna-prompt-format.test.ts` (new)
- `__tests__/decision-os/phase6/manager-dna-legacy-parity-harness.test.ts` (new)
- `docs/DECISION_OS_MANAGER_DNA_PHASE2C_PARITY_FINDINGS.md` (this document, new)

No existing file was modified. `lib/manager-dna.ts` was read-only throughout — the harness calls its real, unmodified `computeManagerDNA()` export with `@/lib/prisma` and `@/lib/sleeper-client` mocked at the module boundary.
