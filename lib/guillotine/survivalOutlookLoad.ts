import 'server-only'

/**
 * Server half of ./survivalOutlook.ts: for each team alive in a native Guilly league, its starters this
 * week, how many games each still has, and the AF projection for those games. Keyed by the LEAGUE roster
 * id — the id the chop line (`dangerTiers`, `home.scores`) is keyed by — mapped from the season's redraft
 * rosters exactly as the chop preview maps them (./chopPreviewLoad.ts).
 *
 * Reads only: the stored week slate (`readWeekGames`), the week's lineups and the AF projection board the
 * matchup screen already uses (`loadMatchupAfProjections`). No provider is called. Never throws: a part
 * that cannot be read leaves the outlook null and the board shows no odds rather than wrong ones.
 */
import { prisma } from '@/lib/prisma'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { projectionTeamKey } from '@/lib/af-projections/leagueProjectionSchedule'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { loadMatchupAfProjections } from '@/lib/matchup-center/afProjections'
import { rosterIdForOwner } from './finishGuillotineSeason'
import { teamOutlook, type StarterGames, type TeamOutlook } from './survivalOutlook'

const DAILY = new Set(['NBA', 'NHL', 'MLB', 'NCAAB', 'SOCCER'])

export async function loadSurvivalOutlook(leagueId: string, week: number, now: Date = new Date()): Promise<Record<string, TeamOutlook> | null> {
  try {
    const [league, season, rosters] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, settings: true } }),
      prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true, season: true } }),
      prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } }),
    ])
    if (!league || !season) return null
    const sport = String(league.sport ?? 'NFL').toUpperCase()
    const active = await prisma.redraftRoster.findMany({ where: { seasonId: season.id, isEliminated: false }, select: { id: true, ownerId: true } })
    const leagueRosterOf = new Map<string, string>()
    for (const r of active) {
      const id = rosters.find((x) => x.redraftRosterId === r.id)?.id ?? rosterIdForOwner(r.ownerId, rosters)
      if (id) leagueRosterOf.set(r.id, id)
    }
    const redraftIds = [...leagueRosterOf.keys()]
    if (redraftIds.length === 0) return null

    const window = DAILY.has(sport) ? resolveDailySportWeekWindow(sport, season.season, week) : null
    const [players, lineups, games] = await Promise.all([
      prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: redraftIds }, droppedAt: null },
        select: { rosterId: true, playerId: true, team: true, slotType: true, position: true },
      }),
      loadWeekLineups(prisma, { redraftRosterIds: redraftIds, season: season.season, week }),
      readWeekGames(prisma, { sport, season: season.season, week, seasonType: 'regular', dateWindow: window, now }),
    ])
    // A slate we cannot read would put every starter at "no games left" and every team at 100%.
    if (games.length === 0) return null

    const starters = players.filter((p) => isNflRedraftScoringStarterSlot(weekSlotType(p, lineups)))
    const projections = await loadMatchupAfProjections({
      leagueId,
      playerIds: starters.map((p) => p.playerId),
      season: season.season,
      week,
      sport,
      platform: league.platform ?? null,
      leagueSettings: league.settings,
    })

    // Games per team this week, and how many of them are not over yet.
    const byTeam = new Map<string, { total: number; left: number }>()
    for (const g of games) {
      const state = normalizeGameStatus(g.status)
      if (state === 'postponed' || state === 'cancelled') continue
      const over = state === 'final'
      for (const team of [g.homeTeam, g.awayTeam]) {
        const key = projectionTeamKey(sport, team)
        if (!key) continue
        const cur = byTeam.get(key) ?? { total: 0, left: 0 }
        cur.total += 1
        if (!over) cur.left += 1
        byTeam.set(key, cur)
      }
    }

    const perRoster = new Map<string, StarterGames[]>()
    for (const p of starters) {
      const key = projectionTeamKey(sport, p.team)
      const sched = key ? byTeam.get(key) : undefined
      const list = perRoster.get(p.rosterId) ?? []
      list.push({ weekProjection: projections.get(p.playerId) ?? null, gamesThisWeek: sched?.total ?? 0, gamesLeft: sched?.left ?? 0 })
      perRoster.set(p.rosterId, list)
    }

    const out: Record<string, TeamOutlook> = {}
    for (const [redraftId, leagueRosterId] of leagueRosterOf) out[leagueRosterId] = teamOutlook(perRoster.get(redraftId) ?? [])
    return out
  } catch {
    return null
  }
}
