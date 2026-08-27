/**
 * A Yahoo league identifier, in whatever form the person has to hand.
 *
 * ⚠ THE FORM MATTERS, AND IT IS NOT COSMETIC. `resolveYahooLeagueLookup` passes
 * anything containing `.l.` straight through as a league key; ANY OTHER SHAPE it
 * resolves by listing the account's leagues first — which is the exact call that
 * fails when Yahoo refuses the collection (observed in production as a 502 from
 * /api/leagues/import/discover, repeatedly).
 *
 * So a bare `123456` typed into the fallback field would take the broken path
 * and fail identically, and the fallback would look like it did not work either.
 * Normalising to `nfl.l.<id>` is what makes this a genuine second route in rather
 * than a second door onto the same corridor.
 *
 * Pure and separate from the screen so this can be tested as behaviour rather
 * than asserted as source text.
 */
export function toYahooLeagueKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  /* Already carries a game — never second-guess an explicit key, including the
     numeric game ids Yahoo issues per season (e.g. 449.l.123456). */
  if (trimmed.includes('.l.')) return trimmed
  /* Yahoo's football league URL is /f1/<leagueId>/<teamId>, so a pasted link
     carries the id in a knowable place — and pasting one is the likelier action
     than reading the number out of it. */
  const fromUrl = trimmed.match(/\/f1\/(\d+)/)
  const id = fromUrl ? fromUrl[1] : trimmed
  /* NFL because the screen this serves is NFL throughout — the discovery call it
     sits beside passes sport: 'nfl'. Anything not a plain number is returned
     untouched rather than wrapped into a key that could not be right. */
  return /^\d+$/.test(id) ? `nfl.l.${id}` : trimmed
}
