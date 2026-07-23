# AllFantasy Import Platform Certification — Phase 1 Audit

**Date:** 2026-07-23
**Scope:** Full certification audit of the AllFantasy league-import ecosystem.
**Status:** Audit only — no code changed.
**Method:** Every claim below is traced to a file:line in this repo. Nothing is marked
"supported" on the strength of a name, a registry entry, or a comment.

---

## 0. Executive summary

The import system has a **genuinely good architecture and an honest self-reporting
layer**, sitting on top of **three structural failures that make most of the imported
data inert in production**.

What is real and good:

- A clean 4-stage pipeline (fetch → normalize → canonical bundle → commit) with a single
  adapter contract, six registered adapters, and a per-entity `ImportCoverage` block that
  each adapter fills in honestly — including admitting `missing`.
- Real idempotency (`ImportRun.idempotencyKey`), a real audit trail (`ImportRun`,
  `ImportWarning`, `ExternalEntityMapping`, `ImportReviewTask`), and failed-run cleanup
  that permits safe retry.
- A commissioner gate that refuses to overstate what it proved — API-verified for Sleeper,
  explicit recorded attestation for ESPN/Yahoo/MFL, and `verification:'attestation'` never
  laundered into `'api'`.
- `provider-ui-config.ts` is a rare thing: a product-readiness flag list that tells the
  truth about its own gaps, guarded by a snapshot test.

What is broken, in priority order:

1. **Decision OS receives zero behavioral data from any import.** The entire
   imported-activity ingestion chain is built, tested, and wired to nothing. There is no
   production caller.
2. **All post-commit work is fire-and-forget with no `waitUntil`.** Historical backfill,
   avatar mirroring, and rank recompute are dispatched with bare `void` in a serverless
   runtime. Multi-season history is the single most valuable thing an import produces, and
   its delivery is not guaranteed.
3. **The Legacy/rank evidence bridge is Sleeper-only.** Five of six platforms import
   history that never reaches the Legacy Score engine.

Plus one hard blocker and one stale flag:

4. **MFL import is unreachable** — the credential the import path reads and the credential
   the UI collects are two different things in two different tables.
5. **Fantrax is gated `available: false` for a reason that is no longer true.**

---

## PART 1 — Platform inventory

Six providers, confirmed complete. `IMPORT_PROVIDERS` (`lib/league-import/types.ts:8`) is
the single source of truth; the adapter registry
(`lib/league-import/importAdapterRegistry.ts:11`) and the UI config
(`lib/league-import/provider-ui-config.ts:25`) both enumerate exactly these six. No
seventh provider exists anywhere in the import layer.

| Provider | Auth method | Transport | Discovery | Historical | Reachable today |
|---|---|---|---|---|---|
| **Sleeper** | None (public API) | `api.sleeper.app/v1` REST | ✅ Yes | ✅ `previous_league_id` chain, ≤10 | ✅ Yes |
| **ESPN** | Cookie `SWID` + `espn_s2`, public fallback | `lm-api-reads` REST | ❌ No | ✅ Same league ID probed backwards | ✅ Yes |
| **Yahoo** | OAuth2 + refresh, tokens encrypted at rest | Yahoo Fantasy REST | ❌ No | 🟡 Heuristic match (name + sport + team count) | ✅ Yes |
| **Fantrax** | None — user-uploaded CSV snapshots | Local Prisma read | ❌ No | ✅ From prior uploaded CSVs | ❌ Gated off |
| **MFL** | `APIKEY` query param | `api.myfantasyleague.com/export` | ❌ No | ✅ Same league ID across seasons | ❌ **Blocked** |
| **Fleaflicker** | None (public API) | `fleaflicker.com/api` | ❌ No | ❌ None | ❌ Gated off |

### Auth detail

- **Yahoo** is the strongest: `encrypt()`/`decrypt()` on both access and refresh token,
  automatic refresh on a 401 with token re-persist
  (`lib/league-import/yahoo/YahooLeagueFetchService.ts:262-338`). This is the reference
  implementation the other providers should follow.
- **ESPN** builds `SWID=…; espn_s2=…` and attempts *twice* — once authenticated, once
  anonymous (`EspnLeagueFetchService.ts:301-302`), so public leagues import without a
  connection and private ones give a specific reconnect message (`:330`).
- **MFL** reads `getDecryptedAuth(userId, 'mfl').apiKey`
  (`MflLeagueFetchService.ts:218-226`). See Part 6 for why nothing ever writes it.
- **Fantrax is not an API integration at all.** It reads `prisma.fantraxLeague` rows
  produced by a CSV upload at `/af-legacy`. Calling it a "platform integration" overstates
  it; it is a snapshot importer.

