/**
 * The ESPN scoreboard fields that make a game card look like a game — leaders,
 * down and distance, where the ball is, the last play, the venue, the line score.
 *
 * ⚠ ALL OF THIS WAS ALREADY IN THE PAYLOAD WE FETCH ON EVERY POLL. The mapper in
 * `sports-live-scores-service.ts` kept one leader and the venue name and dropped
 * the rest, which is why `/core/live` carried a note saying a field diagram was
 * impossible "because the data layer has no yard line". The feed had one; we
 * discarded it. Shape read from the live NFL scoreboard on 2026-09-13 during
 * TB @ CIN (`situation.possessionText: "CIN 12"`, `yardLine: 12`,
 * `leaders[].shortDisplayName: "PASS"`, `venue.address.city: "Cincinnati"`).
 *
 * Pure and dependency-free so it can be tested without the service's prisma
 * import. Every field is optional on the way in: ESPN omits `situation` before
 * kickoff and at halftime, and non-football sports carry different leaders.
 */

export type EspnLeaderCategory = {
  name?: string
  displayName?: string
  shortDisplayName?: string
  leaders?: Array<{
    displayValue?: string
    value?: number
    team?: { id?: string }
    athlete?: {
      displayName?: string
      shortName?: string
      headshot?: string | { href?: string }
      position?: string | { abbreviation?: string }
      team?: { id?: string }
    }
  }>
}

export type EspnSituation = {
  down?: number
  distance?: number
  yardLine?: number
  downDistanceText?: string
  shortDownDistanceText?: string
  possessionText?: string
  possession?: string
  isRedZone?: boolean
  homeTimeouts?: number
  awayTimeouts?: number
  lastPlay?: {
    text?: string
    type?: { text?: string; abbreviation?: string }
    team?: { id?: string }
  }
}

/** One category leader, as the card renders it. */
export type GameLeader = {
  /** ESPN's own short label — "PASS", "RUSH", "REC", "PTS". */
  label: string | null
  name: string
  /** ESPN's displayValue verbatim, e.g. "9/12, 73 YDS". Never recomposed. */
  statLine: string
  position: string | null
  headshot: string | null
  category: string | null
  teamId: string | null
}

export type GameSituation = {
  /** "1st & 5 at CIN 12". */
  downDistanceText: string | null
  shortDownDistanceText: string | null
  distance: number | null
  possessionTeamId: string | null
  /**
   * Ball position on a 0–100 axis measured from the AWAY team's goal line, or
   * null when it cannot be placed. See `ballOnFromAwayGoal` for why this is
   * derived from `possessionText` rather than read from `yardLine`.
   */
  ballOnFromAway: number | null
  isRedZone: boolean
  homeTimeouts: number | null
  awayTimeouts: number | null
  lastPlayText: string | null
  lastPlayType: string | null
}

const FOOTBALL_LEADER_ORDER = ['passingYards', 'rushingYards', 'receivingYards']

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Up to three leaders, one per category.
 *
 * Football is ordered PASS, RUSH, REC — the order ESPN's own game strip uses.
 * Every other sport keeps the feed's order, because we have no measured ordering
 * for them and inventing one would be a guess dressed as a layout decision.
 *
 * ⚠ BOTH A NAME AND A STAT LINE ARE REQUIRED. Before kickoff ESPN can send a
 * category with no athlete; a name beside an empty line reads as a data bug.
 */
