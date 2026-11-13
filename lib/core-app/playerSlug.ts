/**
 * The public, indexable player URL: `/players/{name}-{sport}-{sleeperId}`.
 *
 * NO `server-only` HERE, ON PURPOSE - same reason as playerRef.ts. Client
 * components link to these URLs and need `playerSlug` as a VALUE; importing it
 * from a module that pulls `server-only` fails the build outright.
 *
 * -- WHY THE SLUG IS KEYED ON sleeperId AND NOT ON A NAME --------------------
 *
 * Measured on the ingest before choosing, because both obvious keys are wrong:
 *
 *   NAME IS NOT A PERSON. "Justin Jefferson" in NFL is two different people -
 *   the WR on MIN (sleeperId 6794) and an LB on CLE (13524). "Josh Allen" is at
 *   least three: the QB on BUF (4984), an LB on JAX, and a G (2212). 1,841 NFL
 *   names map to more than one distinct position. A name slug would serve the
 *   wrong athlete on a page whose entire pitch is that its reads are correct.
 *
 *   externalId IS NOT A PERSON EITHER - it is a row. `SportsPlayer` is unique on
 *   (sport, externalId, source), so one athlete has one row per provider:
 *   Justin Jefferson the WR appears six times across sleeper, thesportsdb,
 *   rolling_insights and backfill. An externalId slug would mint six URLs for
 *   one man, which is duplicate content pointed at the same person.
 *
 * sleeperId is the identity bridge the rest of this codebase already resolves
 * rosters through. It separates the two Justin Jeffersons and merges the six
 * rows, which is exactly what a canonical URL has to do.
 *
 * A PLAYER WITH NO sleeperId HAS NO PUBLIC PAGE. 6,027 of 8,347 rostered NFL
 * rows carry one. The remainder are provider rows we cannot pin to a person, and
 * we would rather serve no page than an ambiguous one - the same call
 * getPlayerDetail already makes when it refuses to guess which league rosters an
 * unidentified player.
 */

/** Sports that can appear in a slug. Mirrors KNOWN_SPORTS in playerRef.ts. */
const SPORTS = ['nfl', 'ncaaf', 'nba', 'ncaab', 'mlb', 'nhl', 'soccer'] as const

type PlayerSlugParts = { sport: string; sleeperId: string; source?: never; externalId?: never } |
  { sport: string; source: string; externalId: string; sleeperId?: never }

/**
 * Kebab a display name into URL-safe ASCII.
 *
 * Accents are folded rather than stripped, so a name carrying an acute lands as
 * `leroy-sane` and not `leroy-san`. Apostrophes close up ("Ja'Marr" becomes
 * `jamarr`) because `ja-marr` reads as two words to a search engine.
 */
function kebabName(name: string): string {
  return (
    name
      .normalize('NFD')
      // Combining diacritical marks, written as escapes so this file stays ASCII.
      .replace(/[̀-ͯ]/g, '')
      // Straight and curly apostrophes.
      .replace(/['’]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  )
}

/**
 * Build the canonical public URL segment for a player.
 *
 * Returns null when the player cannot be addressed - no sleeperId, an unknown
 * sport, or a name that kebabs to nothing. Callers treat null as "not
 * publishable" rather than falling back to a guessable URL.
 */
export function playerSlug(input: {
  name: string
  sport: string
  sleeperId?: string | null
  source?: string | null
  externalId?: string | null
}): string | null {
  const sport = input.sport?.trim().toLowerCase()
  if (!sport || !(SPORTS as readonly string[]).includes(sport)) return null

  const name = kebabName(input.name ?? '')
  if (!name) return null

  // Preserve all existing NFL URLs. Other sports need the full provider namespace:
  // the same external id can describe two different athletes in one sport.
  if (sport !== 'nfl' && input.source && input.externalId) {
    const source = input.source.trim().toLowerCase()
    const externalId = input.externalId.trim()
    if (!/^[a-z0-9_-]+$/.test(source) || !externalId) return null
    const bytes = new TextEncoder().encode(`${source}:${externalId}`)
    if (bytes.length > 120) return null
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${name}-${sport}-x${hex}`
  }

  const sleeperId = input.sleeperId?.trim()
  if (!sleeperId || sport !== 'nfl') return null

  /*
   * sleeperId is not always numeric - team defences are stored as `TB`, `SF` and
   * so on. Lowercased so the slug round-trips through parsePlayerSlug, which
   * lowercases the whole URL: without this, `...-nfl-TB` parsed back to `tb` and
   * the two halves disagreed about the same player. The lookup compensates by
   * matching sleeperId case-insensitively, since the column keeps `TB`.
   */
  const id = sleeperId.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  if (!id) return null

  return `${name}-${sport}-${id}`
}

/**
 * Read the sport and sleeperId back out of a slug.
 *
 * Parsed from the RIGHT, and the name is deliberately not returned. A player who
 * changes their listed name keeps the same page: the tail identifies them, the
 * head is decoration for the reader and for the search result. The page
 * redirects a stale head to the current canonical slug rather than 404ing it,
 * which is what keeps an already-indexed URL working after a name change.
 */
export function parsePlayerSlug(raw: string): PlayerSlugParts | null {
  const slug = raw.trim().toLowerCase()
  if (!slug) return null

  const parts = slug.split('-')
  if (parts.length < 3) return null

  const id = parts[parts.length - 1]
  const sport = parts[parts.length - 2]

  if (!id || !/^[a-z0-9]+$/.test(id)) return null
  if (!sport || !(SPORTS as readonly string[]).includes(sport)) return null

  if (sport !== 'nfl') {
    if (!/^x(?:[0-9a-f]{2})+$/.test(id) || id.length > 241) return null
    try {
      const bytes = new Uint8Array(id.slice(1).match(/.{2}/g)!.map((pair) => parseInt(pair, 16)))
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const cut = decoded.indexOf(':')
      if (cut < 1 || !/^[a-z0-9_-]+$/.test(decoded.slice(0, cut)) || !decoded.slice(cut + 1)) return null
      return { sport: sport.toUpperCase(), source: decoded.slice(0, cut), externalId: decoded.slice(cut + 1) }
    } catch { return null }
  }

  return { sport: sport.toUpperCase(), sleeperId: id }
}

/** `/players/{slug}` for a player we can address publicly, else null. */
export function playerPath(input: {
  name: string
  sport: string
  sleeperId?: string | null
  source?: string | null
  externalId?: string | null
}): string | null {
  const slug = playerSlug(input)
  return slug ? `/players/${slug}` : null
}
