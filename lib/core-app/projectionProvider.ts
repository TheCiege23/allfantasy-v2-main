/**
 * Who the "provider" projection on My Team actually comes from — by name, not "API".
 *
 * `lookupProjections` reads `fantasy_projections` rows whose source is anything but `allfantasy`.
 * Census of production on 2026-10-03: every such row, all season (4,336 all-time; ~1,000–1,170 a
 * week in 2026), is `source = 'sleeper'`. So the number is Sleeper's projection — for EVERY
 * league, an ESPN or Fleaflicker one included — re-scored under that league's settings. It is
 * the projection's provider, not the league's platform, and the label must not be read as the
 * second.
 *
 * ⚠ IF A SECOND VENDOR IS EVER INGESTED INTO THAT TABLE, THIS LABEL BECOMES A LIE. Re-run the
 * census (`groupBy source` on `fantasyProjection`) before adding one, and either filter the
 * lookup to one source or carry the source per row and label from that.
 *
 * ⚠ AND IN AN IDP LEAGUE THE TOTAL IS NOT ALL SLEEPER. Sleeper's line has no defensive stats, so
 * `enrichWithIdpProjections` prices defenders from AllFantasy's own IDP model
 * (`lib/idp-projections`). The screen says so wherever it names the provider.
 *
 * Client-safe: no imports.
 */
export const PROJECTION_PROVIDER_LABEL = 'Sleeper'
