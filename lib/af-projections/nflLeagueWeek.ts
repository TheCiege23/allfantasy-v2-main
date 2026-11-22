import 'server-only'

import { COMPONENT_RULE_KEYS, type IdpComponent } from './idpScoring'
import { prisma } from '@/lib/prisma'
import type { PlayerProjection } from '@/lib/core-app/playerProjections'
import { projectionTeamKey, loadProjectionSchedule } from './leagueProjectionSchedule'
import { loadNflSpecialistRates } from './nflSpecialistRates'
import type { SpecialistRate } from './nflSpecialistRatesModel'

/** AF's seasonal component rates, scaled to the opportunities in the requested NFL week.
 * Keep both identity spaces so league projections, roster tools and the wire share one line. */
export type NflWeekLine = PlayerProjection & { key: string; weekGames: number }
export function nflComponentRates(factors: Record<string, unknown>, games = 1): Record<string, number> {
  const rates = factors.perGameRates

  const components: Record<string, number> = {}
  if (rates && typeof rates === 'object' && !Array.isArray(rates)) {
    for (const [stat, amount] of Object.entries(rates)) {
      if (typeof amount === 'number' && Number.isFinite(amount)) components[stat] = amount * games
    }
  }
  const idp = factors.idp
  const amounts = idp && typeof idp === 'object' && !Array.isArray(idp) ? (idp as Record<string, unknown>).componentAmounts : null
  if (amounts && typeof amounts === 'object' && !Array.isArray(amounts)) {
    for (const [stat, amount] of Object.entries(amounts)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      for (const key of COMPONENT_RULE_KEYS[stat as IdpComponent] ?? []) components[key] = amount * games
    }
  }
  return components
}

async function readWeek(season: number, week: number): Promise<Map<string, NflWeekLine>> {
  const [rows, schedule, specialists] = await Promise.all([
    prisma.aFProjectionSnapshot.findMany({
      where: { sport: 'NFL', season, week: null, eventId: null },
      select: { playerId: true, playerName: true, position: true, afProjection: true, adjustmentFactors: true },
    }),
    loadProjectionSchedule({ sport: 'NFL', season, week, now: new Date() }),
    // A failed read leaves kickers as they were (no distance buckets) and never fails the week.
    loadNflSpecialistRates(season).catch(() => new Map<string, SpecialistRate>()),
  ])
  const ids = rows.map((row) => row.playerId)
  const [links, statTeams] = await Promise.all([
    prisma.playerIdentityMap.findMany({ where: { sport: 'NFL', id: { in: ids } }, select: { id: true, sleeperId: true, currentTeam: true } }),
    prisma.fantasyStatLine.findMany({ where: { sport: 'NFL', season: String(season), week: 0, playerId: { in: ids }, team: { not: null } },
      select: { playerId: true, team: true } }),
  ])
  const byId = new Map(links.map((r) => [r.id, r]))
  const teams = new Map<string, string | null>()
  for (const r of statTeams) teams.set(r.playerId, teams.has(r.playerId) && teams.get(r.playerId) !== r.team ? null : r.team)
  const result = new Map<string, NflWeekLine>()
  for (const row of rows) {
    const linked = byId.get(row.playerId)
    if (!linked?.sleeperId) continue
    const team = [linked.currentTeam, teams.get(row.playerId)].find((t) => t && schedule.has(projectionTeamKey('NFL', t)!))
    const games = team ? schedule.get(projectionTeamKey('NFL', team)!)?.weekGames : null
    const factors = row.adjustmentFactors
    if (games == null || !factors || typeof factors !== 'object' || Array.isArray(factors)) continue
    const components = nflComponentRates(factors, games)
    // A kicker's season snapshot has his field goals with no distance, which no league rule can
    // price. His own makes by distance, from this season's game logs, are what the rules read.
    const kicking = row.position === 'K' ? specialists.get(linked.sleeperId) : undefined
    if (kicking?.kind === 'K') for (const [stat, perGame] of Object.entries(kicking.perGame)) components[stat] = perGame * games
    if (!Object.keys(components).length) continue
    result.set(linked.sleeperId, { key: row.playerId, playerId: linked.sleeperId, name: row.playerName, position: row.position, team: team ?? null,
      weekGames: games, componentStats: components, projectedPoints: row.afProjection * games, source: 'allfantasy' })
  }
  return result
}

/**
 * How long one week's AF NFL lines are reused in this process (2026-11-22: was 60 seconds).
 *
 * ⚠ WHY FIVE MINUTES. Every rail board, the waiver boards and player projections read this; the rows behind it
 * (`AFProjectionSnapshot`, season rows) are recomputed once a day (`/api/cron/compute-projections`, 07:50). The
 * database half is ~40 ms, but turning ~1,900 rows (~2 MB, 1.1 KB each) into lines costs ~0.8 s on a busy process,
 * and at 60 seconds nearly every /core open more than a minute apart paid it: production's `[rail-boards-timing]`
 * showed the first four boards finishing at the same instant (776/776/776 ms), all waiting on this read. Five
 * minutes matches `FOOTBALL_SEASON_ROWS_TTL_MS` beside it. The cost: a daily recompute shows up to five minutes
 * later than before, instead of up to one.
 */
export const AF_NFL_WEEK_TTL_MS = 5 * 60_000

const cache = new Map<string, { at: number; rows: Promise<Map<string, NflWeekLine>> }>()
export function loadAfNflWeek(at: { season: string; week: number }) {
  const key = at.season + ':' + at.week
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at > AF_NFL_WEEK_TTL_MS) cache.delete(k)
  const existing = cache.get(key)
  if (existing) return existing.rows
  const rows = readWeek(Number(at.season), at.week).catch((error) => {
    if (cache.get(key)?.rows === rows) cache.delete(key)
    throw error
  })
  cache.set(key, { at: now, rows })
  return rows
}
