# G54 — NFL & NCAAF MVP League Creation, Import, and Launch Certification Audit

Date: 2026-07-12

Evidence labels:

- **Source verified** — traced through current UI, route, domain and persistence code.
- **Test verified** — exercised by a passing deterministic test.
- **Authenticated runtime verified** — not achieved; the trusted browser bridge remains unavailable.
- **Provider verified** — not achieved; no live provider credentials or responses were exercised.

## 1. Executive summary

The shortest truthful answer is:

- A new customer has a coherent, source- and test-verified path to create an NFL or NCAAF redraft league and reach its canonical league home with invite/setup intent.
- NFL imports have real preview, normalization and persistence paths for Sleeper, ESPN, Yahoo, Fantrax, MFL and Fleaflicker, but each remains only partially launch-certified because no authenticated provider/runtime journey occurred.
- NCAAF native creation is source/test ready. NCAAF import is only claimed for Fantrax; the other current adapters resolve NFL or exclude NCAAF.
- Draft preparation is source/test ready but not launch-certified because G53B could not run authenticated multiplayer.

G54 repaired the highest-impact customer dead end. `/create-league` links customers to `/import`, but the Sleeper tab previously exposed only a username-based legacy-profile flow even though canonical Sleeper league preview/commit services existed. The import page now exposes both choices: build a legacy profile or import one Sleeper league through the existing canonical preview/confirm/commit pipeline.

Provider inputs now state their NFL/NCAAF MVP sport support. This prevents the generic import UI from implying that ESPN, Yahoo, MFL, Sleeper or Fleaflicker can import an NCAAF league.

## 2. NFL create-league status

Status: **PARTIAL — source/test ready, authenticated runtime unverified**.

Canonical flow:

```text
/create-league
→ authenticated CreateLeagueV2Client
→ concept/sport/team/draft/scoring/review wizard
→ submitCreateLeagueV2
→ POST /api/leagues
→ session-derived AppUser commissioner identity
→ catalog + payload validation
→ preset engine
→ one Prisma transaction
→ League + commissioner/member + teams/rosters + settings + draft/session materialization
→ /league/{leagueId}?created=1&guide=settings&openChat=league&showInvite=1
```

Verified:

- Authentication is required; the production route cannot use its non-production E2E bypass.
- NFL and NCAAF are distinct catalog sports.
- League name, team count, draft type, scoring preset, privacy, timezone and trade review are validated.
- Client-supplied user/commissioner fields are stripped; commissioner identity comes from the authenticated session.
- Sport/concept/draft/scoring/team combinations are checked against the server catalog.
- Canonical creation uses a single Prisma transaction.
- Native defaults include roster, scoring, draft, waiver, playoff, schedule and redraft contract snapshots.
- A join code, commissioner roster/membership and draft session are created by the canonical pipeline.
- Post-create navigation points to the canonical league shell and requests settings, chat and invite handoff.
- Draft materialization and several post-create artifacts are best-effort after the core transaction; failures are logged but do not roll back the already-created league.

Limits:

- No authenticated browser proved create → refresh → invite → draft setup.
- Native create has client-side double-submit suppression but no explicit request idempotency key at the canonical API boundary. A network replay after an uncertain response can create a second manual league.
- Post-create best-effort draft materialization can fail and require the commissioner’s “Fill empty slots” recovery.
- The broad creation UI exposes many non-MVP formats; G54 certifies only NFL/NCAAF redraft scope.

## 3. NFL import status by provider

