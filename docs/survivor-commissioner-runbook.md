# Survivor: commissioner runbook

A Survivor league runs itself. Chimmy opens each week, scores it, runs Tribal Council, reveals the
vote, moves people to Exile, merges the tribes and crowns the winner. The commissioner hears from
the system **only when it cannot carry on by itself**.

Every alert below arrives once (in-app, plus email or push if the commissioner turned those on).
It never names a ballot, a vote count or who holds an idol. The same items appear on the
commissioner screen's **Your to-do** card, and each one has a button to the right place.

## For commissioners: each alert and the one thing to do

| Alert | What it means | What Chimmy already does | Your one action |
|---|---|---|---|
| **Your Survivor draft starts in a day and cannot begin yet** | Something is holding the draft, usually an empty seat. The alert says what. | Retries at the scheduled time. The draft waits rather than starting short. | Open **Draft** and fill or release the seat before the draft time. |
| **Exile Island could not be created** | The league was made, but its Exile Island side league failed to set up. | Nothing until it is fixed. Eliminations would have nowhere to send people. | Open **Settings → Exile** and retry, before the first elimination. |
| **Week N scores are overdue** | The week ended, but its verified scores are not final yet, so the island waits. | Keeps checking. The season moves on by itself once the scores arrive. | Usually none: the stat feed is late. If it lasts more than a day, contact support. |
| **Week N council is tied and needs your call** | The revote and the season-points tiebreak both ended level. | Holds the council open. Nobody is voted out until it is settled. | Open **Tribal Council** and pick between the tied managers. |
| **The jury vote did not produce a champion** | The jury deadline passed a day ago and no winner could be crowned. | Holds the finale. | Open the **finale controls** and review the jury. |
| **Survivor automation hit an error** | The season runner stopped on an error. The alert shows the message. | Retries every few minutes. Sent at most once a day. | If it is still there tomorrow, open the **Commissioner Hub** and contact support with the message. |
| **Tribes redrawn / the merge started early** | A tribe got too small for a real vote, so Chimmy redrew the tribes or merged early. | Already done. | Nothing. This is a heads-up. |

Two states show on the to-do card without an alert, because the commissioner caused them:

- **The season is paused:** press **Resume** in Council controls.
- **Read the week N votes:** only when automatic reveals are turned off. Open Tribal Council and
  read the votes out.

## For operators

### Sentry

Every Survivor automation failure is reported to Sentry by
`lib/survivor/survivorAutomationReporting.ts`, tagged so one alert rule covers them all:

| tag | values |
|---|---|
| `area` | `survivor` |
| `survivor_job` | `season_runner` (one league's weekly tick), `season_batch`, `sit_out_batch`, `notifications` (the whole batch in `/api/redraft/score-sync`), `draft_start` (`/api/cron/draft-tick`) |
| `league_id` | set when one league failed |

**Suggested alert rule:** *a new issue is created, or an issue changes from resolved to unresolved,
where the tag `area` equals `survivor`*. Send it to whoever is on call. One stuck league is
reported at most once every 6 hours per worker process, so the rule does not flood.

`league_id` gives the league. Its commissioner screen shows the same `lastError` the alert carries.

⚠ Before this, nothing in the Survivor automation reached Sentry. Errors went only to
`SurvivorGameState.lastError`, the commissioner alert, or a cron JSON summary nobody reads.

⚠ Reporting needs `SENTRY_DSN` on the service. Without it the server logs
`[Sentry] server error reporting NOT active` at startup and nothing is sent.

### The two automation switches

Both live on **`allfantasy-v2-worker`**, the service the crons call. Setting them on
`allfantasy-v2-main` does nothing. The worker deploys from `worker-release`, which catches up with
`main` once a day.

| variable | turns on |
|---|---|
| `DRAFT_TICK_CRON_ENABLED=true` | server-side autopick in `/api/cron/draft-tick` (scheduled draft starts run either way) |
| `SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED=true` | the planned season runner: weeks, councils, merge and finale with no clicks |

⚠ Writing a Railway variable redeploys the service. Set both in one change, and read them back on
the right service before setting them again.
