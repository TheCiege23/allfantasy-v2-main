# CFP and NBA Cup Bracket Leagues

This draft builds on the existing playoff challenge tables and Railway app. It adds finalized entry state, a first-game deadline, matchup research, season-wide results, and two leaderboard levels.

## Player flow

1. Create or join a CFP or NBA Cup league. The admin publishes the official field and a complete schedule with each game's name, start time, venue, and location. Brackets auto-fill from that published field.
2. Tap any matchup to open a full-screen view with the round, bowl/game name, time, venue, verified season record, win rate, point differential, and a transparently labeled Chimmy estimate. Unavailable facts show as unavailable. Chimmy's Choice picks the higher estimated team when enough data exists.
3. Pick all winners, enter a final-game combined-score guess, and click **Finalize picks**. Editing a pick moves the bracket back to Draft. The user can revise and finalize again until the first scheduled game starts. All picks and finalization lock together at that instant.
4. Invite friends and share a read-only entry. Opponents' picks reveal only after their games begin. Private leagues require membership to view shared entries.
5. Watch pool and universal boards. Each finalized entry shows earned points, potential total, correct picks, and rank. Potential counts only saved picks whose teams have not been eliminated.

## Competition rules

| Tournament | Field | Round points | Maximum |
| --- | ---: | --- | ---: |
| CFP | 12 teams, 11 games | First round 1; quarterfinal 2; semifinal 4; title 8 | 28 |
| NBA Cup | 8 teams, 7 games | Quarterfinal 1; semifinal 2; title 4 | 12 |

Ties are broken by closest predicted **combined championship score**, then more correct picks. Exact ties share a rank. Potential is shown for suspense and never breaks ties. The final-score guess stays private until the final is decided.

The 2026-27 CFP bowl sites are Fiesta, Cotton, Peach, Rose, Orange, and Sugar, but a specific bracket slot's bowl assignment is entered with the official schedule; it is not guessed or hardcoded. The CFP states that the No. 1 seed chooses its quarterfinal and potential semifinal site. See [official bracket and schedule](https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder). The NBA Cup uses four knockout qualifiers per conference and seven elimination games; see [NBA Cup format](https://www.nba.com/news/nba-cup-101).

## Capacity and money boundary

Confirmed cap: **one free bracket per user per tournament season**; **five total** with an active AF Pro entitlement (including Supreme, which bundles Pro). AF Commissioner alone does not increase the cap. A commissioner can set a lower per-league cap. Extra capacity is an app subscription benefit, not a contest stake, league pot, or entry fee. There is no bracket-specific checkout in this PR.

AllFantasy offers **no prizes, gambling, betting, bracket entry fees, or in-app payouts**. Commissioners handle any optional external arrangements independently. The repository's existing legal copy currently names FanCred for paid league dues, so broader third-party wording needs product/legal reconciliation before public launch.

## Operations on Railway

- The Prisma migration adds `finalized_at` and `tiebreaker_total_score` to `playoff_bracket_entries`. Run it with the repository's guarded production migration flow; never run bare `prisma migrate deploy` against production. Follow `AGENTS.md` and `CLAUDE.md`.
- Build using the repository's Railway build/start scripts. Vercel status checks do not represent the user's deployment path.
- Publish CFP committee seeds at `/admin/cfp-seeding` or NBA Cup qualifiers at `/admin/knockout-brackets`.
- Publish all game start times plus names, venues, and locations at `/admin/knockout-brackets`. The server opens picks only when the field and complete schedule are available.
- Publish each verified final once for the season at `/admin/knockout-brackets`. The new season result route rejects conflicting league matchups and updates every matching league together. Existing per-pool result entry remains available for support.
- Admins can map each bracket game to a numeric ESPN event ID at `/admin/knockout-brackets`. IDs may be added as later round teams are known; a final game's mapping is locked. Unmapped games remain manual.
- `POST /api/cron/season-bracket-results` accepts `{ "sport": "ncaaf" | "nba_cup", "season": 2026, "apply": true }` with `CRON_SECRET`. It dry-runs unless Railway also sets `BRACKET_AUTO_RESULT_SYNC_ENABLED=true`. After staging verification, create a separate Railway cron service from this repository with start command `node scripts/railway-bracket-results-cron.mjs` and schedule `*/15 * * * *`. Set `BRACKET_SYNC_URL` to the app private URL and reference the app `CRON_SECRET` as a Railway variable. The app service must remain a web service.
- The worker fetches ESPN's date scoreboard by mapped event ID. It requires exactly one matching event, both bracket teams (including safe ESPN display/location aliases), a kickoff within two hours of the published schedule, final status, unequal integer scores, and the correct CFP postseason or explicit ESPN NBA Cup marker and calendar season. It handles ESPN's neutral-site home/away reversal before publishing through the same cross-league guard as the admin route. Mismatches are reported and need manual review.
- Do not label seed heuristics as a trained prediction model.

## Engagement improvements

1. **Friends-first home:** show “your rank vs friends,” two closest rivals, and invite progress immediately after finalization. One tap copies a league invite.
2. **Game-day return loop:** notify users when a matchup starts, when a pick resolves, and when their potential changes. Each alert should deep-link to the matchup or board.
3. **Chimmy explainability:** show the exact standings date and reason for a suggestion; invite the user to disagree. Later, replace heuristic estimates only when a validated model and calibration data exist.
4. **Bracket story cards:** generate shareable, spoiler-aware images for bold picks, upset survival, and leaderboard moves. Hide unrevealed picks.
5. **Commissioner pulse:** show finalized/draft counts, the next kickoff, missing schedule fields, and a one-click external invite; never include dues or payout tracking inside AllFantasy.

## Verification

Focused tests cover tournament shape, seed and schedule validation, first-game deadline, potential after elimination, and tied ranks. This draft requires TypeScript/unit CI and a Railway staging flow test before merge. The local F: project drive was unavailable to the runner, so local runtime verification was not possible in this task.