### Rate limits, retry, caching

Only **Sleeper** has a real resilience layer, and it is good: 3 attempts, exponential
backoff (`300 * 2^attempt`), 12s per-request timeout via `AbortController`, and — the part
that matters — it distinguishes a legitimate 404/empty ("week beyond season") from a real
failure, pushing only real failures into `fetchWarnings`
(`SleeperLeagueFetchService.ts:22-59`). Those warnings survive all the way into persisted
`ImportWarning` rows, so an incomplete import can never present as complete.

**No other provider has retry, backoff, or timeout handling.** No provider implements
rate-limit awareness (no 429 backoff beyond Sleeper's generic retry, no token bucket, no
concurrency cap). Sleeper fires up to 36 parallel week requests
(`SleeperLeagueFetchService.ts:159-176`) with no concurrency limit — fine today, fragile if
Sleeper tightens limits.

**No provider supports webhooks.** All sync is pull-based and user-initiated.

---

## PART 2 — Import pipeline

The canonical path, provider-agnostic:

```
UI (ImportProviderSelector / LeagueImportFlow)
  → POST /api/leagues/import/preview      [requireVerifiedUser + assertImportCommissioner]
      → orchestrateImportPreview                     importOrchestrator.ts:26
          → runImportedLeagueNormalizationPipeline    (fetch, per-provider branch)
              → fetch{Provider}LeagueForImport        provider fetch service
          → runImportNormalizationPipeline            → adapter.normalize()
          → validateNormalizedImport
          → buildCanonicalImportBundle                → CanonicalImportBundle
          → validateCanonicalBundle
          → buildImportedLeaguePreview
  → POST /api/leagues/import/commit       [requireVerifiedUser + commissioner gate]
      → persistImportWithCanonicalAudit              importPersistenceService.ts:45
          → ImportRun(status:'running')  [idempotencyKey]
          → persistImportedLeagueFromNormalization   ImportedLeagueCommitService.ts:319
              → League create/update  (+ Tier-0 column patch)
              → bootstrapLeagueFromImport            → LeagueTeam / Roster rows
              → materializeRedraftSeasonForImportedLeague
              → persistTradedPicks                   → future_draft_picks   [Sleeper only]
              → draft/waiver/playoff/schedule bootstraps
              → LeagueSeason upsert (current season)
              → void mirrorImportAvatars()                    ⚠ unawaited
              → void runHistoricalBackfill()                  ⚠ unawaited
              → calculateAndSaveRank
          → ImportRun(status:'completed')
          → ImportWarning[] / ExternalEntityMapping[] / ImportReviewTask
          → [Sleeper only] LegacyEvidenceRecord + LegacyScoreEngine recompute
```

### Entity → destination map

| Entity | Normalized field | Destination |
|---|---|---|
| League settings | `league.*` | `League` columns + `League.settings` JSON |
| Tier-0 settings (waivers, playoffs, taxi, IR) | `league.taxi_slots`, `reserve_allow_*`, … | `League` columns via `buildTier0LeagueColumnPatch` (`ImportedLeagueCommitService.ts:49`) |
| Managers / teams / owners | `rosters[]` | `LeagueTeam`, `Roster` (via bootstrap) |
| Roster / bench / IR / taxi | `player_ids`, `starter_ids`, `reserve_ids`, `taxi_ids` | `Roster`, `RedraftRoster` |
| Scoring | `scoring.rules[]` | `League.settings` / `scoringPresetId` |
| Schedule / matchups / weekly scores | `schedule[]` | `LeagueSeason`, redraft season materialization |
| Standings | `standings[]` | `LeagueSeason` (champion/runner-up), `FantasyStanding` |
| Transactions / trades / waivers / FAAB | `transactions[]`, `faab_remaining` | *(see gap below)* |
| Future traded picks | `traded_picks[]` | `future_draft_picks` — **Sleeper only** |
| Previous seasons | `previous_seasons[]` | `LeagueSeason` rows via async backfill |
| Player identity | `player_map`, `identity_mappings[]` | `ExternalEntityMapping` |
| Branding / logos | `league_branding` | `League.avatarUrl` (+ mirror attempt) |
| Warnings | `fetch_warnings`, `fetchWarnings` | `ImportWarning` |

**Gap — transactions have no first-class destination.** `NormalizedTransaction[]` is
fully populated by five of six adapters and validated, but the commit service writes no
transaction table. It reaches the DB only indirectly, inside the `canonicalSummary` JSON
blob on `ImportRun`. Trade Evaluator, Waiver Engine, and Manager Psychology cannot query it.

