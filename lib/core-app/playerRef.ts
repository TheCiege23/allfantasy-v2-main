/**
 * How a player is referenced in a URL.
 *
 * ⚠ THIS LIVES IN ITS OWN FILE, WITH NO `server-only`, ON PURPOSE. The client
 * component that builds the search-result links needs `playerRef` as a VALUE, and
 * importing it from playerFinder.ts pulled that module's `import 'server-only'`
 * into the client bundle and failed the build outright. Type-only imports are
 * erased and were fine; the first real value import was not. Keeping these two
 * pure functions separate is what lets both sides agree on the format.
 *
 * ⚠ THE FORMAT EXISTS BECAUSE `externalId` IS ONLY UNIQUE WITHIN A SPORT.
 * Measured on production: `340` is Nerlens Noel (NBA), Josh Allen (NCAAF), Leroy
 * Sané (SOCCER) and Paul Goldschmidt (MLB) at once. An unqualified id opened an
 * arbitrary one of them, differing between page loads.
 */

/**
 * Sport goes FIRST and parsing splits on the first colon only, because externalId
 * legitimately contains colons of its own (`sleeper:2212`,
 * `name:Josh Allen:QB:BUF`) and splitting on all of them would shred it.
 */
export function playerRef(sport: string, externalId: string): string {
  return `${sport}:${externalId}`
}

const KNOWN_SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER'])

export function parsePlayerRef(raw: string): { sport: string | null; externalId: string } {
  const cut = raw.indexOf(':')
  if (cut > 0) {
    const head = raw.slice(0, cut)
    /*
     * Only treat the prefix as a sport when it IS one — otherwise `sleeper:2212`
     * reads as sport "sleeper" and matches nothing at all. This is also what keeps
     * links minted before the format existed working: they parse as sport-less and
     * fall back to the unscoped lookup.
     */
    if (KNOWN_SPORTS.has(head.toUpperCase())) {
      return { sport: head.toUpperCase(), externalId: raw.slice(cut + 1) }
    }
  }
  return { sport: null, externalId: raw }
}
