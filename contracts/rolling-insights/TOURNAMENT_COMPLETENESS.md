# Tournament feed completeness questions

Status: **unverified vendor contract**. This is an acceptance checklist for NFL/NBA tournament scoring, not a claim about Rolling Insights behavior.

The public [NFL API page](https://rolling-insights.com/datafeeds/nfl-api/) and [plans page](https://rolling-insights.com/datafeeds/price-plans) describe live and final box scores. They do not specify whether a final player box contains every active, inactive, DNP, and zero-minute player or how to distinguish an omitted line from a scored zero. The committed `fixtures/live.NBA.json` sample has seven games and 145 player lines; all 145 carry `status: "ACT"`. It cannot establish DNP semantics or full-season coverage. No measured NFL `/live` fixture is committed here.

Before enabling a scoring worker, obtain vendor-written semantics and captured corrected examples for:

1. **Game coverage:** Does `/live/{Eastern date}/{sport}` return every regular-season game on that date, including postponed, canceled, replacement, and subsequently corrected games? What is the authoritative end-of-corrections signal?
2. **Player outcomes:** In a final NBA and NFL game, are active players with zero statistics, zero-minute players, inactive players, and DNPs included in `player_box`? Supply the exact `status` enumeration and an explicit no-game/DNP outcome when a player has no box line. Absence alone cannot mean zero.
3. **Identity:** Are `player_box` object keys stable player IDs for both sports, and are `game_ID` values stable across reschedules? Supply examples where IDs change and the replacement relationship.
4. **Corrections:** Which revision, timestamp or ETag changes when a previously final player line changes? Are full historical daily snapshots available after correction? How long should clients poll?
5. **Start time:** Is there an actual kickoff/tipoff UTC timestamp, distinct from scheduled `game_time`? Supply postponement and late-start examples.
6. **NBA discipline:** Which player-attributed source supplies technical and flagrant foul counts and revisions? A team or unattributed event cannot satisfy enabled player penalties.

Acceptance requires saved raw examples for final-with-zero, DNP/inactive, postponed/replaced, corrected-final, and at least one NFL per-game player box. Until then the Hub may show coverage gaps, but `completeGameAndPlayerCoverageVerified` and scoring remain false.

The server now has an append-only candidate outcome ledger for DNP, no-game, and no-drafted-player claims. Its receipt retains the raw source artifact, its checksum, frozen league/period binding, request ID, revision, and previous-revision digest. A later played/game-expected/drafted-players-expected claim can correct a candidate without deleting it. This is internal trusted-source intake only; the Hub displays aggregate candidate counts. Candidate claims have a fixed `unverified` source contract and cannot close coverage or score points. Do not promote them until the vendor-written semantics above and representative NBA/NFL correction examples are validated.

The October 13 one-time NFL/NBA live-slate findings are in `TOURNAMENT_SAMPLE_AUDIT.md`. They support only the structural `box_line_present` candidate, not played/DNP/no-game outcomes. A bounded internal daily capture can now save up to ten uniquely matched positive box-line observations per run after schedule drift checks; it is not a scheduled or public scoring worker.

Additional October 13 probes found an NBA final `ACT` player line with `minutes: "0"` and all 17 present numeric stats at zero. This does not establish participation, DNP, or fantasy points. No DNP/inactive marker or changed final row appeared in the sampled slates, and an off-day NBA `/live` request returned HTTP 304 rather than a confirmed empty list. The public [DataFeeds overview](https://rolling-insights.com/datafeeds/) states that corrections are checked for 12 hours after a game; it does not promise a client-visible closure signal or define the player completeness rules. Request a written interpretation of the zero-minute `ACT` example, explicit DNP/inactive and no-game examples for both sports, and a corrected-final pair with a revision marker before certifying any negative outcome.

An owner-authenticated, environment-gated one-day worker now connects positive final box-line capture to the append-only candidate ledger. It uses a shared lease, writes at most ten receipts, resumes from prior artifacts, and keeps candidate outcomes unverified. It is disabled unless `TOURNAMENT_EVIDENCE_WORKER_ENABLED=true`; no cron or score ingestion is attached. A scheduled production poller still needs demonstrated cross-worker lease behavior and staging database contention tests.