| Provider | Source implementation | Coverage truth | NFL MVP status |
| --- | --- | --- | --- |
| Sleeper | Dedicated fetch, validation/preview, canonical normalization, commissioner gate, conflict-safe persistence and historical services. G54 restored the reachable league-import UI. | Strongest adapter; live authentication/provider journey still absent. Unified commit currently does not pass expected Sleeper validation findings into persisted additional warnings. | **Partial** |
| ESPN | Real fetch and adapter; league/settings/teams/rosters/schedule/draft/transactions normalization. Public/private credential behavior is explicit. Fetch service resolves NFL. | Private leagues require stored SWID/ESPN_S2. Historical and some provider resources can be partial. | **Partial** |
| Yahoo | OAuth-backed fetch and adapter; settings/rosters/schedule/draft/transactions normalization. | Requires connected Yahoo account; source mapping is NFL for football leagues. No live OAuth journey was run. | **Partial** |
| Fantrax | Legacy snapshot fetch plus canonical adapter, scoring/schedule/roster/history mapping; tests cover preview. | Source IDs are less customer-friendly; completeness varies by stored snapshot. Supports NFL and NCAAF source resolution. | **Partial** |
| MFL | API-key-backed fetch and canonical adapter; NFL is explicit. | Detailed rule-level scoring and some lineup/history coverage are partial. | **Partial** |
| Fleaflicker | Public API fetch and adapter. NFL is accepted. | Adapter explicitly reports missing scoring rules, schedule, draft and trade history in v1. | **Partial** |

Duplicate imports are guarded by provider/source identity. The unified commit returns `LEAGUE_ALREADY_IMPORTED` unless an explicit refresh/re-import path is chosen.

## 4. NCAAF create-league status

Status: **PARTIAL — source/test ready, authenticated runtime unverified**.

NCAAF uses the same canonical transaction as NFL with NCAAF-specific preset, player-pool, roster, scoring, schedule and playoff defaults. Creation tests verify NFL/NCAAF separation and canonical redraft defaults. G53 also removed the NFL live-ADP fallback from NCAAF mock drafting.

Remaining risks:

- No authenticated NCAAF creation, member invite, real player pool or live draft preparation run.
- Provider-backed NCAAF player completeness is awaiting live certification.
- G53B did not certify NCAAF multiplayer pick persistence.

## 5. NCAAF import status by provider

| Provider | NCAAF claim | Evidence | Status |
| --- | --- | --- | --- |
| Fantrax | Supported in source | Fetch service maps college-football/NCAAF records to `NCAAF`; canonical adapter is present. | **Partial** |
| Sleeper | Not claimed | MVP metadata and current adapter path are NFL-only for this product scope. | **Not implemented for NCAAF MVP** |
| ESPN | Not claimed | Current fetch service writes `sport: NFL`. | **Not implemented** |
| Yahoo | Not claimed | Football source mapping resolves NFL. | **Not implemented** |
| MFL | Not claimed | Fetch service explicitly writes `sport: NFL`. | **Not implemented** |
| Fleaflicker | Not claimed | Accepted sport set excludes NCAAF. | **Not implemented** |

The UI now states this sport support next to every provider input instead of implying universal NCAAF support.

## 6. Customer journey map

```text
Landing
→ sign up / login
→ dashboard
→ Create League
   → NFL or NCAAF redraft
   → team/draft/scoring/privacy setup
   → review
   → canonical transaction
   → league home setup guide
   → invite members
   → draft preparation

or

Dashboard / Create League import link
→ /import
→ provider
→ league ID / connected account
→ preview + coverage/review warnings
→ commissioner verification or attestation
→ canonical commit
→ imported league
→ review/fix incomplete settings
→ invite/claim rosters
→ draft preparation where the imported lifecycle supports a new draft
```

Journey findings:

- Fixed: Sleeper league import was hidden behind a legacy-profile-only default tab.
- Duplicate creation surfaces and legacy `/api/league/create` routes remain, but `/create-league` uses V2 + `/api/leagues` canonically.
- Import is a separate page rather than an embedded wizard step; the link is clear but adds context switching.
- Imported leagues can contain partial coverage. Preview/canonical warnings must remain visible before commit.
- Post-create URLs request settings, chat and invite presentation, but the trusted browser block prevents reachability confirmation.
- Landing copy saying “import any league format” is broader than physically certified support and should be narrowed before public marketing signoff.

Customer journey status: **PARTIAL**.

## 7. League settings audit

