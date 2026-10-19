/**
 * Pure shaping for the Zombie specialty home (handoff zombie/ZombieHome + ZombieInfection).
 * Inputs are the summary and universe-standings payloads, which the server has already redacted:
 * a hidden Whisperer arrives as a Survivor, so nothing here can reveal one.
 */

export type UniverseRow = {
  leagueId: string
  rosterId: string
  levelId: string
  levelName: string
  status: string
  leagueName?: string
}

export type UniverseCell = 'whisperer' | 'zombie' | 'survivor'

export type UniverseLeague = {
  leagueId: string
  leagueName: string
  cells: UniverseCell[]
  turned: number
  total: number
  isMine: boolean
}

export type UniverseLevel = { levelId: string; levelName: string; leagues: UniverseLeague[] }

/** Level order top-down: Alpha, Beta, Gamma (the spec's ladder); unknown names after, alphabetically. */
const LEVEL_RANK: Record<string, number> = { alpha: 0, beta: 1, gamma: 2 }

function cellFor(status: string): UniverseCell {
  const s = status.toLowerCase()
  if (s === 'whisperer') return 'whisperer'
  if (s === 'zombie') return 'zombie'
  return 'survivor'
}

export function buildUniverseMap(rows: UniverseRow[], myLeagueId: string): UniverseLevel[] {
  const levels = new Map<string, { levelName: string; leagues: Map<string, UniverseLeague> }>()
  for (const r of rows) {
    let lv = levels.get(r.levelId)
    if (!lv) {
      lv = { levelName: r.levelName, leagues: new Map() }
      levels.set(r.levelId, lv)
    }
    let lg = lv.leagues.get(r.leagueId)
    if (!lg) {
      lg = { leagueId: r.leagueId, leagueName: r.leagueName || 'League', cells: [], turned: 0, total: 0, isMine: r.leagueId === myLeagueId }
      lv.leagues.set(r.leagueId, lg)
    }
    const c = cellFor(r.status)
    lg.cells.push(c)
    lg.total += 1
    if (c === 'zombie') lg.turned += 1
  }
  const order: Record<UniverseCell, number> = { whisperer: 0, zombie: 1, survivor: 2 }
  const out: UniverseLevel[] = []
  for (const [levelId, lv] of levels) {
    const leagues = [...lv.leagues.values()]
    for (const l of leagues) l.cells.sort((a, b) => order[a] - order[b])
    leagues.sort((a, b) => a.leagueName.localeCompare(b.leagueName, undefined, { numeric: true }))
    out.push({ levelId, levelName: lv.levelName, leagues })
  }
  return out.sort((a, b) => {
    const ra = LEVEL_RANK[a.levelName.toLowerCase()] ?? 9
    const rb = LEVEL_RANK[b.levelName.toLowerCase()] ?? 9
    return ra - rb || a.levelName.localeCompare(b.levelName)
  })
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Whole days until the sport's resolution day (`ZombieSportConfig.resolutionDay`), 0 on the day itself.
 * The engine runs infections once results are final on that day — not at a fixed minute — so the home
 * shows a day count, never a ticking clock it cannot honour. Null for an unknown day name.
 */
export function daysUntilResolution(resolutionDay: string, now: Date = new Date()): number | null {
  const target = DAYS.indexOf(resolutionDay.trim().toLowerCase())
  if (target < 0) return null
  return (target - now.getDay() + 7) % 7
}

export type InfectionHeadline = { head: string; tone: 'bitten' | 'turned' | 'human' | 'revived' | 'feeding' }

/**
 * The big line on Infection night for the viewer's resolved week. `moment` is the summary's
 * `turnMoment` when the week changed the viewer's status; otherwise derive from status + result.
 */
export function infectionHeadline(args: {
  momentKind?: 'turned' | 'survived' | 'revived' | null
  myStatus: 'survivor' | 'revived' | 'zombie' | 'whisperer' | null
  won: boolean | null
}): InfectionHeadline {
  if (args.momentKind === 'turned') return { head: "You've been bitten", tone: 'turned' }
  if (args.momentKind === 'revived') return { head: "You're back", tone: 'revived' }
  if (args.momentKind === 'survived') return { head: 'Still human', tone: 'human' }
  if (args.myStatus === 'zombie' || args.myStatus === 'whisperer') {
    return args.won ? { head: 'The horde feeds', tone: 'feeding' } : { head: 'Still hungry', tone: 'feeding' }
  }
  return { head: 'Still human', tone: 'human' }
}
