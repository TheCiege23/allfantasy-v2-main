# Dashboard league selection

## Embedded hub

- Selecting a league on **`/dashboard`** sets **`?leagueId=`** and loads **`/league/[id]?embed=1`** in the **center column** iframe.
- **`LeagueEmbedGate`** removes duplicate global product chrome for embed mode only.

## Draft overlay

- Embedded draft entry points post **`af-dashboard-open-draft`** to the parent window or set **`/dashboard?leagueId=&draftOverlay=1&draftId=`** (or **`dispersalDraftId=`**).
- **`DraftRoomOverlay`** full-screens **`/draft/[id]`** or the dispersal draft route with **`?embed=1`** as appropriate.

## Manual QA

See **`docs/draft-room-manual-qa-runbook.md`** §2.4 for dashboard + draft overlay checks.
