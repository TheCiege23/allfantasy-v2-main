import 'server-only'

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { nbaTeamKey } from '@/lib/roster-lineup-engine/lineupLockService'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { addExilePlayer, emptyExileRoster, isExileAnchor, readExileRoster } from './exileRosterRules'
import { exileWeekWindow } from './exileRosterService'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

const rosterId = (leagueId: string, week: number) => `exile-chimmy-roster:${leagueId}:${week}`
const scoreId = (leagueId: string, week: number) => `exile-chimmy-score:${leagueId}:${week}`
const rank = (key: string) => createHash('sha256').update(key).digest('hex')

/** Chimmy chooses under the same one-team, PG-first, starter-capacity rules as Exile managers. */
export async function lockChimmyExileRoster(leagueId: string, now = new Date()): Promise<boolean> {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true, settings: true, survivorMode: true } })
    const island = await db.exileIsland.findUnique({ where: { leagueId }, select: { isActive: true, bossWinsEnabled: true } })
    if (!league?.survivorMode || !isNativePlatform(league.platform) || league.sport !== 'NBA' || !island?.isActive || !island.bossWinsEnabled) return false
    const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } })
    if (!game || ['pre_draft', 'drafting', 'complete'].includes(game.phase)) return false
    // Chimmy is the automatic score-to-beat in either commissioner mode.
    // Keeping the selection on the server prevents a participating host from
    // shaping the result and lets a nonplaying host run the league hands-free.
    const week = dailySportWeekForInstant('NBA', league.season, now)
    // Lock before the slate even when Exile is empty; a manager voted out
    // midweek can then enter a contest with a precommitted opponent.
    if (!week) return false
    if (await db.survivorAuditEntry.findUnique({ where: { id: rosterId(leagueId, week) }, select: { id: true } })) return true
    const window = await exileWeekWindow(db, 'NBA', league.season, week)
    if (!window || now < window.start || now >= window.end) return false
    const games = await db.gameSchedule.findMany({ where: { sportType: 'NBA', season: league.season, startTime: { gte: window.start, lt: window.end } },
      select: { homeTeam: true, awayTeam: true, startTime: true }, orderBy: { startTime: 'asc' } })
    const firstTipoff = games.find(game => game.startTime)?.startTime
    // A missed cron must not let Chimmy choose after seeing even one game.
    if (!firstTipoff || now >= firstTipoff) return false
    const teams = [...new Set(games.flatMap(game => [nbaTeamKey(game.homeTeam), nbaTeamKey(game.awayTeam)]).filter(Boolean))]
      .sort((a, b) => rank(`${leagueId}:${week}:${a}`).localeCompare(rank(`${leagueId}:${week}:${b}`)))
    const candidates = await db.player.findMany({ where: { sport: { equals: 'NBA', mode: 'insensitive' }, active: true, team: { not: null } },
      select: { id: true, name: true, position: true, team: true, draftProjectionScore: true } })
    const starterCount = [...resolveRedraftRosterConfig('NBA', league.settings).starterCapacities.values()].reduce((sum, count) => sum + count, 0)
    if (!starterCount) return false
    for (const team of teams) {
      const pool = candidates.filter(player => nbaTeamKey(player.team) === team)
        .sort((a, b) => (b.draftProjectionScore ?? -Infinity) - (a.draftProjectionScore ?? -Infinity) || a.id.localeCompare(b.id))
      const anchors = pool.filter(player => isExileAnchor('NBA', player.position))
      for (const anchor of anchors) {
        let roster = emptyExileRoster()
        try {
          roster = addExilePlayer(roster, { id: anchor.id, name: anchor.name, position: anchor.position, team }, 'NBA', league.settings, [])
          if (roster.players[0]?.slot === 'BENCH') continue
          for (const player of pool.filter(row => row.id !== anchor.id)) {
            if (roster.players.length >= starterCount) break
            try {
              const next = addExilePlayer(roster, { id: player.id, name: player.name, position: player.position, team }, 'NBA', league.settings, [])
              if (next.players.at(-1)?.slot !== 'BENCH') roster = next
            } catch { /* Player cannot fill an open starter slot. */ }
          }
          if (roster.players.length !== starterCount) continue
          roster.lockedAt = now.toISOString()
          await db.survivorAuditEntry.create({ data: { id: rosterId(leagueId, week), leagueId, week, category: 'exile', action: 'exile_boss_roster_locked',
            data: { source: 'locked_chimmy_nba_roster_v1', team, firstTipoffAt: firstTipoff.toISOString(), roster },
            isVisibleToCommissioner: true, isVisibleToPublic: true } })
          return true
        } catch { /* Try another eligible team. */ }
      }
    }
    return false
  })
}

/** Only finalized, locked player stats may become Chimmy's score-to-beat. */
export async function finalizeChimmyExileBossScore(leagueId: string, week: number, now = new Date()): Promise<boolean> {
  return withSurvivorSetupTransaction(leagueId, async (db: Prisma.TransactionClient) => {
    if (await db.survivorAuditEntry.findUnique({ where: { id: scoreId(leagueId, week) }, select: { id: true } })) return true
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true, scoring: true, settings: true } })
    if (league?.sport !== 'NBA' || !isNativePlatform(league.platform)) return false
    const window = await exileWeekWindow(db, 'NBA', league.season, week)
    if (!window || now < window.end) return false
    const locked = await db.survivorAuditEntry.findUnique({ where: { id: rosterId(leagueId, week) }, select: { data: true } })
    const data = locked?.data && typeof locked.data === 'object' && !Array.isArray(locked.data) ? locked.data as Record<string, unknown> : null
    const roster = readExileRoster(data?.roster)
    const scorer = buildLeagueStatScorer(league)
    if (!roster?.lockedAt || !roster.players.length || !scorer || data?.source !== 'locked_chimmy_nba_roster_v1') return false
    const firstTipoffAt = typeof data.firstTipoffAt === 'string' ? Date.parse(data.firstTipoffAt) : NaN
    if (!Number.isFinite(firstTipoffAt) || Date.parse(roster.lockedAt) >= firstTipoffAt) return false
    let score = 0
    for (const player of roster.players) {
      const row = await db.playerWeeklyScore.findUnique({ where: { playerId_week_season_sport: { playerId: player.id, week, season: league.season, sport: 'NBA' } } })
      if (!row?.isFinalized || !row.stats || typeof row.stats !== 'object' || Array.isArray(row.stats)) return false
      const points = scorer(row.stats as Record<string, number>, player.position)
      if (!Number.isFinite(points)) return false
      score += points
    }
    await db.survivorAuditEntry.create({ data: { id: scoreId(leagueId, week), leagueId, week, category: 'exile', action: 'exile_boss_result_finalized',
      data: { source: 'locked_chimmy_nba_roster_v1', score: Math.round(score * 100) / 100, rosterId: rosterId(leagueId, week) },
      isVisibleToCommissioner: true, isVisibleToPublic: true } })
    return true
  })
}
