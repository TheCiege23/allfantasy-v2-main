import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'

/** Independent full-week calendar must agree before a pilot may score or seal. */
export function pirateDailySlateComplete(expected: ScheduleGame[] | null,
  observed: Array<{ homeTeamFull: string; awayTeamFull: string; startTime: string }>): boolean {
  if (!expected) return false
  const games = expected.filter(g => (g.seasonType == null || g.seasonType === 'regular') && !g.replacedBy && g.status !== 'replaced')
  const key = (home: unknown, away: unknown, at: unknown): string | null => {
    if (typeof home !== 'string' || !home.trim() || typeof away !== 'string' || !away.trim() || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null
    const name = (s: string) => normalizeLockTeam('NBA', s)
    return `${name(home)}:${name(away)}:${Date.parse(at)}`
  }
  const wanted = games.map(g => key(g.homeTeam, g.awayTeam, g.startTime))
  const found = observed.map(g => key(g.homeTeamFull, g.awayTeamFull, g.startTime))
  return wanted.length > 0 && !wanted.includes(null) && !found.includes(null) && wanted.length === found.length &&
    new Set(wanted).size === wanted.length && new Set(found).size === found.length && wanted.every(k => found.includes(k))
}
