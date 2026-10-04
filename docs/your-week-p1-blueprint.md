# Your Week: P1 correctness and weekly blueprint

Both `/core/week` and its league scope now present verified weekly facts, a copyable personal brief, and the first three priorities. The league page adds its existing playoff simulation, saved probability trend and win/loss branches. “Ask Chimmy” opens an unsent prompt with the selected league context. My Team and Season Outlook remain the underlying action and forecast systems.

## Correctness

- Priorities and unitless matchup closeness order the universal board. Unlike sports are never ranked by raw point gaps; trailing games nearest contention appear first.
- Low and unknown playoff odds no longer hide leagues. A 99% forecast does not mean clinched; exact status requires conservative arithmetic, supported league-stated rules, all known teams and a complete regular-season schedule.
- Historical scoring estimates, live scores and current lineup projections have distinct labels. Historical spread scales with scoring units.
- Canonical league IDs constrain team ownership reads. Provider-qualified external IDs prevent collisions within the requested portfolio. Ambiguous legacy WeeklyMatchup rows are withheld because that table lacks provider provenance; canonical facts remain usable.
- Native AF leagues use RedraftSeason, RedraftRoster and real RedraftMatchup rows without requiring external IDs. The season's stated playoff start determines the regular-season boundary; native median-game seasons are withheld from this forecast. Final zero-point ties remain final, preserve rivalry records and count in season totals. Forecast standings assume half-win credit per final tie, then points for, as disclosed.
- Explicit categories, roto and season-table formats show format goals instead of invented head-to-head or elimination stakes. Their specialized playoff models remain unavailable.
- Current-season missing schedules are withheld rather than replaced by an older season's playoff forecast. Canonical facts fill absent complete games without doubling imported games.

## Personalization and playoff history

The brief uses the account name, team or portfolio scope, sports, verified opponent and period, available forecast, and first action. Copy falls back to selectable text if clipboard access fails. Actions exclude locked games and Best Ball lineup management; unreadable or mismatched data asks for refresh. Kickoff is labeled “Next game,” with league-lock verification. A focused league is filtered before portfolio display caps.

Saved probabilities are per user, team, league, season and period in SportsDataCache, using independent period keys. A trend starts at the first observed snapshot; it does not invent earlier probabilities. Storage failure leaves the current forecast visible. Branches and assumptions come from the same Season Outlook engine. No migration is required.

## Validation and limitations

Regression tests cover native and canonical identity, format classification, zero-point ties, scale-invariant odds, mathematical status, action scope, lock timing, copied briefs, Chimmy prefill, English/Spanish controls, snapshots, failure states and cache reuse. Browser fixture checks at 375, 768 and 1440 pixels in AF, light and dark themes found no horizontal overflow and verified 44-pixel primary buttons. The component uses the existing Core theme tokens.

Authenticated production flows and physical iOS/Android testing require release verification. Historical simulations do not model divisions, head-to-head tiebreaks, correlated scoring, injuries, trades or alternate qualification systems; unsupported exact-status claims are withheld. Provider feeds determine current projection and lineup-check coverage. Legacy external IDs cannot establish provenance outside known requested-provider collisions without a schema/writer change.

The lineup wording follows [Sleeper's official Game Pick guidance](https://support.sleeper.com/en/articles/4701537-game-pick-details): sport and mode rules determine when a player can be changed, so game kickoff is not universally represented as a confirmed league deadline.
