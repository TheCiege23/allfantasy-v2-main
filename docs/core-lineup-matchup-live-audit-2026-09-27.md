# My Team, Matchup and Live Scores audit — September 27, 2026

Authenticated production checks covered My Team’s portfolio overview, Dynasty BestBall League!, manual IDP league KBFL, and undrafted KBI Commish Chat. Matchup and Live Scores were checked with the same Best Ball league. Desktop was 1360 × 900; phone was 390 × 844. Browser viewport was restored afterwards.

## Confirmed findings and changes

- My Team reported zero automatic teams while the selected Best Ball league correctly identified automatic lineups. The board rendered `notChecked.automatic` instead of the checked `automatic` count. Corrected the counter and excluded inactive teams from the footer’s healthy-lineup count.
- Undrafted My Team showed ten empty-slot fixes, a lineup deadline and a start/sit check. Added a draft-pending state and suppressed its start/sit card.
- The same inactive-state treatment covers explicitly completed seasons and eliminated rosters. An empty Guillotine roster is treated as eliminated only during an active season, preserving draft-pending handling.
- Matchup claimed twenty starters were still to play alongside a statement that game states were unavailable. It also retained projected gaps for finished players. Added a read of stored weekly game states, with separate upcoming/live/final/unknown counts. Final players add no projected points; missing live states prevent unsupported forecasts.
- The cross-league Matchup overview advanced to the first entirely unscored week even while the provider’s current week was live. It now honors the saved provider period before applying its fallback, matching the selected-league screen.
- Best Ball Matchup offered “Set lineup” and forecast both sides from their stored starter lists despite possible bench substitutions. Suppressed that manual handoff and the unsupported forecasts, retaining actual provider scoring and explaining automatic selection.
- Live Scores labeled other managers’ players as “Your starters.” Its weekly score query covered all players in every claimed league. Restricted tie-ins to the viewer’s resolved roster and derived starter status from that roster, preserving the existing roster-failure message if ownership cannot be resolved.
- Live player visibility no longer depends on the first weekly score arriving. Owned upcoming players remain visible with unknown points, and prior-week points are excluded when the provider or football slate establishes the current period. Verified players remain visible if another league’s roster cannot be read.
- Repeated notification and generic recommendation prompts pushed the phone’s first meaningful page heading to approximately y=664–666. Restricted these prompts to Home; league context and page-specific actionable guidance remain.

## Observations that were not treated as defects

- The league rail’s initial unknown age resolves to fresh scoring after hydration.
- Matchup header and player totals initially differed while separate live reads refreshed; a subsequent snapshot agreed at 90.7 versus 35.4. No arithmetic replacement of provider totals was introduced.
- KBFL correctly exposed individual future deadlines and an OUT tight end, and distinguished IDP league projections from an unavailable generic standard total.
- Live Scores provided quarter, clock, period scores, possession, last play, leaders, venue, broadcast, local kickoff times and game-detail links, with an approximately twenty-second refresh.

## Limits and follow-up

This is a targeted audit of these three surfaces, not completion of the entire site audit. Best Ball forecasting needs a legal full-roster optimization model before numerical win probabilities or final projections can be restored. The change deliberately does not replace provider scoring with an invented optimal total. Pre-draft and league-format coverage elsewhere in the site remains part of the broader audit.

Validation and production deployment results are recorded separately after checks finish.