**Gap — `previous_owner_roster_id` is dropped.** Acknowledged in-code as a schema
limitation (`ImportedLeagueCommitService.ts:107-110`); `future_draft_picks` has no column.
The normalized type retains it so a future migration needs no mapper rewrite. Correctly
documented, still a real loss of dynasty pick provenance.

---

## PART 3 — Data certification

Legend: ✅ Certified · 🟡 Partial · ❌ Unsupported · ⚪ Unknown

| Capability | Sleeper | ESPN | Yahoo | Fantrax | Fleaflicker | MFL |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **Authentication** | ✅ | ✅ | ✅ | 🟡 | ✅ | ❌ |
| **League discovery** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **League settings** | ✅ | ✅ | ✅ | 🟡 | 🟡 | ✅ |
| **Tier-0 settings** (taxi/IR/trade window) | ✅ | 🟡 | 🟡 | ❌ | ❌ | 🟡 |
| **Managers / owners** | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ |
| **Current rosters** | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 |
| **Starters vs bench** | ✅ | ✅ | ✅ | 🟡 | ❌ | 🟡 |
| **IR / reserve** | ✅ | ✅ | ✅ | ⚪ | ❌ | ✅ |
| **Taxi squad** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Scoring rules** | ✅ | ✅ | ✅ | 🟡 | ❌ | ❌ |
| **Schedule / matchups** | ✅ | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| **Weekly scores** | ✅ | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| **Standings** | ✅ | 🟡 | 🟡 | ✅ | 🟡 | 🟡 |
| **Draft picks** | ✅ | ✅ | ✅ | 🟡 | ❌ | ✅ |
| **Transactions / waivers** | ✅ | ✅ | ✅ | 🟡 | ❌ | ✅ |
| **Trades** | ✅ | ✅ | ✅ | 🟡 | ❌ | ✅ |
| **FAAB balances** | ✅ | ✅ | ✅ | ⚪ | ✅ | ✅ |
| **Future traded picks** | ✅ | ❌ | ❌ | 🟡 | ❌ | ❌ |
| **Playoff settings** | ✅ | ✅ | ❌ | 🟡 | ❌ | ✅ |
| **Keeper / dynasty detection** | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 |
| **Historical seasons** | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| **Player identity map** | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| **Logos / branding** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Commissioner verification** | ✅ | 🟡 | 🟡 | ❌ | ❌ | 🟡 |
| **Decision OS behavioral events** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Legacy evidence bridge** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Evidence for the non-obvious cells

- **Taxi ❌ for all but Sleeper** — `taxi_ids: []` hardcoded in `EspnAdapter.ts:67`,
  `YahooAdapter.ts:68`, `MflAdapter.ts:72`, `FleaflickerAdapter.ts:69`. Dynasty leagues on
  those platforms silently lose their taxi squad.
- **Yahoo playoff settings ❌** — `playoff_team_count: raw.settings?.usesPlayoff ? undefined : 0`
  (`YahooAdapter.ts:171`). The value is *never* populated: `undefined` when playoffs exist,
  `0` when they don't. Yet the coverage block reports
  `playoffSettings: { state: raw.settings ? 'full' : 'partial' }` (`:217`) — **the only
  place in the codebase where a coverage bucket overstates reality.** `faab_budget: null`
  is likewise hardcoded (`:176`).
- **MFL scoring rules ❌** — `rules: []` hardcoded (`MflAdapter.ts:81`). Only the coarse
  format string survives. The coverage block honestly says `'partial'` (`:205`).
- **Fleaflicker scoring ❌** — `scoring: null` (`FleaflickerAdapter.ts:109`), and
  `league.scoring` is set to `lg.description` (`:98`) — the league's free-text description
  written into the scoring field. That is a data-integrity defect, not just a gap.
- **Standings 🟡 for ESPN/Yahoo/MFL** — `rank: team.rank ?? raw.teams.length` places every
  rank-less team in last place rather than leaving rank unknown
  (`EspnAdapter.ts:130`, `YahooAdapter.ts:139`, `MflAdapter.ts:129`).
- **Yahoo historical 🟡** — prior seasons are matched by *name + sport + team count*
  (`YahooAdapter.ts:277`). Two similarly-named leagues in one account will cross-link.
  ESPN/MFL probe the same league ID backwards, which is exact.
- **Fleaflicker keeper detection 🟡** — `desc.includes('dynasty')` on free text
  (`FleaflickerAdapter.ts:15`).

### Fabricated values — the honesty audit

The codebase is overwhelmingly disciplined about not inventing data. Three exceptions, all
in `FleaflickerAdapter.ts`:

