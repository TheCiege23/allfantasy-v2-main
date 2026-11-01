# Live game notification rules

The cron in `app/api/cron/notification-outbox-relay/route.ts` runs the game observer. `lib/engagement-alerts/gameEvents.ts` selects moments; `gameAlertService.ts` deduplicates them, selects recipients and dispatches push plus in-app notifications. The same event key prevents a repeat across polls.

| Sport | Notifications |
|---|---|
| NFL | Scoring and big plays (including 19+ yard runs/catches, sacks and defensive scores), halftime, one late close-game alert, final |
| NCAAF | Same big-play policy, end of Q1, halftime, end of Q3, one late close-game alert, final |
| NHL | Every goal, end of periods 1 and 2, one close-game alert when the score is within 2 goals in the third period or OT, final |
| MLB | End of each completed inning, one close-game alert when within 2 runs in the ninth inning or extras, final |
| NBA/WNBA | End of Q1, halftime, end of Q3, one close-game alert when within 7 points in Q4 or OT, final |
| NCAAB | Halftime for two-half games (period checkpoints for four-quarter games), one close-game alert when within 7 points in the final period or OT, final |
| Soccer | Every goal and final |

MLB at-bats and NBA/NCAAB baskets or player milestones do not generate notifications. NHL saves do not generate notifications. Soccer halftime and close-game alerts are off. The final notification always names both teams and the final score. Its metadata includes both team logos; the push icon uses the winner's logo when available. In-app views show both logos beside the final result. A manager with starters may receive a single recap in place of the plain final; that recap also carries the score and logos.

Game alerts use push and the in-app bell; email and SMS are skipped. Requested game moments bypass the game-alert hourly push budget so every eligible goal, checkpoint, close alert and final can buzz. Notification preferences and live-alert levels still apply. The sport-wide daily close-game audience cap still applies to people with no stake in the game.

The game audience is followers of either team plus managers starting a player in the game. Close alerts reach sport followers too, subject to their settings. NCAAF and NCAAB retain the Top 25 gate for non-followed games. Hockey starter goal and assist alerts are personalized; the general goal alert excludes managers already receiving the personal goal alert. NFL starter big-play alerts remain handled by `lib/live/bigPlayNotifier.ts`.

The older moment and team-score senders in `lib/live/gameMomentAlerts.ts` and `lib/follows/teamScoreAlerts.ts` remain off by default through `AF_LEGACY_GAME_ALERTS`; leaving them off prevents duplicates. Device pushes for one game use one collapse tag, while the in-app bell keeps every alert.

Use `/admin/notification-volume` and `GET /api/admin/notification-volume?days=7` to watch push counts, type volume, per-person peaks, opt-outs and delivery failures after release.
