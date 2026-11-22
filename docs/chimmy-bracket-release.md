# Chimmy bracket release

## Covered results

- Tournament pool leaderboard score and rank changes.
- World Cup bracket score, rank, and correct or incorrect pick totals.
- Playoff series decisions from provider sync, NBA Cup and NFL sync, published finals, and audited manual CFP or NBA Cup finals.
- A first stored result establishes a baseline. Alert delivery starts only after a later change and an entry owner's opt-in.

## Staging check

1. Use an authenticated staging account with its own submitted tournament, World Cup, and playoff entries. Turn on result alerts on each entry page; verify another account receives a 404 when requesting that entry's alert setting.
2. Apply a controlled result update through the staging result workflow. Confirm the scoring write succeeds before an in-app notification appears. Confirm disabled entries and unchanged reruns remain silent.
3. Open the notification, send its prefilled question, and confirm Chimmy states the exact saved before-and-after values and the result timestamp. Apply a second result, then reopen the first notification: its answer must still explain the first result.
4. Check one provider or admin result path per format, including an NBA Cup final. Verify the link points to the authenticated entry and never reveals another owner's picks.
5. Run `npm run chimmy:bracket-adoption -- 14` against the staging database to inspect aggregate CTA clicks, opt-ins, alert opens, questions, successful answers, and feedback by source. No user IDs or prompt text are printed.

The per-entry history keeps the newest 20 changes. An older reference expires cleanly; Chimmy says it cannot verify that change rather than substituting a newer one.

## Runtime and release checks

- Use Node 24 from `.nvmrc` for the application and CI. Keep the existing TypeScript and test ratchets; do not raise their baselines to accept release regressions.
- Live Deep verification requires `AI_FEATURES_ENABLED=true` and a configured provider. The tool loop preserves Claude, Grok, and DeepSeek priority and supports OpenAI as the final fallback or an explicit `CHIMMY_TOOL_LOOP_PROVIDER=openai` pin.
- Run the isolated staging fixture script with `CHIMMY_STAGING_PROJECT_ID=b3cd0239-9cb1-4c22-9d76-533d91d26f36`: `tsx scripts/qa/chimmy-bracket-release-fixture.ts setup <run-label>`. It verifies the QA identity and source pool before creating a separate pool. `inspect <run-label>` reports only that fixture's saved history and notifications. Confirm two distinct finals produce two records, an unchanged rerun adds none, and the entry with alerts off remains silent.
- After deployment, check owner access, alert links, provider errors, and failed result writes. Roll back to the previous application commit if a critical flow fails; no database migration is required. History stays in user-profile JSON and requires no schema rollback.

## Seven-sport coverage checks

- The staging backfill command is `node --require ./scripts/_audit-preload.cjs --import tsx scripts/qa/backfill-chimmy-sports-history.ts backfill-staging YYYY-MM-DD YYYY-MM-DD`. Use the isolated staging database and the bracket staging project marker above. Each run accepts at most 367 UTC days. It inserts only completed ESPN events with both scores and leaves existing provider event rows intact.
- The staging archive includes 13,516 verified finals from calendar 2024 and 13,647 from calendar 2025. ESPN's soccer path covers MLS. The college queries use the app's selected college groups. These counts cover game results, while player box scores and league-scored fantasy history use separate sources and coverage.
- Run `node --require ./scripts/_audit-preload.cjs --import tsx scripts/qa/audit-chimmy-live-scores.ts 120` with read-only access to the target scoreboard during an active game. The observer reports a confirmed change only when the provider score changes and a recently written scoreboard row matches it. An empty in-progress slate does not complete this check. For a confirmed change, query Chimmy for that exact matchup and compare the stated score and observation time with the row.

## Thursday Claude checks

Validate the prepared inputs with no model requests:

```sh
node --import tsx scripts/qa/chimmy-claude-smoke.ts scripts/qa/chimmy-claude-cases.json
```