| Line | Fabrication |
|---|---|
| `:103` | `playoff_team_count: Math.max(2, Math.floor(leagueSize / 2))` — invented, not sourced. Coverage still claims `playoffSettings: 'partial'` rather than `missing`. |
| `:42` | `rosterSize: lg.rosterRequirements?.rosterSize ?? 40` — magic default 40. |
| `:98` | `scoring: lg.description ?? 'imported'` — wrong field entirely. |

By contrast, `status` is handled exemplarily everywhere: each adapter derives it from a
real provider signal and documents which one (`EspnAdapter.ts:157-162` cites
`status.finalScoringPeriod`; `MflAdapter.ts:150-153` explicitly flags its own signal as
"coarser… but still real, not fabricated"). This is the standard the Fleaflicker adapter
should be held to.

---

## PART 4 — Decision OS dependencies

### 🛑 Finding 1 — Decision OS receives nothing from imports

The imported-activity ingestion chain exists in full:

```
importedActivityNormalizer.ts  → NormalizedImportedActivity
importedActivityWriter.ts      → writeImportedActivity()      (idempotent, tested)
importedActivityStore.ts       → ImportedActivityStore port
prismaImportedActivityStore.ts → real Prisma adapter
sleeperActivityEmitter.ts      → ingestSleeperImportedActivity()
```

It is well-designed — provider-neutral port, natural-key upsert, honest `skipped` reasons
rather than fabricated writes.

**It has no production caller.** Searching `lib/`, `app/`, `scripts/`, and `__tests__/`
for `writeImportedActivity`, `ingestSleeperImportedActivity`, and
`PrismaImportedActivityStore` returns only:

- `__tests__/decision-os/*` — unit tests
- `scripts/decision-os-ingest-sleeper-activity-nonprod.ts` — explicitly non-prod

*(Verified with a positive control: the same search scoped to `lib/league-import` for
`persistImportWithCanonicalAudit` returns its real callers, so the search is sound. This
matters — see `search-false-negatives-on-windows`.)*

Neither `persistImportWithCanonicalAudit` nor `persistImportedLeagueFromNormalization`
references the emitter.

**Consequence:** every Decision OS surface that depends on imported manager behavior —
Manager Psychology, Trade Replay, Attention Signals, Timeline, Chimmy behavioral context —
has zero rows for every imported league on every platform. Those surfaces are reading from
tables the import never fills.

### 🛑 Finding 2 — the Legacy bridge is Sleeper-only

`importPersistenceService.ts:179`:

```ts
if (input.provider === 'sleeper') {
  // deriveEvidenceRowsFromImport → LegacyEvidenceRecord
  // runLegacyScoreEngineForLeague(...)
}
```

ESPN, Yahoo, MFL, Fantrax, and Fleaflicker imports produce **no** `LegacyEvidenceRecord`
rows and never trigger a Legacy Score recompute — even when they successfully import
multi-season history. Legacy Score, Hall of Fame, Record Book, and Rivalry surfaces are
Sleeper-only in practice regardless of what was imported.

### Consumer map

| Consumer | Depends on | Status |
|---|---|---|
| Lineup Optimizer | `rosters[]`, `starter_ids` | ✅ Works (5 providers) |
| Trade Evaluator | `transactions[]`, `traded_picks[]` | 🟡 Picks Sleeper-only; transactions have no queryable table |
| Waiver Engine | `faab_remaining`, `waiver_type`, transactions | 🟡 Balances land; history does not |
| Power Rankings | `standings[]`, `schedule[]` | ✅ Works |
| Legacy Score | `LegacyEvidenceRecord` | ❌ Sleeper only |
| Manager Psychology | imported activity events | ❌ No rows, any provider |
| Historical Replay | `LeagueSeason` backfill | 🟡 Delivery not guaranteed (Part 6) |
| Trade / Draft Replay | activity events | ❌ No rows |
| Chimmy Intelligence | `ImportHistoryContextProvider` | 🟡 Reads runs/warnings, not behavior |
| Notifications | `sendImportNotification` | ✅ Wired |
| Attention Signals / Timeline | activity events | ❌ No rows |

### Does the system fabricate when data is missing?

**Mostly no, and that is the system's best quality.** The `ImportCoverage` block is
per-entity, per-provider, and adapters willingly report `missing`. Warnings persist to
`ImportWarning`. `reviewRequired` opens an `ImportReviewTask`. `status` is derived only
from real provider signals.

Three exceptions, all named above: the two Fleaflicker fabrications, and the Yahoo
`playoffSettings: 'full'` overstatement.

---

## PART 5 — Legacy certification

