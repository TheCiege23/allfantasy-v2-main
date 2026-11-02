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
