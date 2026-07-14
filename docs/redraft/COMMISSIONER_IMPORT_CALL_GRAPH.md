# Commissioner Import — Real Call Graph

Re-traced fresh this phase (not assumed from the prior handoff), reflecting
the state after this phase's wiring change.

## User-reachable Sleeper path (as of this phase)

```text
app/import/page.tsx
  -> components/unified-import-ui/LeagueImportFlow.tsx (tab = 'sleeper')
     -> username input -> discoverSleeperLeagues()
        -> discoverProviderLeagues('sleeper', username)  [lib/league-import/LeagueCreationImportSubmissionService.ts]
           -> POST /api/leagues/import/discover
              -> lookupSleeperUser() + getUserLeagues()  [lib/sleeper/user-lookup.ts, lib/sleeper-client.ts]
              -> real Sleeper API (keyless)
     -> click a discovered league -> selectDiscoveredSleeperLeague(sourceId)
        -> runPreview('sleeper', sourceId)
           -> fetchImportPreview('sleeper', sourceId)
              -> POST /api/leagues/import/preview
                 -> assertImportCommissioner (membership gate, not full-commissioner-required at preview)
                 -> getSleeperImportPreview() -> runImportedLeagueNormalizationPipeline()
     -> "Import League" button -> handleCommit()
        -> submitImportCreation('sleeper', sourceId, ...)
           -> POST /api/leagues/import/commit
              -> assertImportCommissioner({ requireCommissioner: true })   [server-derived, never client-trusted]
              -> runImportedLeagueNormalizationPipeline()
                 -> SleeperLeagueFetchService.fetchSleeperLeagueForImport()  [real Sleeper API]
                 -> SleeperAdapter.normalize()  [SleeperLeagueMapper, SleeperRosterMapper, etc. — status fix landed this phase]
              -> buildCanonicalImportBundle()
              -> persistImportWithCanonicalAudit()
                 -> persistImportedLeagueFromNormalization()  [ImportedLeagueCommitService.ts — real transaction: League, LeagueTeam, Roster, ImportRun rows]
              -> 201 (new) / 200 (replay) with { leagueId, name, sport, replayed }
     -> router navigates to the real league via LegacyImportResults 'league_created' variant -> "Open league" link -> /league/[leagueId]
```

This is the same pipeline ESPN/Yahoo/Fantrax/MFL already used before this
phase — Sleeper was the only tab bypassing it. No fourth parallel
implementation was created; the existing `SleeperLeagueCreationBootstrapService`
(consumed transitively via `ImportedLeagueCommitService.ts`) and
`/api/leagues/import/commit` remain the sole reuse targets, confirmed correct
by this phase's physical execution.

## Downstream connections (fresh-verified this phase, real database evidence)

```text
League (canonical, real)
  -> Dashboard (getDashboardLeagueListForUser)             CONFIRMED, after this phase's status-field fix
  -> Manager OS (resolveManagerIntelligencePayload)         CONFIRMED, real trend data returned
  -> Commissioner OS (same internal API as Manager OS)       source-verified only this phase; UI defaults to demo mode (DECISION_OS_BASE_URL unset in this environment)
  -> Rankings (lib/rankings-engine/league-rankings-v2.ts)    NOT CONNECTED — reads legacyLeague/legacyRoster, a separate table family populated only by the legacy career-history path
  -> Decision OS Waiver (loadWaiverWorldFacts)                CONFIRMED, real facts returned (Roster.platformUserId matches this commit's write shape)
  -> Decision OS Trade (loadTradeWorldFacts)                  BLOCKED — requires a RedraftSeason.id; plain league import never creates one (only draft-completion/renewal do)
```

## Legacy career-history path (unchanged, deliberately not touched)

```text
components/rankings/LegacyRankingsImportPanel.tsx
  -> useLegacySleeperImport hook
     -> POST /api/import-sleeper (isLegacy: true) or /api/legacy/import
        -> lib/legacy-import.ts importLeague()
           -> writes LegacyLeague / LegacyRoster / LegacySeasonSummary only
```

This remains the real, separate product surface Rankings' primary read path
(`league-rankings-v2.ts`) consumes. It was not merged into, or removed from,
the commissioner-import flow.
