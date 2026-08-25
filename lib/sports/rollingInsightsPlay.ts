import { resolveNflTeamRef, type CanonicalTeamId } from '@/lib/sports/teamRef'

/**
 * ROLLING INSIGHTS PLAY-BY-PLAY — parsing and classification.
 *
 * ⚠ THE CONTRACT IS THE AUTHORITY, NOT THE VENDOR. Everything here is derived
 * from `contracts/rolling-insights/PLAY-BY-PLAY.yaml` (captured 2026-08-16 from
 * the OpenAPI 3.1.0 spec). Nothing was probed to write it, per the repo rule.
 * When a field's meaning is unresolved in `GAPS.md`, this module refuses to
 * assert it rather than guessing.
 *
 * ⚠ PURE. No network, no database, no provider call. Rolling Insights passes
 * `RSC_token` as a QUERY PARAMETER, so a request path that touches the vendor
 * leaks a long-lived credential into any logged URL — this file exists so the
 * parsing can be written and tested long before an ingestion module runs.
 *
 * ⚠ TOUCHDOWN IS NOT IN THE `event` ENUM. The contract calls this "the biggest
 * gotcha in this schema": there is no `scoringType`, and neither touchdown nor
 * two-point conversion appears in `event`. A scoring classification that reads
 * `event` alone misses every touchdown in the feed.
 */

/** From the contract's `event` enum. `not_available` is a real value, not a null. */
export type PlayEvent =
  | 'kickoff'
  | 'pass'
  | 'run'
  | 'sack'
  | 'interception'
  | 'incompletion'
  | 'fumble'
  | 'penalty'
  | 'field_goal'
  | 'punt'
  | 'safety'
  | 'not_available'

export type ScoringKind =
  | 'touchdown'
  | 'field_goal'
  | 'safety'
  | 'extra_point'
  | 'two_point'
  | 'none'

export type PlayUnit = 'offense' | 'defense' | 'special_teams' | 'unknown'

export type PlayParticipant = {
  /** Contract: INTEGER here, but a STRING on /injuries. Normalized to string. */
  id: string | null
  name: string
  role: string
  action: string
  position: string | null
  teamAbbr: string | null
}

export type ParsedPlay = {
  sequence: number
  quarter: number | null
  gameClock: string | null
  event: PlayEvent
  down: number | null
  yardsToGo: number | null
  /** Territory-prefixed STRING, e.g. "BUF 25" — never an integer here. */
  yardLine: string | null
  yardsGained: number | null
  possessionTeam: CanonicalTeamId | null
  isTouchdown: boolean
  isScoringPlay: boolean
  isFirstDown: boolean
  isReturned: boolean
  isReversed: boolean
  success: boolean
  description: string
  players: PlayParticipant[]
}

const EVENTS = new Set<PlayEvent>([
  'kickoff',
  'pass',
  'run',
  'sack',
  'interception',
  'incompletion',
  'fumble',
  'penalty',
  'field_goal',
  'punt',
  'safety',
  'not_available',
])

/** The contract's own threshold for a big play. */
export const BIG_PLAY_YARDS = 20

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}
function bool(v: unknown): boolean {
  return v === true
}

/**
 * Parse one raw play. Returns null when the object is not a play at all, so a
 * malformed element cannot masquerade as a 0-yard non-scoring play.
 */
export function parseRollingInsightsPlay(raw: unknown): ParsedPlay | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const sequence = num(r.sequence)
  if (sequence == null) return null

  const rawEvent = str(r.event)
  const event: PlayEvent =
    rawEvent && EVENTS.has(rawEvent as PlayEvent) ? (rawEvent as PlayEvent) : 'not_available'

  const players: PlayParticipant[] = Array.isArray(r.players)
    ? r.players
        .map((p) => {
          if (!p || typeof p !== 'object') return null
          const pr = p as Record<string, unknown>
          const name = str(pr.name)
          if (!name) return null
          return {
            // Cast on join: integer here, string on /injuries.
            id: pr.id == null ? null : String(pr.id),
            name,
            role: str(pr.role) ?? 'unknown',
            action: str(pr.action) ?? 'unknown',
            position: str(pr.position),
            teamAbbr: str(pr.teamAbbr),
          }
        })
        .filter((p): p is PlayParticipant => p != null)
    : []

  return {
    sequence,
    quarter: num(r.quarter),
    gameClock: str(r.gameClock),
    event,
    down: num(r.down),
    yardsToGo: num(r.yardsToGo),
    yardLine: str(r.yardLine),
    yardsGained: num(r.yardsGained),
    /*
     * `possession` is the FULL team name here ("Buffalo Bills"), while
     * `full_box.current.Possession` is an abbreviation ("BUF"). Both resolve
     * through the same canonical reader so the two never diverge downstream.
     */
    possessionTeam: resolveNflTeamRef(str(r.possession)),
    isTouchdown: bool(r.isTouchdown),
    isScoringPlay: bool(r.isScoringPlay),
    isFirstDown: bool(r.isFirstDown),
    isReturned: bool(r.isReturned),
    isReversed: bool(r.isReversed),
    success: bool(r.success),
    description: str(r.description) ?? '',
    players,
  }
}

