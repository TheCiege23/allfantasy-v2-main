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

## Your starters (NBA, NHL, MLB)

Alongside the NFL starter alerts, `starterAlerts` in `gameEvents.ts` sends a personal "⭐ Your starter"
alert only to managers starting the player. These are push and in-app only.
- **MLB:** a scoring at-bat or home run.
- **NHL:** a goal or an assist.
- **NBA, WNBA and NCAAB:** milestones only, meaning 20, 30, 40 or 50 points, a double-double or a
  triple-double. Only the highest milestone reached in one poll is sent.

Anyone who gets the personal alert is left off the game alert for the same play.

## Recap after every game

When a game ends, anyone starting a player in it gets ONE recap instead of the plain final. The
recap has the final score and each of their starters' box-score line, for example
"Patrick Mahomes: 22/32 C/ATT, 280 YDS, 3 TD". It goes by push, in-app and email.
Followers with no starter in the game get the plain final.

## Live game alert level (Settings › Notifications)

`lib/notification-settings/liveAlertLevel.ts` is the one table the settings screen and every sender
read.
- **Everything** (default): all of the above, plus close games and overtime from any game in the
  sports you play.
- **My teams & players**: only games where you follow a team or start a player.
- **Close games only**: close finishes and overtime, nothing else.
- **Off**: no live game alerts. Trades, drafts, waivers, lineup and injury alerts are not
  affected.

## Grouping

Every alert from one game shares one device tag, `game:<SPORT>:<gameId>`; NFL starter alerts use
`live-play:<gameId>`. The newest replaces the last on the lock screen instead of stacking. On the
web it still buzzes (`shouldRenotify`), and on iPhone `apns-collapse-id` still makes a sound. The
bell keeps every one.

## Channels and limits

- **Email**: finals, game recaps and postseason clinches only. Plays, period scores and close games are push
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

## Watching the numbers

`/admin/notification-volume` (also `GET /api/admin/notification-volume?days=7`) shows what was
actually sent. It reads `notification_outbox`, `platform_notifications`, `EmailPreference` and
`user_profiles`, and has these views:
- pushes, emails and texts per day
- per category and per type
- per person per day: average, median, 90th percentile, max, and days with 20+
- the most-notified people in the last 24 hours
- opt-outs and the spread of live alert levels

Texts are logged from 2026-10-22.

## Breaking news

Breaking news (`lib/news/breakingNewsAlerts.ts`) goes by push and the in-app bell only, never email or
text, since 2026-10-25. After the player-news changes it was the biggest email type left: 176 emails to 43
people in two and a half days. The cap of 4 a day per person still applies.
