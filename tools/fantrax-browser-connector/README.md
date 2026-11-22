# AllFantasy Fantrax Score Connector

Operator preview for Chrome. The connector downloads every team for selected
completed weeks through the commissioner's existing Fantrax login. Chrome attaches
the session directly to Fantrax requests; the connector never extracts or stores
cookies or sends them to AllFantasy. Fantrax explicitly rejects this endpoint
without login (`WARNING_NOT_LOGGED_IN`), even when HTTP status is 200.

## Install after the API release is live

1. Review this folder's source and permissions. It can access Fantrax and
   `www.allfantasy.ai`; no other hosts or cookie/storage permissions are requested.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select this folder. Installation is a user action because it grants access
   to the two sites. Do not send session cookies to an operator.
3. Sign in to Fantrax and AllFantasy, and reload the AllFantasy tab so the bridge
   script is present. Keep both tabs open.
4. Click the extension, enter the AllFantasy league UUID, and **Load completed weeks**.
5. Choose the latest two weeks or all supported completed weeks. Click
   **Download and verify scores**, review the counts, then **Import verified scores**.
   Keep the popup open throughout. Closing it interrupts the workflow.

## Scope and validation

- Supports the captured **2026 NCAAF** actual-week contract, from September 1.
  Other seasons need their opaque Fantrax season code verified. It does not claim
  pre-September coverage or unattended server access.
- Only the AllFantasy league owner may import. A fresh source calendar, roster
  and team total validate each export. Projections, wrong lineups, missing rows,
  malformed scores, other sources and finalized corrections fail closed.
- At most 24 teams per week; downloads are sequential. Login expiry or a rate
  limit stops the run. Repeat runs preserve identical scores.
- Each week commits independently. Failures report earlier committed weeks.
  Backup receipts, export hashes and source zero evidence are stored in the same
  transaction. No published team result, winner or provider stat is rewritten.
- The extension requires a commissioner action for a sync. It eliminates manual
  team-by-team exports; it is not a scheduled unattended sync or a Chrome Store release.

## Trades, claims and drops (0.2.0)

**Sync trades, claims and drops** downloads the league's Transaction History with the
commissioner's Fantrax login and saves it to AllFantasy. Fantrax's public API has no
transactions endpoint, so until now trades came from a CSV uploaded by hand and adds and
drops were inferred by comparing rosters.

- Any sport. The signed-in AllFantasy user must be the league's commissioner.
- Two downloads, one per tab: Trade and Claim/Drop. Each is the page's own
  "Download all as CSV" request and nothing else; any other address is refused.
- Each file is checked for its own columns before it is sent. A login page, an error
  body or the other tab's file is refused.
- Trades go through the existing trade-history importer. Claims and drops are saved as
  completed moves with the team, the player, the winning bid and Fantrax's time.
- A row whose team or player cannot be matched is reported and not saved. The export
  has no player ids, so players are matched by name, club and position.
- Running it again is safe: a move already saved is left as it is.
- It is a click, not a schedule. Nothing runs in the background.

Known limits: the Claim/Drop download was captured from a real request; the Trade
download is assumed to take the same parameters and is refused if it returns anything
but the Trade columns. The one captured Claim/Drop export of an 11-week season started
in week 10, for a reason not yet known, so a sync must not be read as the league's whole
history (`contracts/fantrax/GAPS.md` F-19).

## Transport evidence

Captured 2026-10-07 in Chrome Network from a real actual-week export:
`https://www.fantrax.com/fxpa/downloadTeamRosterStats`, method GET, parameters
`seasonOrProjection=SEASON_50t_BY_PERIOD`, `timeframeTypeCode=BY_PERIOD`,
`period=4`, `view=STATS`, `statsType=1`, `scoringCategoryType=5`,
`adminMode=false`, `lineupChangeSystem=EASY_CLICK`, `daily=false`, `origDaily=false`,
league and team IDs, `startDate=2026-09-01`, `endDate=2026-10-07`.
Date envelope advances with the Eastern date; exact period/team evidence is
rechecked before any import. No private endpoint parameters are inferred from NHL.

Authenticated browser end-to-end verification is still required after the
extension is installed; fixture tests do not prove the browser's session is sent.
