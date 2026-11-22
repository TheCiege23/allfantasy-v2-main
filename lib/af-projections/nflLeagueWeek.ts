import 'server-only'

import { COMPONENT_RULE_KEYS, type IdpComponent } from './idpScoring'
import { prisma } from '@/lib/prisma'
import { liveFactorAdjustments, loadFactorTable } from './factors/factorTables'
import { contextKey, loadNflGameContext } from './factors/gameContext'
import { loadInjurySnapshots, snapshotLevelFor } from './factors/injurySnapshots'
import type { PlayerProjection } from '@/lib/core-app/playerProjections'
import { projectionTeamKey, loadProjectionSchedule } from './leagueProjectionSchedule'
import { loadNflSpecialistRates } from './nflSpecialistRates'
import { teamDefenseWeekLine, type SpecialistRate } from './nflSpecialistRatesModel'

/** AF's seasonal component rates, scaled to the opportunities in the requested NFL week.
 * Keep both identity spaces so league projections, roster tools and the wire share one line. */
export type NflWeekLine = PlayerProjection & {
  key: string
  weekGames: number
  /** The learned factors that moved this line, when any applied (`lib/af-projections/factors`). */
  afFactors?: { multiplier: number; reasons: string[] }
}
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
  await applyNflFactors(result, { season, week }).catch(() => undefined)
  return result
}

/**
 * The learned factors (`lib/af-projections/factors`) on each NFL line: form, snaps trend, a new team — the ones about the
 * player himself, which his recent game lines carry. Rest and opponent are left out here (this schedule carries no
 * kickoff time or opponent). Component stats scale with the points, so league scoring prices the same move.
 */
async function applyNflFactors(result: Map<string, NflWeekLine>, at: { season: number; week: number }): Promise<void> {
  const table = await loadFactorTable(prisma, 'NFL')
  if (!table) return
  const lines = [...result.values()].filter((l) => l.weekGames > 0)
  // This week's game context — Vegas, weather, coaching — only when the table has published one of those levels.
  const wantsContext = table.levels.some((l) => l.published && (l.factor === 'vegas' || l.factor === 'weather' || l.factor === 'coaching'))
  const ctx = wantsContext ? await loadNflGameContext(prisma, [at]).catch(() => new Map()) : new Map()
  // This week's designations, from the same snapshot the learner reads — so a player is matched the same way both times.
  const wantsInjury = table.levels.some((l) => l.published && l.factor === 'injury')
  const injuries = wantsInjury ? (await loadInjurySnapshots(prisma, [at]).catch(() => new Map())).get(`${at.season}:${at.week}`) : undefined
  const adjustments = await liveFactorAdjustments(prisma, {
    sport: 'NFL',
    table,
    players: lines.map((l) => {
      const code = projectionTeamKey('NFL', l.team)
      const injury = snapshotLevelFor(injuries, l.playerId, code)
      const game = code ? ctx.get(contextKey(at.season, at.week, code)) : undefined
      const context = game || injury ? { ...(game ?? {}), ...(injury ? { injury } : {}) } : undefined
      return { key: l.playerId, gameLogId: l.playerId, next: { atMs: Date.now(), drop: ['rest', 'opponent', 'returning'] as const, ...(context ? { context } : {}) } }
    }),
  })
  for (const [key, adj] of adjustments) {
    const line = result.get(key)
    if (!line) continue
    const scaled: Record<string, number> = {}
    for (const [stat, v] of Object.entries(line.componentStats ?? {})) scaled[stat] = typeof v === "number" ? v * adj.multiplier : (v as number)
    result.set(key, { ...line, componentStats: scaled, projectedPoints: (line.projectedPoints ?? 0) * adj.multiplier, afFactors: { multiplier: adj.multiplier, reasons: adj.reasons } })
  }
}

const cache = new Map<string, { at: number; rows: Promise<Map<string, NflWeekLine>> }>()
export function loadAfNflWeek(at: { season: string; week: number }) {
  const key = at.season + ':' + at.week
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at > 60_000) cache.delete(k)
  const existing = cache.get(key)
  if (existing) return existing.rows
  const rows = readWeek(Number(at.season), at.week).catch((error) => {
    if (cache.get(key)?.rows === rows) cache.delete(key)
    throw error
  })
  cache.set(key, { at: now, rows })
  return rows
}

/**
 * Team-defense lines for one NFL week, keyed by club code — how rosters key a defense.
 *
 * 🛑 THE WEEK POOL ABOVE HAS NO TEAM DEFENSE IN IT, AND NEVER DID: it is built from the AF engine's
 * season snapshot, which carries none. So every starting D/ST in Chimmy's lineup check read as
 * unpriced, and the check told managers "San Francisco 49ers (DEF) is starting with no week 11
 * projection — a bye, ruled out, or released" about defenses playing that day (owner report,
 * 2026-11-22: two leagues, every defense flagged). The redraft outlook already priced defenses from
 * these same season rates; the week pricing did not.
 *
 * Only ids asked for, and only clubs that play this week: a bye stays unpriced, which is true.
 */
export async function loadAfNflDefenseLines(at: { season: string; week: number }, ids: readonly string[]): Promise<Map<string, NflWeekLine>> {
  const out = new Map<string, NflWeekLine>()
  const season = Number(at.season)
  if (!Number.isFinite(season)) return out
  const specialists = await loadNflSpecialistRates(season)
  const wanted = [...new Set(ids)].filter((id) => specialists.get(id)?.kind === 'DEF')
  if (wanted.length === 0) return out
  const schedule = await loadProjectionSchedule({ sport: 'NFL', season, week: at.week, now: new Date() })
  for (const id of wanted) {
    const team = projectionTeamKey('NFL', id)
    const games = team ? schedule.get(team)?.weekGames : null
    const line = teamDefenseWeekLine(specialists.get(id), games)
    if (!line) continue
    out.set(id, { key: id, playerId: id, name: null, position: 'DEF', team, weekGames: games!, componentStats: line,
      // No generic number exists for a defense; consumers of this line re-score `componentStats`.
      projectedPoints: 0, source: 'allfantasy' })
  }
  return out
}
