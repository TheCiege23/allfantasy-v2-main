# G55 — NFL MVP Launch Blocker Remediation

## Executive summary

G55 removed the documented source-level create and Sleeper import regressions and hardened the canonical import experience without changing league architecture, databases, infrastructure, or production.

The four reported legacy create failures were test-contract drift, not four product defects. The compatibility route now delegates to canonical creation and performs a follow-up league update; its mock did not implement that update. Devy/C2C assertions also expected specialty IDs in the engine-facing `draft_type`, although the canonical contract intentionally stores `snake` or `auction` there and preserves the selected specialty ID in `requested_draft_type`.

The unified Sleeper commit regression was real: validation findings were no longer persisted as import warnings or returned as evidence. Commit now runs the existing non-blocking Sleeper validation, persists its normalized warning records with the canonical warnings, and returns validation evidence. Persistence remains behind the existing canonical commit service.

## Blockers addressed

| Blocker | Finding | Resolution |
| --- | --- | --- |
| Four `/api/league/create` failures | One stale Prisma mock plus three stale specialty-draft expectations | Restored the update mock and aligned assertions to the documented engine/requested draft split |
| Three unified Sleeper commit failures | Validation-warning evidence had been dropped from the canonical commit path | Restored validation, warning persistence, and response evidence |
| Import progress ambiguity | Preview and commit work had only button-level loading text | Added accessible stage-specific progress messaging |
| Import retry ambiguity | Preview failures had no direct retry action or persistence boundary guidance | Added safe retry and explicit no-create-before-confirmation guidance |
| Provider/sport overstatement | Provider choices did not disclose the sports certified by their source paths | Added provider sport metadata and visible MVP sport support labels |

## Files modified

G55 remediation:

- `app/api/leagues/import/commit/route.ts`
- `lib/league-import/importPersistenceService.ts`
- `components/unified-import-ui/LeagueImportFlow.tsx`
- `__tests__/league-create-defaults-api.test.ts`
- `__tests__/g55-import-ux-hardening.test.ts`
- `docs/redraft/G55_MVP_LAUNCH_BLOCKER_REMEDIATION.md`

Provider exposure work already present from the immediately preceding G54 handoff and validated here:

- `components/league-creation/ImportSourceInputPanel.tsx`
- `lib/league-import/provider-ui-config.ts`
- `__tests__/g54-mvp-import-entry.test.ts`

## Create-league improvements

- The legacy compatibility test harness now represents the canonical route's actual `league.update` dependency.
- Tests explicitly verify both halves of the specialty draft contract:
  - `draft_type`: engine-safe `snake` or `auction`.
  - `requested_draft_type`: customer-selected `devy_*` or `c2c_*` value.
- No production create behavior was changed merely to satisfy stale tests.
- All 24 create defaults integration tests pass.

## Sleeper import improvements

- Unified commit calls the existing `runSleeperImportValidation` only for Sleeper.
- Validation failure remains non-blocking, preserving the established import behavior.
- Findings are normalized through `toImportWarningRecords`.
- Canonical warnings and Sleeper validation warnings are persisted in the same import run.
- The response returns validation evidence and replay truth.
- Existing normalization, preview, commissioner gate, canonical persistence, duplicate conflict, and attestation audit paths remain intact.

## Import UX improvements

- Preview and commit expose distinct, accessible `role=status` progress messages.
- Failed previews retain the provider and source ID for an explicit retry.
- Error guidance asks customers to verify the ID and required account connection.
- The UI states that no league is created until a successful preview is confirmed.
- Canonical warnings and review reasons remain visible before commit, covering partial/ambiguous import disclosure.
- Duplicate imports retain the existing conflict panel and explicit overwrite action.
- Commissioner-only guidance remains visible on the import page.
- Raw stack traces are not rendered to customers.

## Provider exposure changes

| Provider | UI state | MVP sport label | Discovery |
| --- | --- | --- | --- |
| Sleeper | Fully exposed through canonical preview/commit | NFL | Username discovery enabled |
| ESPN | Exposed; provider connection may be required | NFL | Manual league ID |
| Yahoo | Exposed; OAuth connection may be required | NFL | Manual league ID |
| Fantrax | Exposed | NFL and NCAAF | Manual source ID |
| MFL | Exposed; API key may be required | NFL | Manual league ID |
| Fleaflicker | Exposed | NFL | Manual league ID |

