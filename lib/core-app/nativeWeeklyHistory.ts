import 'server-only'
import { prisma } from '@/lib/prisma'
import { weeklyScopeKey } from './weeklyCapabilities'
import type { MatchupRow } from './weekBoard'

/** AF's own matchups and roster ownership; no external IDs or guessed opponents. */
export async function readNativeWeeklyHistory(userId: string, leagueIds: string[]) {
  const [seasons, rosters, games] = await Promise.all([
    prisma.redraftSeason.findMany({ where: { leagueId: { in: leagueIds } }, select: { id: true, leagueId: true, season: true, currentWeek: true, playoffStartWeek: true, medianGame: true }, orderBy: { season: 'desc' } }),
    prisma.redraftRoster.findMany({ where: { leagueId: { in: leagueIds } }, select: { id: true, leagueId: true, ownerId: true, ownerName: true, teamName: true, avatarUrl: true, season: { select: { season: true } } }, orderBy: { season: { season: 'desc' } } }),
    prisma.redraftMatchup.findMany({ where: { leagueId: { in: leagueIds }, isMedianMatchup: false }, select: { id: true, leagueId: true, homeRosterId: true, awayRosterId: true, week: true, homeScore: true, awayScore: true, status: true, season: { select: { season: true } } } }),
  ])
  const currentRoster = new Map<string, string>()
  for (const r of rosters) if (!currentRoster.has(`${r.leagueId}:${r.ownerId}`)) currentRoster.set(`${r.leagueId}:${r.ownerId}`, r.id)
  const byId = new Map(rosters.map(r => [r.id, r]))
  const names = new Map<string, string>(), avatars = new Map<string, string>(), mine = new Map<string, string>()
  for (const r of rosters) {
    const scope = weeklyScopeKey({ id: r.leagueId, platform: 'native' })
    const id = currentRoster.get(`${r.leagueId}:${r.ownerId}`)!
    const key = `${scope}:${id}`
    if (!names.has(key)) names.set(key, r.teamName?.trim() || r.ownerName)
    if (!avatars.has(key) && r.avatarUrl && /^https:\/\//.test(r.avatarUrl)) avatars.set(key, r.avatarUrl)
    if (r.ownerId === userId) mine.set(key, id)
  }
  const rows: MatchupRow[] = []
  for (const [i, g] of games.entries()) {
    const scope = weeklyScopeKey({ id: g.leagueId, platform: 'native' })
    const home = byId.get(g.homeRosterId), away = g.awayRosterId ? byId.get(g.awayRosterId) : null
    if (!home) continue
    const rosterId = (r: typeof home) => currentRoster.get(`${r.leagueId}:${r.ownerId}`) ?? r.id
    const common = { leagueId: scope, seasonYear: g.season.season, week: g.week, matchupId: away ? i + 1 : null, finalized: g.status === 'final', scored: g.status === 'final' || g.homeScore !== 0 || g.awayScore !== 0 }
    rows.push({ ...common, rosterId: rosterId(home), pointsFor: g.homeScore, pointsAgainst: g.awayScore, win: g.status === 'final' && g.homeScore > g.awayScore ? 1 : 0 })
    if (away) rows.push({ ...common, rosterId: rosterId(away), pointsFor: g.awayScore, pointsAgainst: g.homeScore, win: g.status === 'final' && g.awayScore > g.homeScore ? 1 : 0 })
  }
  const periods = new Map<string, { season: number; week: number }>()
  const rules = new Map<string, { season: number; playoffStartWeek: number; medianGame: boolean }>()
  for (const s of seasons) {
    const scope = weeklyScopeKey({ id: s.leagueId, platform: 'native' })
    if (rules.has(scope)) continue
    rules.set(scope, { season: s.season, playoffStartWeek: s.playoffStartWeek, medianGame: s.medianGame })
    const current = rows.filter(r => r.leagueId === scope && r.seasonYear === s.season)
    const pending = current.filter(r => !r.finalized).map(r => r.week)
    const week = s.currentWeek > 0 ? s.currentWeek : pending.length ? Math.min(...pending) : Math.max(0, ...current.map(r => r.week))
    if (week > 0) periods.set(scope, { season: s.season, week })
  }
  return { rows, names, avatars, mine, periods, rules }
}