After a valid Claude credential is active on the isolated staging app, set the staging QA gateway and app credentials in the runner environment and append `--run`. The runner verifies the staging account and stops at the first failure. The model cases require HTTP 200, a successful Claude response, the expected tools, and the expected facts. Decision cases require the expected free engine result, gap code, league, and facts. A provider fallback or spend preview fails the relevant check. Review the answer in the staging UI for directionality and timestamps.

| Case | Evidence to prepare and verify |
| --- | --- |
| Published rule conflict | The staging QA league has a stored deadline in week 10 and published policy in week 9. The answer must cite both sources and identify the discrepancy. |
| Locked lineup | In a QA league with two rostered options, use a starter with a verified locked slot and an eligible alternative. Verify that the answer cites the lock and never recommends swapping out the locked starter. |
| Trade | Use two identifiable rostered players from opposing QA teams and a complete offer. Compare Chimmy's grade and roster impact with the league trade engine. No offer should be sent. |
| Current real score | Use a matchup confirmed by the observer, then ask for the score, leader, and observation time. Check the most recent verified scoreboard row immediately before grading the answer. |
| Historical real result | Use the staged November 1, 2025 UTC MLB result. Confirm Los Angeles won 3–1 and that both clubs and the date are correct. |
| Exact bracket alert | Use the first saved CFP result reference after the second result exists. Confirm the answer describes QA Harbor vs. QA Metro, then replay the second reference and reopen the first. |

Run the locked-lineup and trade cases after the QA league has verified rosters, applicable scoring and a usable scoring period. Do not use a no-data response as a pass for either positive case.

### Populated decision fixtures

Run `node --require ./scripts/_audit-preload.cjs --import tsx scripts/qa/seed-chimmy-decision-leagues.ts` with the isolated bracket staging database and project marker before the paid run. The script verifies the fixture account, refreshes the synthetic kickoff and weekly projections, then asserts outputs from the regular Chimmy tools.

- The NFL PPR fixture has a started WR, an injured-reserve WR, an eligible bench WR, and an opposing roster. A proposed player-for-player exchange changes the fixture week-nine starting total from 14 to 16. The chart has no market prices for the synthetic players, so the answer must withhold a grade. This is a read-only evaluation of a hypothetical offer.
- The NBA fixture has nine stored categories and populated opposing rosters. It verifies IR eligibility and truthful trade coverage limits. A positive category lineup comparison still requires an eligible current slate and linked current-season game logs. A positive category trade grade requires a supported category valuation model.
- Run `node --require ./scripts/_audit-preload.cjs --import tsx scripts/qa/audit-chimmy-history-coverage.ts` for aggregate player game-log identity and finalized fantasy-score coverage by source and season. NFL uses Sleeper identity keys, college football uses named CFBD season rows, and daily sports use the Rolling Insights registry keys. Yahoo league scores are excluded.
- On November 3, 2026, the reader keys covered all sampled Rolling Insights rows for NBA, college basketball, NHL, MLB, and soccer. They did not cover 3,241 NFL rows from 2023–2025 or 7,386 college football rows from 2026. These are row counts, not distinct players. NFL and college football require separate identity fixes.
- Older player-log coverage was uneven. Of the daily sports, college basketball and soccer had 2025 rows. NBA, NHL, and MLB only had 2026 rows in the audited window. Sleeper had finalized league-scored player rows for 2023–2025. The audited Fantrax weekly player rows were 2026 provisional data.

### Historical identity recovery and NBA category comparison

- Chimmy's NFL game-log reader can use an exact stored Sleeper ID from the player feed when the central identity registry has no matching ID. The college football reader can use the exact named CFBD athlete ID on the stored game row when its season-total row is missing. Both readers retain same-name disambiguation. These are read-path fixes and do not rewrite historical stat rows.
- Run `node --require ./scripts/_audit-preload.cjs --import tsx scripts/qa/verify-chimmy-nba-categories.ts` after seeding the isolated NBA QA league. It exercises the real season calendar, ranked schedule, roster identity, game logs, and category comparison. The fixture verifies different leaders for points, assists, and field-goal percentage and removes its temporary schedule and game logs.