export function pickGameLeaders(categories: EspnLeaderCategory[] | undefined, max = 3): GameLeader[] {
  if (!Array.isArray(categories)) return []
  const ordered = [...categories].sort((a, b) => {
    const ai = FOOTBALL_LEADER_ORDER.indexOf(String(a?.name ?? ''))
    const bi = FOOTBALL_LEADER_ORDER.indexOf(String(b?.name ?? ''))
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  const out: GameLeader[] = []
  for (const category of ordered) {
    if (out.length >= max) break
    const leader = category?.leaders?.[0]
    const athlete = leader?.athlete
    const name = text(athlete?.displayName) ?? text(athlete?.shortName)
    const statLine = text(leader?.displayValue)
    if (!name || !statLine) continue
    const headshot =
      typeof athlete?.headshot === 'string' ? athlete.headshot : text(athlete?.headshot?.href)
    const position =
      typeof athlete?.position === 'string' ? athlete.position : text(athlete?.position?.abbreviation)
    out.push({
      label: text(category.shortDisplayName) ?? text(category.displayName),
      name,
      statLine,
      position: text(position),
      headshot: text(headshot),
      category: text(category.name),
      teamId: text(leader?.team?.id) ?? text(athlete?.team?.id),
    })
  }
  return out
}

/**
 * Where the ball is, from the away goal line.
 *
 * ⚠ `yardLine` IS NOT AN ABSOLUTE POSITION. On TB @ CIN it read `12` with the
 * ball on the CINCINNATI 12 — the same number would be printed for the Tampa Bay
 * 12, eighty yards away. It is the yard marker, not the field coordinate, and
 * plotting it directly puts every drive on the wrong half half the time.
 * `possessionText` ("CIN 12") names the side, so the side decides the axis.
 *
 * Returns null — no diagram — for anything it cannot place: an unrecognised
 * team prefix, a number outside 0–50, or a bare number other than midfield.
 */
export function ballOnFromAwayGoal(
  possessionText: string | null | undefined,
  homeAbbrev: string,
  awayAbbrev: string,
): number | null {
  const match = /^\s*(?:([A-Za-z]{1,5})\s+)?(\d{1,2})\s*$/.exec(String(possessionText ?? ''))
  if (!match) return null
  const yard = Number(match[2])
  if (!Number.isFinite(yard) || yard < 0 || yard > 50) return null
  const side = match[1]?.toUpperCase()
  if (!side) return yard === 50 ? 50 : null
  if (side === awayAbbrev.trim().toUpperCase()) return yard
  if (side === homeAbbrev.trim().toUpperCase()) return 100 - yard
  return null
}

export function mapGameSituation(
  situation: EspnSituation | undefined | null,
  homeAbbrev: string,
  awayAbbrev: string,
): GameSituation | null {
  if (!situation || typeof situation !== 'object') return null
  const mapped: GameSituation = {
    downDistanceText: text(situation.downDistanceText),
    shortDownDistanceText: text(situation.shortDownDistanceText),
    distance: finite(situation.distance),
    possessionTeamId: text(situation.possession),
    ballOnFromAway: ballOnFromAwayGoal(situation.possessionText, homeAbbrev, awayAbbrev),
    isRedZone: situation.isRedZone === true,
    homeTimeouts: finite(situation.homeTimeouts),
    awayTimeouts: finite(situation.awayTimeouts),
    lastPlayText: text(situation.lastPlay?.text),
    lastPlayType: text(situation.lastPlay?.type?.text),
  }
  const hasAnything =
    mapped.downDistanceText != null || mapped.ballOnFromAway != null || mapped.lastPlayText != null
  return hasAnything ? mapped : null
}

/** "Cincinnati, OH" — or the country when there is no state, or null. */
export function formatVenueLocation(
  address: { city?: string; state?: string; country?: string } | undefined | null,
): string | null {
  const city = text(address?.city)
  const region = text(address?.state) ?? text(address?.country)
  if (city && region) return `${city}, ${region}`
  return city ?? region ?? null
}

/** Per-period points, in period order. Anything non-numeric ends the list. */
export function linescoreValues(
  linescores: Array<{ value?: number; displayValue?: string }> | undefined | null,
): number[] {
  if (!Array.isArray(linescores)) return []
  const out: number[] = []
  for (const l of linescores) {
    const n = finite(l?.value) ?? (l?.displayValue != null ? Number(l.displayValue) : NaN)
    if (!Number.isFinite(n)) break
    out.push(n)
  }
  return out
}
