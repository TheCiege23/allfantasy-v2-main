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
 *
 * ⚠ AND THE SOURCE RIDES IN THE HEAD (`SOCCER~api_football:1100`), BECAUSE `externalId`
 * IS NOT UNIQUE WITHIN A SPORT EITHER. Measured on production 2026-10-12: SOCCER `1100` is
 * api_football's Erling Haaland AND rolling_insights' James Daly, and NFL `2135` is a
 * backfill "Josh Allen QB BUF" AND rolling_insights' Josh Hines-Allen — 110 soccer and 11
 * NFL ids collide across sources. A sport-only ref opened whichever row was newest, so
 * Haaland's link showed Daly. The head is the only place a separator is safe: the id side
 * may hold anything.
 */
export function playerRef(sport: string, externalId: string, source?: string | null): string {
  const src = source && SOURCE_RE.test(source) ? `~${source}` : ''
  return `${sport}${src}:${externalId}`
}

const KNOWN_SPORTS = new Set(['NFL', 'NCAAF', 'NBA', 'NCAAB', 'MLB', 'NHL', 'SOCCER'])
/** Source names are feed slugs (`thesportsdb`, `rolling_insights`, `best-ball-war-room-runtime`). */
const SOURCE_RE = /^[a-z0-9_-]+$/i

export function parsePlayerRef(raw: string): { sport: string | null; externalId: string; source: string | null } {
  const cut = raw.indexOf(':')
  if (cut > 0) {
    const head = raw.slice(0, cut)
    const tilde = head.indexOf('~')
    const sportPart = tilde >= 0 ? head.slice(0, tilde) : head
    const sourcePart = tilde >= 0 ? head.slice(tilde + 1) : null
    /*
     * Only treat the prefix as a sport when it IS one — otherwise `sleeper:2212`
     * reads as sport "sleeper" and matches nothing at all. This is also what keeps
     * links minted before the format existed working: they parse as sport-less and
     * fall back to the unscoped lookup. A ref minted before the source existed parses
     * with `source: null`, and the lookup then accepts it only when unambiguous.
     */
    if (KNOWN_SPORTS.has(sportPart.toUpperCase()) && (sourcePart == null || SOURCE_RE.test(sourcePart))) {
      return { sport: sportPart.toUpperCase(), externalId: raw.slice(cut + 1), source: sourcePart || null }
    }
  }
  return { sport: null, externalId: raw, source: null }
}
