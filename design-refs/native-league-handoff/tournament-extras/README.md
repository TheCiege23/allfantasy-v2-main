# Tournament extras: share card, divisions control, notifications

These three screens finish the tournament set. They work with both formats: the points race (`../specialty-leagues/tournament`) and divisions & conferences (`../tournament-formats`).

## Rules these screens use

- **Tiebreakers:**
  1. Higher seed.
  2. Better record.
  3. Best single week.
  4. Commissioner review.

  Before the bracket there are no seeds, so ties start at record. In a tied bracket game the higher seed advances.
- **Last week.** The tournament ends one week before the season ends: NFL week 17.
- **Redrafts (points race only).**
  - The default order is by seed. The commissioner can choose Random or Set manually instead.
  - Each redraft has a 1-week buffer with no scoring. In that week, load the leagues by seed, set the draft time, draft, then post the next week's matchups.

## Screens

| File | What it shows | States in `screens/` |
|---|---|---|
| `TournamentChampion` | **Champion share card.** Format toggle; sizes Post 4:5 (1080×1350), Story 9:16 (1080×1920) and Square (1080×1080). Toggles for "Road to the title" and "Final score and record". Download image, Copy link, Post to league chat. The card has the crest (divisions) or the cup with the league path (points race), CHAMPION, team, round-by-round path, stats, "ALLFANTASY.AI" and the "created by KB" signature | Divisions story (default), Points race post, Square |
| `DivisionControl` | **Commissioner control for the divisions format.** Two modes. **Seeding (week 10):** checklist (scores final, corrections closed, resolve ties, preview 128 seeds, commit), a tie table with seed, record and best week, a seed-line × region preview with wildcards highlighted, setup jobs and the audit log. **Rounds (week 11+):** the same checklist per round, with tied games decided by the higher seed, plus the round calendar from week 11 to week 17 | Before review, Ties and preview, Rounds (advanced) |
| `TournamentNotifications` | **Notifications for 7 moments:** league revealed, draft scheduled, made the cut, eliminated, wildcard clinched, on the bubble and champion. For the selected moment it shows the lock-screen push stack, the email, and a matrix of default channels (push, in-app, email, league chat) | Revealed (default), Eliminated, Wildcard, Draft scheduled |

## Build notes

- **Share card:**
  - Render it in the app from tournament data and export it as a PNG. Don't keep pre-made images.
  - The link opens a public trophy page with the same card and the full bracket.
  - Non-champions get their own headline ("Final four", "Division champion", "Made the bracket", "Stage 2").
- **Divisions control:**
  - Seeds and bracket placement are calculated on the backend only. The screen previews them and commits.
  - "Commit seeding" and "Advance round" are each a single guarded action that can't be undone, and they write to the audit log.
  - The same job runner and retry behaviour as the points-race `TournamentControl`.
- **Notifications:**
  - Defaults are in the matrix. Managers can turn off any channel.
  - The draft-scheduled notice is sent as soon as the commissioner sets a draft time in the buffer week.
  - Copy in push titles stays under about 40 characters. Never put secrets or full provider URLs in notification payloads.
- **Source files** are Design canvas boards (`.dc.html`). Asset paths resolve against `specialty/` in the canvas project.
