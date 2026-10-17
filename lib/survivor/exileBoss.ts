import 'server-only'

import type { Prisma } from '@prisma/client'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { EXILE_BOSS_USER_ID, addExilePlayer, emptyExileRoster, isExileAnchor, readExileRoster, type ExileWeeklyRoster } from './exileRosterRules'
import { exileWeekWindow } from './exileRosterService'

/**
 * EXILE BOSS — Chimmy fields one team in the weekly Exile contest. The exile whose team scores
 * the most earns a token, but if Chimmy's team outscores every exile, all Exile tokens reset to 0.
 * Chimmy follows the exiles' own rules: one NBA team per roster, exclusive for the week.
 */

export { EXILE_BOSS_USER_ID }

type Db = Prisma.TransactionClient
type Candidate = { id: string; name: string; position: string; team: string; average: number }

/** Most games still to play in the window wins; then alphabetical, so the pick is reproducible. */
export function chooseBossTeam(games: Array<{ homeTeam: string | null; awayTeam: string | null }>, taken: string[]): string | null {
  const counts = new Map<string, number>()
  for (const game of games) for (const side of [game.homeTeam, game.awayTeam]) {
    const team = side?.trim().toUpperCase()
    if (team && !taken.includes(team)) counts.set(team, (counts.get(team) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

/** Anchor first, then the best recent producers into whatever slots they fit. */
export function buildBossRoster(sport: string, settings: unknown, players: Candidate[], taken: string[]): ExileWeeklyRoster {
  const ranked = [...players].sort((a, b) => b.average - a.average || a.name.localeCompare(b.name))
  const anchor = ranked.find(player => isExileAnchor(sport, player.position))
  if (!anchor) return emptyExileRoster()
  let roster = addExilePlayer(emptyExileRoster(), anchor, sport, settings, taken)
  for (const player of ranked) {
    if (player.id === anchor.id) continue
    try { roster = addExilePlayer(roster, player, sport, settings, taken) } catch { /* no slot fits this player */ }
  }
  return roster
}

/**
 * Build Chimmy's roster for the current Exile week once there is at least one exile. Runs on the
 * season tick; a no-op when the roster already exists, nobody is on Exile, or the week is unknown.
 */
export async function ensureChimmyBossRoster(leagueId: string, now = new Date()): Promise<'built' | 'exists' | 'skipped'> {
  return withSurvivorSetupTransaction(leagueId, async (db: Db) => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true, settings: true } })
    if (!league || !isNativePlatform(league.platform)) return 'skipped'
    const island = await db.exileIsland.findUnique({ where: { leagueId } })
    if (!island?.isActive || !await db.survivorPlayer.count({ where: { leagueId, playerState: 'exile' } })) return 'skipped'
    const week = dailySportWeekForInstant(league.sport, league.season, now)
    if (!week) return 'skipped'
    const window = await exileWeekWindow(db, league.sport, league.season, week)
    if (!window || now < window.start || now >= window.end) return 'skipped'
    const entries = await db.exileWeeklyEntry.findMany({ where: { exileId: island.id, week } })
    if (readExileRoster(entries.find(e => e.userId === EXILE_BOSS_USER_ID)?.submittedLineup)?.players.length) return 'exists'
    const taken = entries.filter(e => e.userId !== EXILE_BOSS_USER_ID).map(e => readExileRoster(e.submittedLineup)).filter(r => r && !r.closedAt && r.team).map(r => r!.team!)
    const games = await db.gameSchedule.findMany({ where: { sportType: league.sport, startTime: { gt: now, lt: window.end } }, select: { homeTeam: true, awayTeam: true, startTime: true } })
    const team = chooseBossTeam(games, taken)
    if (!team) return 'skipped'
    const roster = await db.player.findMany({ where: { sport: { equals: league.sport, mode: 'insensitive' }, active: true, team: { equals: team, mode: 'insensitive' } }, select: { id: true, name: true, position: true } })
    const scorer = buildLeagueStatScorer(league)
    const candidates: Candidate[] = []
    for (const player of roster) {
      if (!player.position) continue
      const recent = await db.playerWeeklyScore.findMany({ where: { playerId: player.id, season: league.season, sport: league.sport, week: { lt: week }, isFinalized: true }, orderBy: { week: 'desc' }, take: 4, select: { stats: true } })
      const points = scorer ? recent.map(row => row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats) ? scorer(row.stats as Record<string, number>, player.position!) : 0).filter(Number.isFinite) : []
      candidates.push({ id: player.id, name: player.name, position: player.position, team, average: points.length ? points.reduce((a, b) => a + b, 0) / points.length : 0 })
    }
    const lineup = buildBossRoster(league.sport, league.settings, candidates, taken)
    if (!lineup.players.length) return 'skipped'
    const firstGame = games.filter(g => [g.homeTeam, g.awayTeam].some(side => side?.trim().toUpperCase() === team)).map(g => g.startTime!).sort((a, b) => a.getTime() - b.getTime())[0]
    lineup.lockedAt = firstGame?.toISOString() ?? null
    await db.exileWeeklyEntry.upsert({
      where: { exileId_userId_week: { exileId: island.id, userId: EXILE_BOSS_USER_ID, week } },
      create: { exileId: island.id, leagueId, userId: EXILE_BOSS_USER_ID, week, submittedLineup: lineup as unknown as Prisma.InputJsonValue },
      update: { submittedLineup: lineup as unknown as Prisma.InputJsonValue },
    })
    await db.survivorAuditEntry.create({ data: { leagueId, week, category: 'exile', action: 'exile_boss_roster_set', targetUserId: EXILE_BOSS_USER_ID, data: { team, playerIds: lineup.players.map(p => p.id) }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    return 'built'
  })
}
