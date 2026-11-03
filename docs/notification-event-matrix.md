# Notification event matrix

| Event | Audience | Push | In-app | SMS |
| --- | --- | --- | --- | --- |
| Admin newsroom story, including injury and trade headlines | Users who play that sport and followers of named teams | Yes | Yes | No |
| Player news and injury status | Managers rostering the player and relevant player/team followers | Yes | Yes | No |
| League created | Commissioner and attached members | Yes | Yes | With consent |
| League invite | Registered invitee matched by exact username, linked Sleeper username, or email | Yes | Yes | With consent |
| Draft time set, start, pause, end | League members and commissioner | Yes | Yes | With consent |
| Three picks, two picks, next pick, on the clock | Owner of the upcoming pick, including traded picks | Yes | Yes | With consent |

The dispatcher still honors global, category, channel, league and quiet-hours preferences. SMS requires a verified current phone number and live consent. Draft alerts have a separate 250-text daily budget so a full draft does not exhaust the general 15-text budget; both limits can be configured. Push requires a subscription. A person without an AllFantasy account cannot receive an in-app or push invite; the existing email invite remains available.

Newsroom alerts use the same trusted-outlet and clickbait filters as the admin newsroom. Stories older than three hours are history and are not blasted after an outage. Each story is claimed before fanout; draft and league events carry stable event keys so retries do not create another inbox row, push, or text. Player status/news repeats use the existing per-player ledger.
