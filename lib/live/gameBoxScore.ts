import type { GameDetailPlayerLine, LiveGameDetail } from '@/lib/live/espnGameSummary'
import { liveTeamAbbreviation } from '@/lib/live/teamAbbreviation'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'

/**
 * The football box score and "your starters' lines" for the clicked-game view.
 *
 * Pure, over data the view ALREADY holds: `trimEspnGameSummary` keeps ESPN's
 * per-player box lines in `detail.players` for every sport, and before this the
 * football view used them only to caption the last play. Basketball, hockey and
 * baseball each had a box score; football — the sport most leagues here play —
 * had none.
 */

/** Always shown: the lines fantasy scoring is made of. */
export const FOOTBALL_MAIN_GROUPS = ['passing', 'rushing', 'receiving', 'kicking'] as const
/** Behind a disclosure: real, but not what someone opening a game looks for first. */
export const FOOTBALL_MORE_GROUPS = ['defensive', 'interceptions', 'fumbles', 'kickReturns', 'puntReturns', 'punting'] as const

export const FOOTBALL_GROUP_TITLES: Record<string, string> = {
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  kicking: 'Kicking',
  defensive: 'Defense',
  interceptions: 'Interceptions',
  fumbles: 'Fumbles',
  kickReturns: 'Kick returns',
  puntReturns: 'Punt returns',
  punting: 'Punting',
}

const FOOTBALL_GROUPS = new Set<string>([...FOOTBALL_MAIN_GROUPS, ...FOOTBALL_MORE_GROUPS])

export type BoxGroup = {
  group: string
  title: string
  labels: string[]
  rows: Array<{ athleteId: string; name: string; jersey: string | null; stats: string[] }>
}

export type FootballBoxTeam = { teamId: string; groups: BoxGroup[] }

/** True for a summary whose box lines are football's. Other sports have their own box score. */
export function hasFootballBox(detail: Pick<LiveGameDetail, 'players' | 'basketball' | 'hockey' | 'baseball'>): boolean {
  if (detail.basketball || detail.hockey || detail.baseball) return false
  return Object.values(detail.players).some((lines) => lines.some((l) => FOOTBALL_GROUPS.has(l.group)))
}

/**
 * Each team's box, away first like the header, groups in a fixed order.
 *
 * Rows keep ESPN's order within a group, which is its own leader order (the
 * starting QB first, the lead back first). Labels come from the line itself —
 * ESPN's columns for that group — so a column ESPN adds shows up rather than
 * being silently dropped by a hardcoded list.
 */
export function footballBoxTeams(detail: Pick<LiveGameDetail, 'players' | 'home' | 'away'>): FootballBoxTeam[] {
  const order = [...FOOTBALL_MAIN_GROUPS, ...FOOTBALL_MORE_GROUPS] as readonly string[]
  return [detail.away, detail.home].map((team) => {
    const byGroup = new Map<string, BoxGroup>()
    for (const [athleteId, lines] of Object.entries(detail.players)) {
      for (const line of lines) {
        if (line.teamId !== team.id || !FOOTBALL_GROUPS.has(line.group)) continue
        let g = byGroup.get(line.group)
        if (!g) {
          g = { group: line.group, title: FOOTBALL_GROUP_TITLES[line.group] ?? line.group, labels: line.labels, rows: [] }
          byGroup.set(line.group, g)
        }
        g.rows.push({ athleteId, name: line.name, jersey: line.jersey, stats: line.stats })
      }
    }
    return {
      teamId: team.id,
      groups: order.map((name) => byGroup.get(name)).filter((g): g is BoxGroup => g != null && g.rows.length > 0),
    }
  })
}

/**
 * The box-score athlete who IS this starter, or null.
 *
 * ⚠ BY NORMALISED NAME WITHIN HIS OWN TEAM, AND ONLY WHEN THE ANSWER IS UNIQUE.
 * The roster side is our player registry; the box side is ESPN. They share no id,
 * and they disagree on case, punctuation and suffixes (see `rosterPlayMatch.ts`).
 * Two players of one name on one team is rare but real, and pinning a stat line
 * to the wrong one is worse than showing none — so an ambiguous name matches
 * nobody. With no team known, both sides are searched under the same rule.
 */
export function boxAthleteForStarter(
  detail: Pick<LiveGameDetail, 'players' | 'home' | 'away' | 'sport'>,
  starter: { playerName: string; team: string | null },
): string | null {
  const key = normalizeMatchName(starter.playerName)
  if (!key) return null
  let teamId: string | null = null
  if (starter.team) {
    const want = liveTeamAbbreviation(starter.team, detail.sport)
    if (liveTeamAbbreviation(detail.home.abbrev, detail.sport) === want) teamId = detail.home.id
    else if (liveTeamAbbreviation(detail.away.abbrev, detail.sport) === want) teamId = detail.away.id
  }
  const hits = Object.entries(detail.players).filter(([, lines]) =>
    lines.some((l) => (teamId == null || l.teamId === teamId) && normalizeMatchName(l.name) === key),
  )
  return hits.length === 1 ? hits[0]![0] : null
}

/*
 * Which of a player's lines to show first, by position. A QB's rushing line
 * matters to fantasy; a WR's passing line almost never exists.
 */
const POSITION_GROUPS: Record<string, string[]> = {
  QB: ['passing', 'rushing'],
  RB: ['rushing', 'receiving'],
  FB: ['rushing', 'receiving'],
  WR: ['receiving', 'rushing'],
  TE: ['receiving', 'rushing'],
  K: ['kicking'],
  PK: ['kicking'],
  P: ['punting'],
}
const DEFENSIVE_GROUPS = ['defensive', 'interceptions', 'fumbles']
const DEFAULT_GROUPS = ['passing', 'rushing', 'receiving', 'defensive', 'kicking']

/** Up to two of a starter's box lines, the ones his position scores from first. */
export function starterStatLines(lines: readonly GameDetailPlayerLine[], position: string | null): GameDetailPlayerLine[] {
  const pos = (position ?? '').toUpperCase()
  const order =
    POSITION_GROUPS[pos] ??
    (/^(DL|DE|DT|NT|LB|ILB|OLB|MLB|EDGE|CB|S|FS|SS|DB)$/.test(pos) ? DEFENSIVE_GROUPS : DEFAULT_GROUPS)
  const out: GameDetailPlayerLine[] = []
  for (const g of order) {
    const hit = lines.find((l) => l.group === g)
    if (hit) out.push(hit)
    if (out.length === 2) break
  }
  /*
   * Other sports keep one box line per player under their own group
   * ('basketball', 'batting', 'forwards'…), which no football order names. Their
   * first line is the right one — `statCells` already knows each group's columns.
   */
  // Not for football: an RB whose only line is `fumbles` has no line worth leading with.
  if (out.length === 0 && lines[0] && !FOOTBALL_GROUPS.has(lines[0].group)) out.push(lines[0])
  return out
}