| Legacy capability | Sleeper | ESPN | Yahoo | Fantrax | Fleaflicker | MFL |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Previous seasons discovered | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Historical standings | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Historical matchups | ✅ | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| Historical drafts | ✅ | ✅ | 🟡 | ❌ | ❌ | 🟡 |
| Historical trades | ✅ | ✅ | 🟡 | 🟡 | ❌ | 🟡 |
| Historical champions | ✅ | ✅ | 🟡 | 🟡 | ❌ | ✅ |
| Roster reconstruction | ✅ | 🟡 | 🟡 | 🟡 | ❌ | 🟡 |
| Playoff reconstruction | 🟡 | 🟡 | ❌ | ❌ | ❌ | 🟡 |
| Manager records | ✅ | 🟡 | 🟡 | 🟡 | ❌ | 🟡 |
| Rivalries | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Legacy Score calculation** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Manager Psychology history** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Backfill services exist for five providers (`runHistoricalBackfill`,
`ImportedLeagueCommitService.ts:260-317`); **Fleaflicker falls through to `return null`**
(`:316`) — it has no backfill service at all, consistent with its adapter reporting
`previousSeasons: missing`.

Sleeper's chain is the deepest: it walks `previous_league_id` up to 10 seasons and pulls
each season's drafts along the way (`SleeperLeagueFetchService.ts:190-204`).

---

## PART 6 — Import quality

### 🛑 Finding 3 — unguaranteed background work

`ImportedLeagueCommitService.ts` dispatches three long-running jobs with a bare `void`:

| Line | Work | Risk |
|---|---|---|
| `:536` | `runHistoricalBackfill(...)` — multi-season fetch + write | **High** — the highest-value output of the whole import |
| `:505` | `mirrorImportAvatars(...)` | Low |
| `importPersistenceService.ts:202` | `runLegacyScoreEngineForLeague(...)` | Medium |

**There is no `waitUntil()` or `after()` anywhere in the import layer** — verified across
`lib/league-import/**` and `app/api/leagues/import/**`. On Vercel, an unawaited promise has
no guarantee of completing once the response is sent. Fluid Compute improves the odds
through instance reuse, but it is not a contract.

The failure is silent and looks like success: the league is stamped
`historicalBackfillStatus: 'pending'` (`:528`) *before* dispatch, and only the completion
handler flips it to `'complete'`. A killed instance leaves the league permanently
`'pending'` — a status the History tab polls forever, with no error and no retry path.

### Quality scorecard

| Dimension | State |
|---|---|
| **Idempotency** | ✅ Strong. `{userId}:{provider}:{sourceLeagueId}:{season}`, distinct `:into:{leagueId}` key for existing-league imports, completed runs short-circuit (`importPersistenceService.ts:18-35, 70-86`). |
| **Duplicate prevention** | ✅ `persistTradedPicks` upserts on the composite unique; `ExternalEntityMapping` upserts on `(leagueId, provider, entityType, sourceId)`. |
| **Retry after failure** | ✅ `deleteFailedImportRunIfPresent` clears failed runs so the unique key doesn't block a retry (`:38`). |
| **Partial imports** | ✅ Modelled explicitly by `ImportCoverage` + `fetchWarnings` → `ImportWarning`. |
| **Interrupted imports** | ❌ No resume. A killed backfill is unrecoverable without a manual re-import. |
| **Rate-limit handling** | 🟡 Sleeper only. |
| **Retry / backoff** | 🟡 Sleeper only (3× exponential + timeout). |
| **Error handling** | ✅ Typed per-provider errors mapped to four stable codes (`LEAGUE_NOT_FOUND`, `NORMALIZATION_FAILED`, `CONNECTION_REQUIRED`, `UNAUTHORIZED`). |
| **Audit trail** | ✅ Best-in-repo. `ImportRun` + `rawPayloadHash` + `canonicalSummary` + warnings + mappings + review tasks. |
| **Non-fatal isolation** | ✅ Every optional step is individually try/caught so it can never fail a committed import. |

### 🛑 Finding 4 — MFL is structurally unreachable

Two disconnected credential systems:

| | Collects | Stores | Read by import? |
|---|---|---|---|
| `/api/auth/mfl` (`app/api/auth/mfl/route.ts`) | MFL username + **password** | `MFLConnection.mflCookie` | ❌ Never |
| Import path (`MflLeagueFetchService.ts:218`) | — | `getDecryptedAuth(userId,'mfl').apiKey` | ✅ but nothing writes it |

The UI reinforces the dead end: `ImportSourceInputPanel.tsx:47` tells the user to *"Save
your MFL API key in League Sync first"* — **no such input exists anywhere in the app.**
The only MFL credential UI is `app/af-legacy/page.tsx:1662`, which posts to
`/api/auth/mfl` and fills the table the import never reads.