/**
 * What, if anything, this play scored.
 *
 * ⚠ FOUR SIGNALS, NOT ONE. Per the contract: touchdown is `isTouchdown`, not an
 * event; a field goal is `event === 'field_goal' AND success`; extra points and
 * two-point conversions live under `details.pointsAfterTouchdown.type`, which is
 * why `details` is passed separately rather than being folded into ParsedPlay.
 */
export function classifyScoring(play: ParsedPlay, details?: unknown): ScoringKind {
  if (play.isTouchdown) return 'touchdown'

  const pat = (details as Record<string, unknown> | undefined)?.pointsAfterTouchdown
  const patType = str((pat as Record<string, unknown> | undefined)?.type)
  if (patType === 'extra_point') return 'extra_point'
  if (patType === 'two_point_conversion') return 'two_point'

  if (play.event === 'field_goal' && play.success) return 'field_goal'
  if (play.event === 'safety') return 'safety'
  return 'none'
}

/** The contract's definition: 20 or more yards gained. */
export function isBigPlay(play: ParsedPlay): boolean {
  return (play.yardsGained ?? 0) >= BIG_PLAY_YARDS
}

/**
 * Which unit made the play.
 *
 * ⚠ THE CONTRACT SAYS NOT TO TRUST `event` ALONE — a defensive touchdown carries
 * a player with role `interceptor` or `recoverer`, and the roles are checked
 * here for exactly that reason. Anything the two signals cannot agree on returns
 * `unknown` rather than a default, because attributing a touchdown to the wrong
 * unit is the visible kind of wrong.
 */
export function attributeUnit(play: ParsedPlay): PlayUnit {
  const roles = new Set(play.players.map((p) => p.role))
  const defensiveRole = roles.has('interceptor') || roles.has('recoverer')

  if (play.event === 'kickoff' || play.event === 'punt' || play.event === 'field_goal') {
    return 'special_teams'
  }
  if (play.event === 'safety') return 'defense'
  if (play.event === 'interception' || play.event === 'fumble') {
    return defensiveRole || play.isTouchdown ? 'defense' : 'offense'
  }
  if (play.event === 'pass' || play.event === 'run' || play.event === 'incompletion') {
    // A pass that ends in the defence's hands is not an offensive play.
    return defensiveRole ? 'defense' : 'offense'
  }
  if (play.event === 'sack') return 'defense'
  return 'unknown'
}

/**
 * Who the play is ABOUT, for an alert or a recap line.
 *
 * ⚠ `fumbler` IS DELIBERATELY NOT USED. GAPS.md N-06 records that it is
 * unresolved whether `role: 'fumbler'` names the player who fumbled or the one
 * who forced it. Those are opposite claims about opposite teams, so until the
 * gap is closed this returns the scorer, the passer or the rusher — never a
 * fumble attribution.
 */
export function primaryPlayer(play: ParsedPlay): PlayParticipant | null {
  const byRole = (role: string) => play.players.find((p) => p.role === role) ?? null
  return (
    byRole('receiver') ??
    byRole('rusher') ??
    byRole('interceptor') ??
    byRole('returner') ??
    byRole('kicker') ??
    byRole('passer') ??
    null
  )
}

/**
 * A one-line, contract-safe summary. Uses only fields the spec marks required
 * for NFL — `points`, `score`, `epa`, `win_probability`, `driveId` and `redZone`
 * are NBA-only or absent and are never referenced.
 */
export function describePlay(play: ParsedPlay, details?: unknown): string {
  const scoring = classifyScoring(play, details)
  const who = primaryPlayer(play)
  const bits: string[] = []
  if (play.quarter != null) bits.push(`Q${play.quarter}`)
  if (play.gameClock) bits.push(play.gameClock)
  const head = bits.length > 0 ? `${bits.join(' ')} — ` : ''
  const yards = play.yardsGained != null ? `${play.yardsGained} yd` : 'no gain'
  const tag =
    scoring === 'touchdown'
      ? ' TOUCHDOWN'
      : scoring === 'field_goal'
        ? ' FIELD GOAL'
        : scoring === 'safety'
          ? ' SAFETY'
          : isBigPlay(play)
            ? ' (big play)'
            : ''
  return `${head}${play.event}${who ? ` by ${who.name}` : ''}, ${yards}${tag}`
}
