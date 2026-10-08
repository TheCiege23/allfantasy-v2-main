# Weekly sport plan follow-through

## Changes
- Reads the full roster inventory, scopes by exact league, excludes archived and automatic lineups.
- Promotes confirmed lineup, waiver and trade deadlines; game times never become inferred locks.
- Adds stored lineup counts and up to three unstarted flagged starters to the top weekly decisions.
- Adds NFL, NCAAF, NBA, NCAAB, NHL, MLB and soccer preparation guidance and league links. Guidance is advisory, not a computed schedule-volume or category projection.
- Keeps points/category/roto and basketball Game Pick/Lock-In format verification explicit.
- Records wins, losses, ties, seed, points for, remaining periods and fitted scoring mean with new playoff snapshots. Comparisons describe recorded input changes without attributing probability movement to a single cause. Legacy snapshots remain readable without fabricated inputs.
- Shows model qualification conditions and same-period conditional help.
- Commissioner tasks retain an exact-league weekly issue link; foreign issue IDs are rejected. Saved weekly statuses load on demand and refresh after save. Announcements and polls remain unsent drafts; managers mark resolution in the Hub.
- Share cards gain win/loss probability bars. Singular rivalry wording corrected.

## Research
Official Sleeper basketball documentation distinguishes Lock-In/Game Pick from game-volume scoring:
https://support.sleeper.com/en/articles/4644860-league-formats-game-modes
Yahoo scoring documentation distinguishes points, categories and roto:
https://ca.help.yahoo.com/kb/fantasy-basketball/standard-leagues-sln6868.html
These differences require verified league settings before schedule volume, category outcomes or playoff eligibility are inferred.

## Verification
77 focused tests passed (53 pure/server, 24 DOM). Four synthetic device fixtures passed including movement input comparison, sport guidance, saved task status, seven caption copies, calendar payload, exact-league draft handoffs and no horizontal overflow. Canvas card preview visually reviewed.
No production messages, social posts, polls or arbitrary tasks were created.

## Limits
Physical-device behavior and actual social/calendar/Excel apps are separate verification. Cross-sport provider data coverage is not established by guidance or fixtures. Full game-volume, pitcher/goalie, category matchup forecasts and rule-specific adapters require verified inputs and are not represented as shipped predictions.