| Section | Creation/default persistence | Post-create/settings state | MVP assessment |
| --- | --- | --- | --- |
| General | Name, sport, size, privacy, timezone, language and concept persist canonically. | Canonical settings shell and commissioner gates exist. | Source ready |
| Scoring | Sport/preset validated and snapshot persisted. | NFL and NCAAF scoring panels/routes exist; imported provider rules may be partial. | Partial runtime |
| Roster | Sport defaults and roster templates are included in foundation settings. | Commissioner roster editor/import mapping exists. | Partial runtime |
| Draft | Draft type, rounds/timer/defaults and session are materialized. | Draft settings and pre-draft setup exist. | Partial pending G53B |
| Waivers | Waiver type/budget/processing defaults persist in foundation settings. | Waiver panels/runtime exist. | Partial runtime |
| Trades | Trade review mode persists; best-ball disables trades. | Trade settings and review services exist. | Partial runtime |
| Playoffs | Teams/start week/seeding/lower bracket defaults persist. | Editor/read-only imported-host presentation varies by source. | Partial runtime |
| Commissioner/members | Session user becomes commissioner; membership/roster seats are created. | Invite, claim, co-commissioner and member panels/routes exist. | Partial runtime |
| Notifications | Event and notification infrastructure exists. | Settings copy itself says preferences are stored “when wired,” revealing incomplete canonical persistence. | P1 gap |

Unsupported or uncertified advanced formats must not be included in the invited MVP promise merely because the global wizard exposes them.

## 8. Launch blockers

### P0 certification blockers

1. Trusted authenticated browser remains unavailable, blocking create/import/invite/refresh verification.
2. Real non-production database identity and safe mutation target are not established for onboarding certification.
3. G53B multiplayer draft preparation remains blocked.
4. No live provider credential path has certified any import provider.

### P1 product/instrumentation gaps

1. Canonical native creation lacks request-level idempotency for uncertain network replays.
2. Unified Sleeper commit no longer persists the validation-warning payload expected by its regression suite.
3. Notification preference persistence is not canonically complete.
4. Fantrax source input relies on legacy snapshot identifiers and needs clearer discovery/onboarding.
5. Marketing/import copy overstates universal format support.

## 9. Fixes implemented

1. Added Sleeper to the canonical league preview providers on `/import`.
2. Kept the existing legacy-profile workflow while adding an explicit “Import one Sleeper league” preview/confirm path.
3. Reused `/api/leagues/import/preview` and `/api/leagues/import/commit`; no parallel import engine was created.
4. Added provider-level NFL/NCAAF MVP support metadata.
5. Rendered honest sport support beneath provider import inputs.
6. Added regression coverage for reachable Sleeper import and NCAAF provider claims.

Files changed:

- `components/unified-import-ui/LeagueImportFlow.tsx`
- `components/league-creation/ImportSourceInputPanel.tsx`
- `lib/league-import/provider-ui-config.ts`
- `__tests__/g54-mvp-import-entry.test.ts`
- `docs/redraft/G54_NFL_NCAAF_MVP_READINESS_AUDIT.md`

## 10. Validation results

Final passing suite:

```text
npx vitest run
  __tests__/g54-mvp-import-entry.test.ts
  __tests__/create-league-v2-submit-api-leagues.test.ts
  __tests__/create-league-v2-form-completion.test.ts
  __tests__/create-league-v2-flow-guards.test.ts
  __tests__/canonical-league-create-pipeline.test.ts
  __tests__/create-canonical-league-transaction-contract.test.ts
  __tests__/normalize-create-league-payload.test.ts
  __tests__/redraft-defaults-nfl-ncaaf.test.ts
  __tests__/leagues-import-routes.sleeper-preview.test.ts
  __tests__/leagues-import-routes.fantrax.test.ts
  __tests__/imported-league-commit-service-tier0.test.ts
  __tests__/league-import-commissioner-gate.test.ts
  --pool=threads --maxWorkers=1
```

Result: **12 files passed; 98 tests passed; 0 failures, skips, retries or timeouts; 83.65 seconds.**

Initial broad suite: **14 files, 126 tests; 119 passed and 7 failed**.

- Four failures in `league-create-defaults-api.test.ts` exercise the legacy `/api/league/create` path with stale/incomplete Prisma mocks and expectations; the canonical V2 `/api/leagues` suites pass.
- Three failures in `leagues-import-commit-validation-wiring.test.ts` expose a genuine current discrepancy: the unified commit route does not invoke/persist expected Sleeper validation findings or an explicit `additionalWarnings: undefined` field. Import still commits in its route tests, but warning evidence is weaker than the stale regression contract expects.