Three additional defects in that route:

1. **No authentication.** No `requireVerifiedUser`, no session check — an anonymous caller
   can POST credentials and write rows.
2. **No user linkage.** `MFLConnection` (`prisma/schema.prisma:1558`) has no `appUserId`
   or `userId` column. It is keyed on `mflUsername` alone and cannot be scoped to an
   AllFantasy account.
3. **Plaintext storage.** `mflCookie` is stored unencrypted, unlike Yahoo's
   `encrypt(oauthToken)`. The route also handles a raw MFL password in flight.

`provider-ui-config.ts:32` is therefore correct to gate MFL off — but the real reason is
worse than the comment suggests.

### ⚠ Finding 5 — the Fantrax gate reason is stale

`provider-ui-config.ts:29-31` says Fantrax is unusable because *"appUserId is never
stamped by the upload route."* **That is no longer true.** The upload route stamps it on
both branches:

- `server/api-route-modules/legacy/fantrax/route.ts:95` — `update: { appUserId: auth.userId, … }`
- `:117` — `create: { appUserId: auth.userId, … }`

It also enforces ownership on re-upload (`:82`) and scopes listing to the caller (`:203`).
The read-side gate (`FantraxLeagueFetchService.ts:318`) fails closed correctly, matching
this. A later "Import Security Closure phase (real, this time)" commit evidently fixed it
and the config comment was never updated.

**A real blocker remains, but it is a different one:** Fantrax data enters only via CSV
upload at `/af-legacy`, while the provider is selected in the main
`/startup-dynasty` import flow. A user picking "Fantrax" there has no path to upload CSVs.
The gap is UX discontinuity, not authorization. That changes the fix from "stamp
ownership" to "surface CSV upload in the main flow" — a materially different work item.

### Permissions model

| Provider | What is actually proven | Gate |
|---|---|---|
| Sleeper | League membership **and** commissioner flag, via `/league/{id}/users` | ✅ `verification: 'api'` |
| ESPN, Yahoo, MFL | Membership via linked account; commissioner **not determinable** | 🟡 Requires explicit recorded attestation; stamped `verification:'attestation'` |
| Fantrax, Fleaflicker | Nothing — open read | ❌ Any authenticated user |

This gradient is deliberate and documented (`commissionerGate.ts:285-322`), and the
reasoning for *not* extending attestation to the open-read providers is sound. Worth
preserving as-is.

### Auth consistency on routes

Mixed. Newer routes use `requireVerifiedUser` (`preview`, `commit`, `discover`, `resync`);
older ones use raw `getServerSession` (`route.ts`, `sync`, `batch`, `c2c-*`,
`progress/[jobId]`). All are authenticated — but two idioms means two places to get it
wrong. Only `batch` applies `consumeRateLimit`.

---

## PART 7 — Certification matrix

See **Part 3**. Rolled up:

| Provider | ✅ | 🟡 | ❌ | Verdict |
|---|:--:|:--:|:--:|---|
| **Sleeper** | 22 | 3 | 1 | **Certified** — reference implementation |
| **ESPN** | 15 | 6 | 5 | **Conditionally certified** — no taxi, no traded picks, no Legacy bridge |
| **Yahoo** | 12 | 9 | 5 | **Conditionally certified** — playoff settings broken, zero tests |
| **MFL** | 8 | 10 | 8 | **Not certified** — unreachable |
| **Fantrax** | 2 | 15 | 9 | **Not certified** — no path in main flow |
| **Fleaflicker** | 5 | 7 | 14 | **Not certified** — fabricates data, no history, no tests |

---

## PART 8 — Automated certification

### Current coverage

| Layer | Coverage |
|---|---|
| Adapter `normalize()` | ✅ Strong — `import-mapping-architecture-prompt22.test.ts` (1215 lines) covers Sleeper, ESPN, Yahoo, MFL, Fantrax with synthetic fixtures |
| **Fleaflicker adapter** | ❌ **Zero** — absent from that file entirely; only `fleaflicker-source-id.test.ts` (15 lines, ID parsing) |
| Fetch services | ❌ No provider-payload contract tests (except `sleeper-fetch-reliability`) |
| Canonical normalizer | ✅ `canonical-import-normalizer{,-tier0}.test.ts` |
| Commissioner gate | ✅ `league-import-commissioner-gate.test.ts` (484 lines) |
| Persistence | 🟡 Sleeper only — `sleeper-import-db.integration.test.ts` |
| Decision OS ingestion | ✅ Well tested — but tests the unwired path |
| Provider availability | ✅ Snapshot-locked |

