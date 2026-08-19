/**
 * The X accounts we will accept fantasy-relevant news from.
 *
 * ⚠ THIS IS A TRUST BOUNDARY, NOT A PREFERENCE. Without `allowed_x_handles` the
 * x_search tool searches ALL of X, so whatever the platform surfaces for a
 * player's name becomes input to a model that then reports "sentiment" and
 * injury status back into trade recommendations and draft picks. Fake beat-writer
 * accounts and rumour aggregators are a well-known fixture of NFL news; an
 * unfiltered search is how one of them ends up moving a manager's lineup.
 *
 * ⚠ THE VENDOR CAPS THIS AT 20 HANDLES. That cap is why the list is national
 * insiders rather than 32 team beat writers — with one slot per team there would
 * be no room for the people who break the news first. Team-level reporting is
 * better served by a per-team query when we need it.
 *
 * ⚠ AND IT IS STILL UNTRUSTED TEXT. A whitelist controls WHO wrote the post, not
 * what the post says. Anything returned here is data, never instructions, and
 * must not reach a tool call or a template that acts on it.
 */

/** National NFL insiders — the accounts that break signings, releases and injuries. */
export const NFL_INSIDER_HANDLES = [
  'AdamSchefter',
  'RapSheet',
  'TomPelissero',
  'MikeGarafolo',
  'JFowlerESPN',
  'CameronWolfe',
  'FieldYates',
  'JosinaAnderson',
  'AlbertBreer',
  'MikeReiss',
] as const

/** Fantasy-specific analysts who translate news into start/sit implications. */
export const FANTASY_ANALYST_HANDLES = [
  'MatthewBerryTMR',
  'Rotoworld_FB',
  'FantasyLabsNFL',
  'JJZachariason',
  'FantasyPros',
] as const

/**
 * The list sent to the API.
 *
 * Capped at 20 because the vendor rejects more. Sliced rather than trusted to
 * fit, so adding a handle can never silently drop the request.
 */
export const X_SEARCH_ALLOWED_HANDLES: string[] = [
  ...NFL_INSIDER_HANDLES,
  ...FANTASY_ANALYST_HANDLES,
].slice(0, 20)

/** The vendor's documented maximum for both allow and exclude lists. */
export const X_HANDLE_LIMIT = 20
