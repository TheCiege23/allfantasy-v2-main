# Live game alert rules

Owner's rules, 2026-10-22. The code is `lib/engagement-alerts/gameEvents.ts` (what each sport may
send) and `lib/engagement-alerts/gameAlertService.ts` (who gets it, on which channel). One engine
sends every game alert, once a minute, from `/api/cron/notification-outbox-relay`.

## Who gets what

| Audience | Who | Gets |
|---|---|---|
| Game | Followers of either team, and managers starting a player in the game | Plays, period scores, finals |
| Everyone in the sport | League members, sport interests, team followers | Close games, overtime, postseason moments only |
| Your starters | Managers starting the player (`lib/live/bigPlayNotifier.ts`, NFL) | Every TD and 19+ yard play by their own starter |

A manager starting a player named in a play gets the personal "your starter" alert, not the game
alert too.

College (NCAAF, NCAAB): only games with a Top 25 team. Followers of an unranked team still get
that team's alerts.

## Per sport

**NFL / NCAAF.** Scoring plays and 19+ yard runs or catches. Each alert names the QB and the ball
carrier or receiver, with a headshot. Sacks, pick-sixes, fumble return TDs, and punt or kickoff
return TDs. Punts, kickoffs and penalties never count as big plays.
Late game is the last 2:00 of the 4th, or overtime, in a one-possession game. It adds:
- field goals made, missed or blocked by a team down 0-3
- touchdowns by a team down 0-8, marked "Clutch", with the extra point or 2-pt result
- standalone extra points and 2-pt tries in a game within 7

Extra points and missed field goals are never sent outside that window.
Checkpoints: NFL halftime and final. NCAAF end of Q1, halftime, end of Q3 and final.

**NBA / WNBA / NCAAB.** No per-play alerts. End of Q1, halftime, end of Q3 and the final. Men's
college plays halves, so it gets halftime only. In the last 60 seconds of the 4th or OT, any score
that ties the game, flips the lead or leaves a 1-4 point game names the scorer with a headshot.

**NHL.** End of the 1st and 2nd periods, then the final or the overtime alert. In the last 2:00 of
any period, every goal in a game within two, naming the scorer with a headshot. Every OT goal. In
the last 2:00 of the 3rd or OT in a tied or one-goal game, a save on the trailing team names the
goalie, at most twice a game.

**MLB.** Every scoring play, naming the batter, with a headshot, and labelled "3-run home run"
and so on. No inning updates through six. Then the seventh-inning stretch, the end of every inning
from the 7th on, and the final.

**Every sport.** One "close game" alert with the score and the TV broadcast ("Watch on CBS"), sent
to everyone in the sport.

## Channels and limits

- **Email**: finals and postseason clinches only. Plays, period scores and close games are push
  and in-app. Starter play alerts no longer email either.
- **Text**: never for games. Texts are for league operations: draft start, on the clock,
  three picks away, draft paused, trades, waivers, commissioner notices.
- **Push budget**: per person per hour, at most 10 game-alert pushes, and at most 6 of them minor
  plays. Over budget, the alert still lands in the bell. The phone just doesn't buzz.
- **Daily cap**: at most 10 close-game or overtime alerts a day from games the person has no stake
  in.

## Turned off as duplicates

`lib/live/gameMomentAlerts.ts` (the moments phase of `/api/cron/sports-alerts`) and
`lib/follows/teamScoreAlerts.ts` (from `/api/cron/import-scores`) sent the same halftime, final,
close and overtime alerts a second and third time. Both are off by default.
`AF_LEGACY_GAME_ALERTS=1` turns them back on.
