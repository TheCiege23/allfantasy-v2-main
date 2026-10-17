# Tournament NBA/NFL live-slate sample audit

Captured 2026-10-13 with the configured project Rolling Insights accounts. The one-time capture used `/live/{Eastern date}/{sport}` with a millisecond cache buster and no-cache headers. Raw selected-game responses are local only under ignored `artifacts/tournament-provider-samples/`; the provider token and player rows are not in this report.

| Sport and slate | Entitled account | Full slate result | Saved example | Measured player-line status |
| --- | --- | --- | --- | --- |
| NFL 2026-10-11 | primary | 13 game rows, all final | One regular-season game, 69 flat `player_box.away_team/home_team.<playerId>` lines | 69 `ACT`; zero obvious DNP/inactive markers in the full slate's player boxes |
| NBA 2026-03-16 | secondary | 8 game rows, all final | One regular-season game, 22 flat `player_box.away_team/home_team.<playerId>` lines | 22 `ACT`; zero obvious DNP/inactive markers in the full slate's player boxes |

Local sample SHA-256: NFL `61a8003b4d13cbac3c09f7ecbb1d5f85620429845d9711ba3c4e6fcdc4ddf3d0` (captured 18:26:48Z); NBA `3de6217b6e6b4c6f390bd3c37e5a2a3f914c3bf6f697314fce3c54b8bbd6bea0` (captured 18:27:00Z). These hashes identify the locally saved selected-game JSON files, not the full 13- or eight-game slate.

The NFL example contains one line whose numeric stat fields are all zero. That is a **box line**, not proof of participation, a DNP or an authoritative zero fantasy score. The NBA example has no zero-minute line. Neither full slate exposes an obvious DNP/inactive marker in `player_box`; absence from these samples cannot establish the provider's policy for omitted players. A single historical fetch also cannot establish correction timing or closure. The vendor's [NFL API page](https://www.rolling-insights.com/datafeeds/nfl-api/) describes final player box scores but does not specify these outcome semantics.

The implementation therefore creates only `box_line_present` candidate receipts for uniquely matched locked player/game IDs in a final regular-season row. It never creates DNP, no-game, no-player, played, zero-point or complete-coverage claims from these samples. Every receipt remains `contract: unverified` and scoring remains blocked.

Still needed from the vendor: explicit meanings for `ACT`, omitted and zero-stat players; a DNP/inactive example in both sports; the full daily-game coverage and reschedule contract; a corrected-final before/after pair with revision or closure semantics; and the actual-start timestamp or an approved bounded-ordering policy. See `TOURNAMENT_COMPLETENESS.md`.

## Additional bounded probes, October 13

The same entitled accounts returned NBA 2026-03-17 (eight final games), NBA 2026-04-12 (15 final games), and NFL 2026-10-12 (one final game). No sampled full slate contained an explicit DNP/inactive string in `player_box`; this is an observation, not a completeness rule. Selected raw game rows remain only in ignored `artifacts/tournament-provider-samples/`.

| Example | Result | Local selected-sample SHA-256 |
| --- | --- | --- |
| NBA 2026-03-17 final box | 22 saved player lines, all `ACT` | `43e3c8f0ae4aa2061c8fb4235d4afe3b2f007a05924f867cfba83611ac993699` |
| NBA 2026-04-12 final box | A refreshed sample includes one `ACT` line with `minutes: "0"` and 17 numeric stat fields at zero; player-line digest `d2953c6fe69e5b59bf9316c4f79257aa98eb816446a219d0dd690f4422555ee1` | `39f7ac726bc311d9142a540e2e4d068cbdeac645acb0275dd4152e9ed404993a` |
| NFL 2026-10-12 final box | 68 saved player lines, all `ACT` | `d15a74d469ceef5579018c12255a6fcc86f608528fafca09428268468fb93f49` |
| NFL 2026-10-11 final box | One `ACT` line has its two present numeric stat fields at zero; no minutes field is present | `61a8003b4d13cbac3c09f7ecbb1d5f85620429845d9711ba3c4e6fcdc4ddf3d0` |

The refreshed selected NFL 2026-10-11 and NBA 2026-03-16 game rows were identical to their earlier captures, roughly four hours apart. Their row digests remained `b23f740c6758e174ec08719f1ef917e30aa70ecde087a845cc9c8d4760373195` and `745f34dc14b7d15d6b71e3bd3696a8821ec083a2e6704c5437098bded84b3e41`. This is **not** a corrected-final example. NBA 2026-09-01 returned HTTP 304 from the entitled account; the client cannot interpret that as an authoritative no-game or player no-game outcome. NFL 2026-10-13 also failed the fresh-slate capture rather than returning a usable empty slate.

The [provider's public overview](https://rolling-insights.com/datafeeds/) says it checks for corrections during the 12 hours after a game finishes and recommends a 5–10 second delay between API calls. It does not establish a version marker, a final closure signal, how omitted players or `ACT` with zero minutes should be interpreted, or whether a 304 represents an empty day. Those rules require written vendor confirmation and explicit before/after and DNP examples. The new bounded capture worker therefore saves only `box_line_present` candidates and remains disabled by default.