Static validation:

- Targeted ESLint on the three changed implementation files and G54 regression test: **passed with 0 errors and 0 warnings** in 73.1 seconds.
- Focused TypeScript project for the three changed implementation modules: **passed with 0 errors** in 39 seconds using a 6 GB Node heap.
- Targeted `git diff --check`: **passed with no whitespace errors**; Git emitted only LF-to-CRLF working-tree notices.

No browser, authenticated session, database, live provider or import mutation was exercised.

## 11. Remaining risks

- Source/test success does not prove a new customer can finish onboarding in a real session.
- Post-create best-effort jobs can leave recoverable setup work.
- Import coverage varies materially by provider and season.
- Imported manager identity may require claim/attestation resolution.
- Provider connections (Yahoo OAuth, ESPN cookies, MFL key) have not been customer-tested.
- NCAAF import depends on Fantrax data availability and mapping quality.
- Draft readiness still depends on real roster claims, pool readiness and G53B.

## 12. Recommended MVP scope

### NFL invited MVP

| Feature | Present | Tested | Runtime verified | Launch ready |
| --- | --- | --- | --- | --- |
| Native NFL redraft creation | Yes | Yes | No | Partial |
| Canonical defaults/settings | Yes | Yes | No | Partial |
| Commissioner assignment | Yes | Yes | No | Partial |
| Invite/claim foundation | Yes | Targeted prior tests | No | Partial |
| Sleeper league import | Yes | Yes | No | Partial |
| ESPN/Yahoo/Fantrax/MFL/Fleaflicker import | Yes | Adapter/route coverage varies | No | Partial |
| Draft preparation | Yes | Yes | No | Partial |
| Authenticated multiplayer draft | Present in source | Yes | No | No |

Recommended invited NFL MVP promise: native redraft creation; private/public league; standard snake/linear setup; canonical NFL scoring/roster/waiver/trade/playoff defaults; invitations; Sleeper import as the reference import; other providers labeled beta/partial; draft-room access subject to final authenticated certification.

### NCAAF invited MVP

| Feature | Present | Tested | Runtime verified | Launch ready |
| --- | --- | --- | --- | --- |
| Native NCAAF redraft creation | Yes | Yes | No | Partial |
| NCAAF defaults/pool boundaries | Yes | Yes | No | Partial |
| Fantrax NCAAF import | Yes | Preview/adapter source tests | No | Partial |
| Other NCAAF imports | No | N/A | No | No |
| Invite/claim foundation | Yes | Shared tests | No | Partial |
| NCAAF draft preparation | Yes | Source/unit | No | Partial |
| NCAAF authenticated multiplayer draft | Present in source | Source/unit | No | No |

Recommended NCAAF MVP promise: native creation first. Label Fantrax import beta. Do not advertise Sleeper, ESPN, Yahoo, MFL or Fleaflicker as NCAAF import providers.

## 13. Updated readiness assessment

G54 repaired a real customer entry-path defect but did not remove the authenticated/runtime gate. Readiness remains unchanged:

- NFL Redraft: **95%**
- NCAAF Redraft: **80%**
- August 10 Controlled Beta: **70%**

```text
G54 MVP READINESS AUDIT: PARTIAL
NFL CREATE LEAGUE READY: PARTIAL
NFL IMPORT READY: PARTIAL
SLEEPER IMPORT READY: PARTIAL
ESPN IMPORT READY: NO
YAHOO IMPORT READY: NO
NCAAF CREATE LEAGUE READY: PARTIAL
NCAAF IMPORT READY: NO
CUSTOMER JOURNEY VERIFIED: PARTIAL
DRAFT PREPARATION READY: PARTIAL
RECOMMENDED FOR INVITED MVP: NO
```

What can ship today at source level: native NFL/NCAAF redraft creation and provider imports with honest coverage labels.

What must remain constrained: public launch claims, non-Fantrax NCAAF imports, authenticated draft readiness, live provider correctness and universal-format marketing.

Single next recommended action: restore the trusted authenticated browser and safe non-production database, then run a narrow create/import → invite → draft-prep certification. That combines the still-open G48/G53B onboarding gates without adding new features.
