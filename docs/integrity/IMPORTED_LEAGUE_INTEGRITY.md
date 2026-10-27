# Integrity checks for imported leagues: what is covered, and what blocks the rest

Recorded 2026-10-27 from a read of the code. Nothing here was probed; no provider was called.
**Parked by the owner** until the privacy and capture questions below are decided.

## Covered today

| Check | Sleeper imports | ESPN | MFL | Fleaflicker | Yahoo | Fantrax |
|---|---|---|---|---|---|---|
| Collusion (completed trades) | ✅ `lib/integrity/scanImportedTrades.ts` | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tanking (weekly lineups) | ✅ NFL, see `lib/integrity/scanImportedTanking.ts` (PR #2815) | ❌ | ❌ | ❌ | ❌ | ❌ |

The collusion engine reads `ProviderTradeOffer`, and only Sleeper writes it. The tanking scan reads
`league_player_weekly_scores`, and only Sleeper writes it on a schedule. Fantrax writes it only
from a manual browser download.

## Why the other platforms are not covered yet

**One blocker is shared by every platform: the trade or lineup response has never been
captured.** A collusion or tanking flag names a manager, so it must not rest on a guessed response
shape. CLAUDE.md requires a capture via the contract's `scripts/probe.sh`, committed with the
change that reads it.

| Platform | Trades | Weekly lineups | What unblocks it |
|---|---|---|---|
| ESPN | Saved to `LeagueTrade`. **Likely one row per traded player** (contracts/espn/GAPS.md `T-02`). | Not fetched: no per-week lineup view is requested. | One capture of a multi-player trade and of a weekly lineup (`mBoxscore` / `scoringPeriodId`), from a league the owner chooses (cookies if private). |
| MFL | The parser exists, but **may drop every trade** (below). | Not fetched (`weeklyResults` is never called). | An MFL contract directory (there is none), then a capture of `TYPE=transactions` with a trade, from the owner's league (needs its API key). |
| Fleaflicker | The parser is built from Swagger docs and records only where assets went (contracts/fleaflicker/GAPS.md `G-13`). | Not stored. `FetchRoster` accepts `scoring_period`, and the committed fixture has per-player points, so this is the easiest lineup source. | The `G-07` privacy decision (whose league's activity may be published), then one transactions capture. Lineups need no new decision. |
| Yahoo | Fetched, but Yahoo import is **switched off**: Yahoo answers 403 until it approves the app (lib/league-import/provider-ui-config.ts). | Not fetched. | Yahoo's app approval. |
| Fantrax | Inferred from roster changes, deliberately never treated as completed trades. | Manual CSV only; the download needs a logged-in browser. | Not a candidate for automated checks. |

### MFL: suspected parser defect (unverified)

`parseMflTransactions` (lib/league-import/mfl/MflLeagueFetchService.ts) drops any transaction
without an `id` / `transaction_id`. It also reads players as a list with per-player `to_franchise`
and `from_franchise`.

From memory of MFL's API, a TRADE transaction has **no id field** and lists each side as
`franchise1_gave_up` / `franchise2_gave_up`. If that is right, every MFL trade is dropped before it
reaches `LeagueTrade`, and nothing reports it. This is not confirmed: the repo holds no MFL
transaction payload, fixture or parser test. Check it against a capture before relying on MFL
trades for anything.

## Sleeper NBA, MLB and NHL imports store no weekly data at all

Checked 2026-10-27 because tanking for these leagues was proposed. It is blocked earlier than
tanking:

- **No season calendar.** The sync only ingests weekly matchups and per-player scores while
  `isInSeason(seasonState)` is true (lib/import-os/collector/syncConnectedSleeperLeague.ts). The
  season state comes from `SPORT_CALENDARS` in lib/import-os/season.ts, which defines **NFL only**.
  Any other sport resolves to `unknown`, which is never in season, so an imported Sleeper NBA,
  MLB or NHL league never gets `WeeklyMatchup` rows or `league_player_weekly_scores` from the sync.
  The week numbers on that path also come from `nflWeekForDate`.
- **The live-points sync is NFL-only by design** (lib/live/liveSleeperPointsSync.ts).
- **The response shape is uncaptured.** `contracts/sleeper` has no `ENDPOINTS.yaml`, no fixtures and
  no `probe.sh`. Whether Sleeper's matchups for a daily sport say who started on EACH day, or only
  the lineup as it stands, is unknown. A daily-sport tanking check needs the per-day answer.
- **The lineup audit is NFL-only** (bye weeks from the NFL schedule).

This probably affects more than integrity: an imported Sleeper NBA league's matchup and score
screens have nothing weekly to read. That is inferred from the code, not observed in the app.

**What would unblock it, in order:**
1. Count the imported Sleeper NBA/MLB/NHL leagues. If there are none, nothing here is urgent.
2. Add NBA/MLB/NHL calendars and week mapping to lib/import-os/season.ts.
3. Create the Sleeper contract (ENDPOINTS.yaml + probe.sh) and capture one NBA matchups response.
4. Only then a per-day lineup reader and a tanking check.

## One more thing to check before building on any of this

Every scheduled sync of imported leagues runs only if `FANTASY_OS_EXEC_SYNC_LIVE === 'true'` on
the cron service (app/api/cron/fantasy-os-exec-sync/route.ts). The last recorded measurement says it
is on: docs/release-readiness/PHASE_0_RELEASE_BASELINE.md (item B11) found it `"true"` in Railway
production on 2026-09-05, with syncs running and `LeagueTrade` growing. An older line in the same
file says "shipped OFF". That measurement is seven weeks old and a setting can move, so read the
variable on the worker service again before building on it.
