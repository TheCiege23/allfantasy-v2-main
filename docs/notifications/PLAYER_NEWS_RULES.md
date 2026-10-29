# Player news rules

These rules were set by the owner on 2026-10-22. One day had brought them 59 emails about players
on their rosters, from starters down to deep bench players. Every player-news sender now goes
through one gate, `lib/notifications/playerNewsGate.ts`:
- the news feed, `PlayerNewsNotificationService` (league managers, player followers and team
  followers)
- the injury sync, `engagement-alerts/injuryAlerts`
- the team-workspace injury alerts, `core-app/teamAlertService`
- the game-day injured-starter sweep, `/api/cron/alert-sweep`

## 1. Starters now, everyone else in one daily digest

| Player news level | Starter | Bench, IR, taxi | Player you follow | Team you follow |
|---|---|---|---|---|
| Starters only (default) | push now | digest | push now | digest |
| My whole roster | push now | push now | push now | digest |
| Off | nothing | nothing | nothing | nothing |

A push now means a phone notification and an in-app bell entry, with no email. Digest means a bell
entry only.

A story with no clear status, such as "dealing with a sore hamstring", is digest-only at every level.

**The Roster news email** is built by `lib/notifications/playerNewsDigest.ts` and goes out once per
person per day.
- **When:** at the first check after 8am in the person's timezone. The every-minute
  `notification-outbox-relay` cron checks every 15 minutes.
- **What:** everything since the last digest, grouped by league. Starters come first, marked ⭐,
  then the rest by team.
- **Settings:** it goes out under `injury_alerts`, so that category's email switch, unsubscribe and
  quiet hours still apply.

## 2. One alert per player, per status, per day

All senders share one record: `pn-told:v1:<Eastern day>:<user>:<PlayerIdentityMap.id>:<status>`.
- A player ruled out in two feeds and three leagues becomes one alert.
- Going from questionable to out on the same day is still a second alert, because the status
  changed.

## 3. Only changes that matter

`lib/notifications/playerNewsStatus.ts` reads the status from the story or the feed: out, doubtful,
questionable, IR, suspended, active, practice or other. Nothing is sent for:
- a practice report ("limited at practice", "did not practice")
- the same status again
- any news about a player already on IR, unless it is their return

## 5. The setting

Settings › Notifications › Player news offers Starters only, My whole roster and Off, each with its
definition on screen, in English and Spanish. The value is stored as
`notificationPreferences.playerNewsLevel`, which needs no migration because an absent value reads as
the default.

## Email

Player-news senders send no instant email any more. The one exception is the game-day
injured-starter email from the sweep, which has per-league fix links. It is limited to one per
person per day, and later sweeps that day send only a push and a bell entry.

## 6. Injuries reach your phone and inbox only when they change a lineup

Added 2026-10-25 at the owner's request. Both injury senders, the injury sync
(`engagement-alerts/injuryAlerts`) and the news feed (`PlayerNewsNotificationService`), ask
`lib/notifications/lineupImpact.ts` what a change means for each league that rosters the player. The
rules and the wording are in `lib/notifications/lineupImpactCopy.ts`.

| Change | What you get | Channels |
|---|---|---|
| Starter ruled out (Out, IR, suspended) | Your options: the bench player to start, or the free agent to add if nobody on the bench can (AF Pro player depth), or "check free agents" | Push + email now |
| Starter turns questionable or doubtful | Keep him in, and who to start if he is ruled out | Push + email now |
| Starter cleared after being questionable, doubtful or out | He is cleared and stays in | Push + email now |
| Bench player back healthy who out-projects a starter | Start him over that starter, with the projected gain | Push + email now |
| Anything else (a bench player hurt, or healthy but not good enough to start) | — | In-app bell only, not in the daily digest |

- **Who to swap and the numbers** come from the Player Finder's league-scored picker
  (`core-app/playerImpact` + `leagueCall`). That picker covers NFL players with a Sleeper id. For other
  sports, a starter still gets the alert without a named backup, and a healthy bench player is never
  told to start, because that needs projections.
- **Nothing is sent once the game has kicked off**, because no lineup can change then.
- **One alert per player, per status, per day** still applies across both senders and every league.
- **Player news "Off"** still silences all of it.
- **Followers and team followers** keep their own routing from section 1.

