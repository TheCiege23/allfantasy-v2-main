# Licensed market ADP imports

Admin screen: `/admin/adp-import`, linked from the admin dashboard. Choose the expected sport, season, format and scoring, upload a JSON export or paste it, then select **Validate export**. Validation writes no observations. Review the accepted player count and source/date before selecting **Import validated export**. Editing the context or replacing the file requires validation again.

Admin endpoint: `POST /api/admin/fantasy-data/adp-import`. Requires the existing authenticated admin session. No public or commissioner write access.

Send `{ "dryRun": true, "expected": { "sport": "NBA", "season": 2026, "format": "redraft", "scoring": "points" }, "board": { ... } }`. Review the accepted count, then send the same request with `dryRun: false` to import. No production import has been performed by this build.

Board example (replace fixture IDs with verified `SportsPlayer.id` and licensed provider IDs):

```json
{
  "evidenceType": "observed_drafts",
  "licensedForUse": true,
  "sport": "NBA",
  "source": "licensed-export",
  "season": 2026,
  "format": "redraft",
  "scoring": "points",
  "asOf": "2026-09-27T15:00:00Z",
  "players": [{
    "canonicalPlayerId": "canonical-player-id",
    "providerPlayerId": "provider-player-id",
    "playerName": "Player Name",
    "position": "PG",
    "team": "BOS",
    "adp": 12.5,
    "draftSampleSize": 40
  }]
}
```

Supports NFL, NBA, NHL, MLB, NCAAF, NCAAB and SOCCER, with independent redraft/dynasty and scoring contexts. Supply exact league scoring labels; football aliases are normalized by the draft reader. The importer requires observed drafts, licensed use, matching context, positive finite ADP, positive sample size, unique canonical/provider IDs, canonical name/position matches, and an observation date within seven days (maximum five minutes future clock tolerance).

An import replaces one source/context/week atomically and refuses an observation older than the existing source board. Provider player IDs and per-player sample counts are preserved in the import run quality summary. The row date remains the observation date, not the import execution date. Rankings, projections and AI estimates are rejected. A successful dry run or import does not independently establish a vendor license; the uploader must have rights to the supplied export.

A licensed export must be supplied before any missing market data can be populated. API availability and commercial rights are separate from the import path: [FantasyPros public API documentation](https://api.fantasypros.com/public/v2/docs), [API access guidance](https://support.fantasypros.com/hc/en-us/articles/49749297704475-How-do-I-request-access-to-the-FantasyPros-API).