**Yahoo and MFL have no dedicated test file** despite 887- and 872-line fetch services.
Their only coverage is the shared architecture test's `normalize()` cases.

Also stale: that file asserts *"hasFullAdapter is true for all five providers"* (`:564`) —
there are six.

### Proposed regression suite

**Tier 1 — recorded-fixture contract tests (per provider, per entity).**
Capture one real sanitized payload per provider; assert the full `NormalizedImportResult`
shape *and* the `ImportCoverage` block. This is the missing layer: today a provider can
change its API and every test still passes.

**Tier 2 — a coverage-honesty invariant.** A single cross-provider test asserting that a
coverage bucket may never claim `full`/`partial` for a field the adapter leaves empty.
This one test would have caught the Yahoo `playoffSettings` overstatement and both
Fleaflicker fabrications.

**Tier 3 — a wiring test.** Assert that a completed import produces (a) imported-activity
rows and (b) `LegacyEvidenceRecord` rows for every provider. This fails today for all six
and all five respectively — which is exactly the point.

**Tier 4 — idempotency property test.** Run any provider's commit twice; assert
`existed: true`, no duplicate `LeagueTeam`/`future_draft_picks`/`ExternalEntityMapping`.

**Tier 5 — live smoke (nightly, not per-deploy).** One public league per provider through
preview only, asserting reachability and shape. Keeps provider drift visible without
gating deploys on third-party uptime.

---

## PART 9 — User experience

### What breaks users today

1. **"Coming soon" on three of six platforms.** `ImportProviderSelector.tsx:41` renders
   Fantrax/MFL/Fleaflicker as disabled `(coming soon)`. Honest, but half the advertised
   platform list is unusable.
2. **The MFL instruction is a dead end.** *"Save your MFL API key in League Sync first"* —
   League Sync has no such field. This is the single most confusing string in the flow.
3. **Discovery is Sleeper-only.** Every other provider requires the user to find and paste
   a league ID. ESPN and Yahoo users must dig it out of a URL.
4. **Fleaflicker's source ID format is undiscoverable** — `NFL:206154:2024`
   (`FleaflickerLeagueFetchService.ts:20-24`) is documented only in a code comment.
5. **History can hang forever.** A killed backfill leaves `historicalBackfillStatus:
   'pending'` with no timeout, no error, and no retry affordance.
6. **Fantrax has no upload path in the main flow.**

### What is already good

`ImportCoverage` → `ImportHealthIndicator` / `ImportWarningsCard` /
`CanonicalImportSummaryCard` gives per-entity honesty in the UI. `ImportReviewTask` surfaces
low-confidence mappings for review. Error codes map to specific, actionable messages
("Reconnect ESPN in Settings → Connected Accounts"). This is the right foundation — it just
needs to also say what an imported league *cannot* do.

### Recommendations

- **Read-only affordance.** Imported leagues should carry a persistent badge and disable
  write actions, driven off `League.platform != null`.
- **Decision OS must explain unavailability from `ImportCoverage`**, not fall back to
  defaults. A tile with no data should say *"Fleaflicker doesn't expose scoring rules"* —
  not render a flattering default. (See `league-home-os-mission-control` for the same
  hazard on health tiles.)
- **Per-platform capability preview before import**, rendered from the same coverage
  contract, so expectations are set before the user commits.
- **Backfill needs a timeout, a visible failure state, and a retry button.**

---

## PART 10 — Production readiness

### Highest-risk areas

| # | Risk | Severity | Evidence |
|---|---|---|---|
| 1 | Decision OS gets no imported behavior — five OS surfaces silently empty | **Critical** | No caller for `writeImportedActivity` |
| 2 | Backfill delivery not guaranteed; failure looks like "pending" forever | **Critical** | `ImportedLeagueCommitService.ts:536`; no `waitUntil` |
| 3 | Legacy bridge Sleeper-only | **High** | `importPersistenceService.ts:179` |
| 4 | MFL route unauthenticated, unencrypted, unlinked to any user | **High** | `app/api/auth/mfl/route.ts` |
| 5 | Transactions have no queryable destination | **High** | No transaction write in commit service |
| 6 | Fleaflicker fabricates playoff/roster/scoring values | **Medium** | `FleaflickerAdapter.ts:42,98,103` |
| 7 | Yahoo playoff settings never populated, coverage says `full` | **Medium** | `YahooAdapter.ts:171,217` |
| 8 | Yahoo history matched heuristically — can cross-link leagues | **Medium** | `YahooAdapter.ts:277` |
| 9 | No retry/backoff on 5 of 6 providers | **Medium** | Only Sleeper has it |
| 10 | Fleaflicker adapter has zero tests | **Medium** | Absent from architecture test |

