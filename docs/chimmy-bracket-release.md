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
- After deployment, check owner access, alert links, provider errors, and failed result writes. Roll back to the previous application commit if a critical flow fails; no database migration is required. The saved history remains compatible with the previous single-record reader's expiry behavior.
