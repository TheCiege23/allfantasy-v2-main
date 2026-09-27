# Seven-sport draft data and browser build — 2026-09-27

Scope: NFL, NBA, NHL, MLB, NCAAF, NCAAB and SOCCER. Work includes imported ADP accuracy, canonical player/team assets, observed statistics and projections, draft chat, AI manager, Chimmy grounding, Draft OS, Decision OS, draft-room visuals and complete authenticated journeys.

## First implemented repairs

- Decision OS's shared ADP resolver reused a single first-sport placeholder filter across all sports. It now caches independently per database client and sport, expires after five minutes, and retries after a failed read.
- Shared ADP and draft-room source averaging now reject zero, negative and nonfinite draft positions before they influence values. Seven sport regressions exercise the same production loader.
- The existing asset browser journey now has seven sport cases with appropriate positions and team abbreviations: details, queue, HTTP-403 headshot fallback, logo element and pick-to-board updates. API fixtures isolate UI behavior; this is not live market or identity certification.

Validation: four new resolver cases failed before repair; seven draft-pool averaging cases failed before repair. After repair, the ADP suites pass 38 tests. Existing chat, Chimmy grounding, live draft brain and image-consumer suites pass 50 tests. Browser discovery lists seven cases; browser execution and type ratchet results will be recorded separately.

## Acceptance still required

| Area | Required evidence |
| --- | --- |
| Imported ADP | Current season, board format/scoring, source, as-of date, matched identity, missing/placeholder refusal; validate actual stored boards for all seven sports. |
| Internal AI ADP | Keep separate from market ADP; show sample confidence and draft context; no inferred market claims. |
| Headshots/logos | Exact player identity and current team; distinguish synthetic fallback from verified photo; render reachable images on cards, details, queue, board and pick chat. |
| Stats | Observed season and source, valid sport metrics, explicit missing coverage; label projections distinctly and ground AI with the same data. |
| Draft chat | Persisted authorized membership, send/read/reconnect, pick cards, attachments, private/public boundaries and error recovery. |
| AI manager/Chimmy | Authorized actions, legal roster/pool choices, consistent draft context, missing-data behavior, grounded explanations and pick persistence. |
| Draft OS/Decision OS | Shared player identity/data provenance; queued/drafted exclusion, roster eligibility, sport-specific scoring, recommendation and action consistency. |
| Browser lifecycle | Login, creation, settings, roster assignment, start, search/filter, assets/stats, queue, actual picks, chat, AI help, reconnect/pause/autopick, finalization for each sport; auction separately. |

ADP is a market draft-position observation, while rankings and projections describe different quantities. References checked for this build: [FantasyPros terminology](https://support.fantasypros.com/hc/en-us/articles/115001316147-FantasyPros-Terminology-and-Acronyms), [2026 MLB ADP](https://www.fantasypros.com/mlb/adp/overall.php?year=2026), [2026–27 NBA ADP](https://www.fantasypros.com/nba/adp/overall.php). An available market for one sport is not evidence of comparable coverage for another.

Production database access remains read-only. Guarded known-test-database journeys may create and clean fixtures. No production backfills or provider response-shape probes are part of this build.

Read-only inventory at 2026-09-27 14:54 UTC: `adp_data` contains imported boards for NFL only. The `sports_players` cache has no positive ADP or stored photo/logo values for the other six sports, while the separate `SportsPlayer` identity table does have image candidates (NBA 1,585; NHL 2,267; MLB 1,937; NCAAF 5,985; NCAAB 63; soccer 2,127). These are raw table counts, including duplicate/historical identities, and other stat/enrichment stores may supplement them. They do not certify absent media or statistics in the resolved pool. The inventory used a verified read-only transaction, rolled back, and sent no provider calls. The reusable inventory script is `scripts/audit-draft-data-quality-readonly.cjs`.

TypeScript ratchet: 143 existing errors against baseline 143, no regressions. Browser execution is in progress; an isolated-checkout readiness failure has not been counted as a passed journey. Provider selection for non-NFL market ADP remains unresolved; estimates and internally generated draft rankings must remain distinct from observed market ADP.

Seven-sport UI execution passed all seven cases in three minutes (`artifacts/seven-sport-browser-snapshot-run-final.log`). Each case exercises details, queue addition, drafted-board update, a requested HTTP-403 headshot and visible fallback, plus an image element with successfully decoded synthetic logo content. This uses mocked APIs and blocked database connections; the synthetic image is not an actual team-logo identity check. Real authenticated database journeys are being developed and run separately. Temporary Next loader changes were confined to verification and restored in the isolated release checkout.

Authenticated native-route verification: NFL, NBA, NHL, MLB, NCAAF and NCAAB passed in the initial run; soccer passed its rerun after the harness supplied the required European pipeline choice. Every successful case verifies real credentials login, unauthorized creation refusal, sport-specific creation, queue readback, persisted chat, four commissioner picks, completed session, four finalized rosters, board rendering and reload persistence. Exact league/user cleanup assertions run in finally. The guarded known test database is required; synthetic cached players and one-round drafts isolate lifecycle behavior. This is not full-depth draft or live feed certification. Logs: `artifacts/seven-sport-native-browser-run.log`, `artifacts/seven-sport-native-soccer-rerun.log`.

Chimmy now resolves the authenticated viewer's roster through the draft room ownership helper before calculating the next turn. Thirteen grounding cases pass, including distinct AppUser/roster IDs, failed ownership reads and an unowned supplied roster ID. TypeScript ratchet remains 143/143 with no regressions; exact changed database and decision boundaries pass. Live AI provider responses remain unverified; the native journey logs include exhausted providers/timeouts.