### Quick wins

| Win | Effort | Value |
|---|---|---|
| Fix the stale Fantrax comment in `provider-ui-config.ts` | Trivial | Unblocks correct prioritization |
| Fix `"all five providers"` → six in the architecture test | Trivial | Removes a false signal |
| Add `requireVerifiedUser` to `/api/auth/mfl` | Small | Closes an open write endpoint |
| Fix Yahoo `playoff_team_count` + its coverage claim | Small | Removes the only dishonest coverage bucket |
| Fix Fleaflicker's three fabrications → report `missing` | Small | Restores the honesty invariant |
| Wrap the three `void` dispatches in `waitUntil` | Small | Directly addresses risk #2 |
| Add the coverage-honesty invariant test | Small | Prevents recurrence of #6/#7 |
| Add a backfill timeout + retry affordance | Medium | Removes the permanent-pending trap |

### Recommended roadmap

**Phase A — Truth & safety (1 sprint).** All quick wins above. Ship the coverage-honesty
invariant test. Net effect: the system stops making claims it can't support, and the
open MFL endpoint closes.

**Phase B — Make imports matter (2 sprints).** Wire `ingestSleeperImportedActivity` into
`persistImportWithCanonicalAudit`; generalize the emitter to the provider-neutral
normalized shape; generalize the Legacy evidence bridge past `provider === 'sleeper'`. Add
a transactions destination table. *This is the phase that converts imported data into
product value.*

**Phase C — Reliability (1 sprint).** Move backfill to a durable queue (Vercel Queues or a
cron-drained job table) rather than in-request dispatch. Add resume. Extend Sleeper's
retry/backoff helper to the other five fetch services.

**Phase D — Close the platforms (2–3 sprints).** MFL: one API-key field wired to
`getDecryptedAuth`, retire `MFLConnection`. Fantrax: surface CSV upload in the main flow.
Fleaflicker: add scoring/schedule/draft endpoints, a backfill service, and tests.

**Phase E — Coverage (1 sprint).** Recorded-fixture contract tests per provider; Yahoo and
MFL dedicated suites; nightly live smoke.

### Estimated completion by platform

| Platform | Today | Remaining work |
|---|:--:|---|
| Sleeper | **90%** | Taxi/playoff edges; activity wiring (shared) |
| ESPN | **70%** | Taxi, traded picks, Legacy bridge, retry |
| Yahoo | **65%** | Playoff settings, history matching, tests, retry |
| MFL | **40%** | Credential unification, auth fix, scoring rules |
| Fantrax | **35%** | Main-flow entry point, scoring depth |
| Fleaflicker | **20%** | Scoring, schedule, draft, transactions, history, tests |

### Scores

**Beta readiness: 6.5 / 10.**
Sleeper is genuinely production-grade, and ESPN/Yahoo are usable. The audit trail,
idempotency, and coverage-honesty model are better than most shipped products. A closed
NFL beta on Sleeper + ESPN + Yahoo is defensible **provided** users are told imported
leagues are read-only and that Decision OS/Legacy features are Sleeper-only today.

**Production readiness: 4 / 10.**
Held down by three structural issues, not by polish: imports don't reach Decision OS at
all, the highest-value output (history) has no delivery guarantee, and half the advertised
platforms don't work. Each is well-scoped and fixable — none requires re-architecture. The
foundation is sound; the wiring is not finished.

---

## Appendix — Key files

| Concern | File |
|---|---|
| Provider list (truth) | `lib/league-import/types.ts:8` |
| Adapter registry | `lib/league-import/importAdapterRegistry.ts` |
| UI availability flags | `lib/league-import/provider-ui-config.ts` |
| Adapter contract | `lib/league-import/adapters/ILeagueImportAdapter.ts` |
| Fetch dispatch | `lib/league-import/ImportedLeagueNormalizationPipeline.ts` |
| Orchestration | `lib/league-import/importOrchestrator.ts` |
| Canonical bundle | `lib/league-import/canonicalImportNormalizer.ts` |
| Commit / DB writes | `lib/league-import/ImportedLeagueCommitService.ts` |
| Audit + idempotency | `lib/league-import/importPersistenceService.ts` |
| Commissioner gate | `lib/league-import/commissionerGate.ts` |
| Backfill dispatch | `lib/league-import/ImportedLeagueCommitService.ts:260` |
| Decision OS ingestion (unwired) | `lib/decision-os/ingestion/*` |
| Architecture test | `__tests__/import-mapping-architecture-prompt22.test.ts` |