No UI provider is advertised as available unless its canonical adapter path is enabled. NCAAF is advertised only for Fantrax because that is the only audited source path currently resolving NCAAF.

## Import safety

- Empty source IDs and unsupported providers are rejected before network submission.
- Preview remains read-only; league persistence starts only on explicit commit.
- Duplicate commits use the existing conflict/idempotency behavior and require an explicit force action to update.
- Commissioner and linked-account gates remain enforced before normalization and persistence.
- Validation warnings are written under the same import run as canonical evidence.
- No new database writes occur outside the existing canonical persistence service.
- Source tests cover submission errors, provider availability, commissioner denial, preview routing, validation wiring, canonical commit persistence, and UI retry guidance.

Cancelled in-flight network requests are not newly implemented in this phase. The UI prevents duplicate button submissions while a preview or commit is active, but transport-level request cancellation remains a follow-up hardening item rather than an NFL MVP blocker.

## Validation results

All commands used Vitest with `--pool=threads --maxWorkers=1`.

### Passing targeted tests

- `npx vitest run __tests__/league-create-defaults-api.test.ts ...`
  - 1 file, 24 tests passed.
- `npx vitest run __tests__/g55-import-ux-hardening.test.ts ...`
  - 1 file, 2 tests passed.
- `npx vitest run __tests__/league-import-submission-service.test.ts __tests__/league-import-commissioner-gate.test.ts ...`
  - 2 files, 11 tests passed.
- `npx vitest run __tests__/leagues-import-routes.sleeper-preview.test.ts __tests__/leagues-import-commit-validation-wiring.test.ts __tests__/imported-league-commit-service-tier0.test.ts ...`
  - 3 files, 28 tests passed.
- `g54-mvp-import-entry.test.ts` was included in the earlier repaired regression run and contributed 3 passing tests.

Distinct validated total: **8 files, 68 tests passed, 0 failures, 0 skips, 0 retries**.

Two broader combined attempts timed out at approximately 124 seconds because concurrent repository test workers exhausted the bounded execution window. They are recorded as timeouts and are not counted as passing. Each affected test group subsequently passed in bounded split runs.

### Static validation

- Targeted ESLint over the changed production and test files: **PASS**, 0 errors, 0 warnings.
- `git diff --check`: **PASS**. The command emitted existing line-ending notices from the dirty worktree but no whitespace errors.
- Targeted TypeScript (`npx tsc -p tsconfig.g55.json --pretty false`): **BLOCKED BY KNOWN BASELINE**. The selected dependency graph reported three existing errors in `lib/auth.ts` at lines 618, 625, and 647 for undeclared session user properties (`username`, `id`, `spotifyAccount`). No G55 file produced a TypeScript error. The temporary config was removed.

## Remaining blockers

- Authenticated browser certification of create → import → invite → draft remains unexecuted (G48 external tooling gate).
- Live provider behavior/freshness remains uncertified (G52).
- Authenticated multiplayer draft pick certification remains unexecuted (G53B).
- The three baseline `lib/auth.ts` session typing errors prevent a fully green targeted TypeScript claim.
- Provider credentials and real source leagues are still required to prove each advertised import path at runtime.

## Updated MVP assessment

The source is ready for authenticated create/import certification. It is not yet truthful to recommend an invited NFL MVP because the authenticated customer journey, real providers, and multiplayer draft have not been physically certified.

Published readiness is therefore unchanged:

- NFL Redraft Beta: **95%**
- NCAAF Redraft Beta: **80%**
- August 10 Controlled Beta: **70%**

Recommended next phase: authenticated create/import certification as soon as the trusted browser bridge and safe development session are available. If that access remains unavailable, fix the narrow `lib/auth.ts` session typing baseline without expanding product scope.

```text
G55 MVP BLOCKER REMEDIATION: PASS
CREATE LEAGUE REGRESSIONS RESOLVED: YES
SLEEPER IMPORT REGRESSIONS RESOLVED: YES
IMPORT UX HARDENED: YES
UNSUPPORTED PROVIDERS HIDDEN OR LABELED: YES
READY FOR AUTHENTICATED CREATE/IMPORT CERTIFICATION: YES
RECOMMENDED FOR INVITED NFL MVP: NO
```
