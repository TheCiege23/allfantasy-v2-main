# CFP and NBA Cup Bracket Leagues

This draft builds on the existing playoff challenge tables and Railway app. It adds finalized entry state, a first-game deadline, matchup research, season-wide results, and two leaderboard levels.

## Player flow

1. Create or join a CFP or NBA Cup league. CFP uses its published official field. NBA Cup automatically imports explicitly labelled Cup games through the Railway schedule sync: Group Play first, then confirmed knockout matchups. Each game includes real teams, time, venue and city when verified. Unconfirmed slots stay pending without blocking other games.
2. Tap any matchup to open a full-screen view with the round, bowl/game name, time, venue, verified season record, win rate, point differential, and a transparently labeled Chimmy estimate. Unavailable facts show as unavailable. Chimmy's Choice picks the higher estimated team when enough data exists.
3. Pick winners, enter a final-game combined-score guess, and click **Finalize picks**. CFP retains its first-game deadline and Draft reset on edits. NBA Cup accepts late entrants: each game locks at tipoff, missed games earn zero, and finalization requires only currently available games. After the first finalization, upcoming pick edits save automatically without clearing earlier locked picks or earned points. A first submission after tipoff cannot score an earlier draft pick. The championship score guess locks at its tipoff.
4. Invite friends and share a read-only entry. Opponents' picks reveal only after their games begin. Private leagues require membership to view shared entries.
5. Watch pool and universal boards. Each finalized entry shows earned points, potential total, correct picks, and rank. Potential counts only saved picks whose teams have not been eliminated.

## Competition rules

| Tournament | Field | Round points | Maximum |
| --- | ---: | --- | ---: |
| CFP | 12 teams, 11 games | First round 1; quarterfinal 2; semifinal 4; title 8 | 28 |
| NBA Cup | 30 teams in Group Play, then 8 qualifiers and 7 knockout games | Group game 1; quarterfinal 1; semifinal 2; title 4 | 72 when all 60 group games are available |

Ties are broken by closest predicted **combined championship score**, then more correct picks. Exact ties share a rank. Potential is shown for suspense and never breaks ties. The final-score guess stays private until the final is decided.

The 2026-27 CFP bowl sites are Fiesta, Cotton, Peach, Rose, Orange, and Sugar, but a specific bracket slot's bowl assignment is entered with the official schedule; it is not guessed or hardcoded. The CFP states that the No. 1 seed chooses its quarterfinal and potential semifinal site. See [official bracket and schedule](https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder). The NBA Cup uses four knockout qualifiers per conference and seven elimination games; see [NBA Cup format](https://www.nba.com/news/nba-cup-101).

## Capacity and money boundary

Confirmed cap: **one free bracket per user per tournament season**; **five total** with an active AF Pro entitlement (including Supreme, which bundles Pro). AF Commissioner alone does not increase the cap. A commissioner can set a lower per-league cap. Extra capacity is an app subscription benefit, not a contest stake, league pot, or entry fee. There is no bracket-specific checkout in this PR.

AllFantasy offers **no prizes, gambling, betting, bracket entry fees, or in-app payouts**. Commissioners handle any optional external arrangements independently. The repository's existing legal copy currently names FanCred for paid league dues, so broader third-party wording needs product/legal reconciliation before public launch.

## Operations on Railway

### Automatic NBA Cup publication

NBA Cup no longer requires the manual publication steps below. The existing
`/api/cron/season-bracket-results` writer publishes schedules and verified finals
with `sport=nba_cup` and `apply=true` under `CRON_SECRET`, independent of the CFP
opt-in flag. `apply=false` never writes. CFP keeps its existing manual workflow.

Discovery fetches at most four single-day ESPN scoreboards per run, prioritizing
current games and published 2026 Cup nights, then rotating through October–December.
Explicit Cup markers and matching season are required. Existing pools receive
persisted games in rotating batches of 100. Page loads only read stored data.
The existing separate Railway cron service runs every 15 minutes. Preserve its
production URL/origin protection and the isolated staging database. No schema
migration is added. Imported games omit seed numbers because the verified ESPN
scoreboards do not supply tournament seeds. See `contracts/espn/ENDPOINTS.yaml`.

### Existing CFP publication and result operations

- The Prisma migration adds `finalized_at` and `tiebreaker_total_score` to `playoff_bracket_entries`. Run it with the repository's guarded production migration flow; never run bare `prisma migrate deploy` against production. Follow `AGENTS.md` and `CLAUDE.md`.
- Build using the repository's Railway build/start scripts. Vercel status checks do not represent the user's deployment path.
- Publish CFP committee seeds at `/admin/cfp-seeding` or NBA Cup qualifiers at `/admin/knockout-brackets`.
- Publish all game start times plus names, venues, and locations at `/admin/knockout-brackets`. The server opens picks only when the field and complete schedule are available.
- Publish each verified final once for the season at `/admin/knockout-brackets`. The new season result route rejects conflicting league matchups and updates every matching league together. Existing per-pool result entry remains available for support.
- Admins can map each bracket game to a numeric ESPN event ID at `/admin/knockout-brackets`. IDs may be added as later round teams are known; a final game's mapping is locked. Unmapped games remain manual.
- `POST /api/cron/season-bracket-results` accepts `{ "sport": "ncaaf" | "nba_cup", "season": 2026, "apply": true }` with `CRON_SECRET`. It dry-runs unless Railway also sets `BRACKET_AUTO_RESULT_SYNC_ENABLED=true`. After staging verification, create a separate Railway cron service from this repository using `Dockerfile.bracket-results`, start command `node scripts/railway-bracket-results-cron.mjs`, and schedule `*/15 * * * *`. The Dockerfile copies only the worker script, so it does not rebuild the web app or alter the existing cron service. Set `BRACKET_SYNC_URL` to `https://www.allfantasy.ai` in production and reference the app `CRON_SECRET` as a Railway variable. Production enforces the Cloudflare origin lock, so a direct `*.railway.internal` POST receives HTTP 403 before cron authentication. Private networking remains suitable in staging when that lock is disabled. The app service must remain a web service.
- The worker fetches ESPN's date scoreboard by mapped event ID. It requires exactly one matching event, both bracket teams (including safe ESPN display/location aliases), a kickoff within two hours of the published schedule, final status, unequal integer scores, and the correct CFP postseason and event marker or explicit ESPN NBA Cup marker and calendar season. It handles ESPN's neutral-site home/away reversal before publishing through the same cross-league guard as the admin route. Mismatches are reported and need manual review.
- Do not label seed heuristics as a trained prediction model.

## Engagement improvements

1. **Friends-first home:** show “your rank vs friends,” two closest rivals, and invite progress immediately after finalization. One tap copies a league invite.
2. **Game-day return loop:** notify users when a matchup starts, when a pick resolves, and when their potential changes. Each alert should deep-link to the matchup or board.
3. **Chimmy explainability:** show the exact standings date and reason for a suggestion; invite the user to disagree. Later, replace heuristic estimates only when a validated model and calibration data exist.
4. **Bracket story cards:** generate shareable, spoiler-aware images for bold picks, upset survival, and leaderboard moves. Hide unrevealed picks.
5. **Commissioner pulse:** show finalized/draft counts, the next kickoff, missing schedule fields, and a one-click external invite; never include dues or payout tracking inside AllFantasy.

## Verification

Focused tests cover tournament shape, seed and schedule validation, first-game deadline, potential after elimination, and tied ranks. This draft requires TypeScript/unit CI and a Railway staging flow test before merge. The local F: project drive was unavailable to the runner, so local runtime verification was not possible in this task.
