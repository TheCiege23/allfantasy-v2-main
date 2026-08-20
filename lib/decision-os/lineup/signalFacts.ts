/**
 * Decision OS — signal-layer grounding for the `manager.lineup.set` memo.
 *
 * Wires the previously-orphaned F2-layer signal projectors (F2.2 schedule/bye,
 * F2.3 injury, F2.5 projections, F2.6 weather, F2.7 news) into the lineup DCO
 * through the SAME channel `warehouseFacts.ts` established for F2.9/F2.10:
 *
 *   ENRICHMENT ONLY — these facts feed memo/uncertainty/provenance/
 *   explainability. The deterministic lineup rules never read them, live
 *   behavior is unchanged, and absence degrades to uncertainty entries
 *   (never zeros, never fabrication — P2). Loader never throws.
 *
 * All reads go through the existing world ports/resolvers (read-only,
 * origin-blind). No new derivation: each block is a compact projection of a
 * layer's own context type, keyed for citation in the explainability sentence.
 */
import { prisma } from '@/lib/prisma'
import { resolveInjuryContext } from '@/lib/decision-os/world/injuryEnrichedWorld'
import { resolveScheduleContext } from '@/lib/decision-os/world/scheduleBye'
import { loadNewsRows, loadProjectionRows, loadWeatherRows } from '@/lib/decision-os/world/port'
import { projectNewsContext } from '@/lib/decision-os/world/newsEnrichedWorld'
import { projectProjectionContext } from '@/lib/decision-os/world/projectionEnrichedWorld'
import { projectWeatherContext } from '@/lib/decision-os/world/weatherEnrichedWorld'
import type { RawNewsRow, RawProjectionRow, RawWeatherRow } from '@/lib/decision-os/world/facts'

export interface SignalFactsPlayer {
  playerId: string
  playerName: string
  team?: string | null
}

export interface LineupSignalFacts {
  /** null = injury source unavailable for every roster player (NOT "all healthy"). */
  injury: {
    resolvedCount: number
    totalPlayers: number
    /** Non-available statuses only, worst-first, ≤4 cited. */
    flagged: { playerId: string; playerName: string; status: string; availabilityCategory: string }[]
  } | null
  /** null = schedule source unavailable (NOT "no byes"). */
  schedule: {
    teamsResolved: number
    totalTeams: number
    /** Teams on bye in the decision week, with the roster players affected. */
    byes: { team: string; playerNames: string[] }[]
  } | null
  /** null = no stored projections for the decision week. */
  projections: {
    playersWithProjection: number
    totalPlayers: number
    week: number
    /** Top cited projections — real stored numbers for the explainability sentence. */
    cited: { playerId: string; playerName: string; projectedPoints: number; source: string | null }[]
  } | null
  /** null = weather rows unavailable (NOT "clear skies"). */
  weather: {
    teamsChecked: number
    /** Moderate/high/extreme-risk games only. */
    risky: { team: string; category: string; label: string | null }[]
  } | null
  /** null = no attributed player news in the window. */
  news: {
    playersWithNews: number
    /** Freshest fantasy-relevant items, ≤3 cited. */
    cited: { playerName: string; headline: string; impact: string | null }[]
  } | null
  uncertainty: string[]
}

const INJURY_CITE_LIMIT = 4
const PROJECTION_CITE_LIMIT = 3
const NEWS_CITE_LIMIT = 3
const NEWS_WINDOW_DAYS = 7

/** Pure projection from already-loaded rows/contexts. Exported for fixture-driven tests. */
export function projectLineupSignalFacts(args: {
  players: SignalFactsPlayer[]
  sport: string
  week: number
  injuryById: Map<string, { status: string | null; availabilityCategory: string; resolved: boolean }> | null
  scheduleByTeam: Map<string, { isByeWeek: boolean; team: string | null }> | null
  projectionRows: RawProjectionRow[] | null
  weatherRows: RawWeatherRow[] | null
  newsRows: RawNewsRow[] | null
  now: Date
}): LineupSignalFacts {
  const uncertainty: string[] = []

  // ── F2.3 injury ─────────────────────────────────────────────────────
  let injury: LineupSignalFacts['injury'] = null
  if (args.injuryById) {
    let resolvedCount = 0
    const flagged: NonNullable<LineupSignalFacts['injury']>['flagged'] = []
    for (const p of args.players) {
      const ctx = args.injuryById.get(p.playerId)
      if (!ctx?.resolved) continue
      resolvedCount += 1
      if (ctx.availabilityCategory !== 'available' && ctx.availabilityCategory !== 'unknown' && ctx.status) {
        flagged.push({ playerId: p.playerId, playerName: p.playerName, status: ctx.status, availabilityCategory: ctx.availabilityCategory })
      }
    }
    // unavailable before uncertain — worst first for citation.
    flagged.sort((a, b) => (a.availabilityCategory === 'unavailable' ? -1 : 1) - (b.availabilityCategory === 'unavailable' ? -1 : 1))
    injury = resolvedCount > 0 ? { resolvedCount, totalPlayers: args.players.length, flagged: flagged.slice(0, INJURY_CITE_LIMIT) } : null
  }
  if (injury == null) uncertainty.push('signal_injury_unavailable: no injury source resolved for any roster player')

  // ── F2.2 schedule / bye ─────────────────────────────────────────────
  let schedule: LineupSignalFacts['schedule'] = null
  if (args.scheduleByTeam) {
    const teams = Array.from(new Set(args.players.map((p) => (p.team ?? '').toUpperCase()).filter(Boolean)))
    let teamsResolved = 0
    const byes: NonNullable<LineupSignalFacts['schedule']>['byes'] = []
    for (const team of teams) {
      const ctx = args.scheduleByTeam.get(team)
      if (!ctx) continue
      teamsResolved += 1
      if (ctx.isByeWeek) {
        byes.push({ team, playerNames: args.players.filter((p) => (p.team ?? '').toUpperCase() === team).map((p) => p.playerName) })
      }
    }
    schedule = teamsResolved > 0 ? { teamsResolved, totalTeams: teams.length, byes } : null
  }
  if (schedule == null) uncertainty.push('signal_schedule_unavailable: no schedule rows resolved for roster teams')

  // ── F2.5 projections ────────────────────────────────────────────────
  let projections: LineupSignalFacts['projections'] = null
  if (args.projectionRows) {
    const rowsByPlayer = new Map<string, RawProjectionRow[]>()
    for (const row of args.projectionRows) {
      const list = rowsByPlayer.get(row.playerId)
      if (list) list.push(row)
      else rowsByPlayer.set(row.playerId, [row])
    }
    const cited: NonNullable<LineupSignalFacts['projections']>['cited'] = []
    let playersWithProjection = 0
    for (const p of args.players) {
      const ctx = projectProjectionContext(rowsByPlayer.get(p.playerId) ?? [], null, args.now)
      if (ctx.projectedPoints == null) continue
      playersWithProjection += 1
      cited.push({ playerId: p.playerId, playerName: p.playerName, projectedPoints: ctx.projectedPoints, source: ctx.source })
    }
    cited.sort((a, b) => b.projectedPoints - a.projectedPoints)
    projections = playersWithProjection > 0
      ? { playersWithProjection, totalPlayers: args.players.length, week: args.week, cited: cited.slice(0, PROJECTION_CITE_LIMIT) }
      : null
  }
  if (projections == null) uncertainty.push(`signal_projection_unavailable: no stored projections for week ${args.week}`)

  // ── F2.6 weather ────────────────────────────────────────────────────
  let weather: LineupSignalFacts['weather'] = null
  if (args.weatherRows) {
    const teams = Array.from(new Set(args.players.map((p) => (p.team ?? '').toUpperCase()).filter(Boolean)))
    let teamsChecked = 0
    const risky: NonNullable<LineupSignalFacts['weather']>['risky'] = []
    for (const team of teams) {
      const row = args.weatherRows.find((r) => String(r.cacheKey ?? '').startsWith(`weather:team-window:${team}:`)) ?? null
      const ctx = projectWeatherContext(row, team, args.sport, args.now)
      if (ctx.weatherRiskCategory === 'not_applicable') continue
      if (row) teamsChecked += 1
      if (ctx.weatherRiskCategory === 'high' || ctx.weatherRiskCategory === 'extreme' || ctx.weatherRiskCategory === 'moderate') {
        risky.push({ team, category: ctx.weatherRiskCategory, label: ctx.conditionLabel })
      }
    }
    weather = teamsChecked > 0 ? { teamsChecked, risky } : null
  }
  if (weather == null) uncertainty.push('signal_weather_unavailable: no stored weather rows for roster teams')

  // ── F2.7 news ───────────────────────────────────────────────────────
  let news: LineupSignalFacts['news'] = null
  if (args.newsRows) {
    const rowsByName = new Map<string, RawNewsRow[]>()
    for (const row of args.newsRows) {
      const key = String(row.playerName ?? '').toLowerCase()
      if (!key) continue
      const list = rowsByName.get(key)
      if (list) list.push(row)
      else rowsByName.set(key, [row])
    }
    const cited: NonNullable<LineupSignalFacts['news']>['cited'] = []
    let playersWithNews = 0
    for (const p of args.players) {
      const ctx = projectNewsContext(rowsByName.get(p.playerName.toLowerCase()) ?? [], args.now)
      if (ctx.headline == null) continue
      playersWithNews += 1
      if (ctx.fantasyRelevant !== false) cited.push({ playerName: p.playerName, headline: ctx.headline, impact: ctx.impact })
    }
    news = playersWithNews > 0 ? { playersWithNews, cited: cited.slice(0, NEWS_CITE_LIMIT) } : null
  }
  if (news == null) uncertainty.push(`signal_news_unavailable: no attributed player news in the last ${NEWS_WINDOW_DAYS} days`)

  return { injury, schedule, projections, weather, news, uncertainty }
}

/**
 * Load + project in one call for the shadow runner. Mirrors
 * `loadLineupWarehouseFacts`' failure containment exactly: every port read is
 * wrapped, every failure becomes an uncertainty entry, and the function never
 * throws. League season anchors the projection/schedule reads.
 */
export async function loadLineupSignalFacts(args: {
  leagueId: string
  sport: string
  week: number
  players: SignalFactsPlayer[]
}): Promise<LineupSignalFacts> {
  const now = new Date()
  const playerIds = args.players.map((p) => p.playerId)
  const playerNames = args.players.map((p) => p.playerName)
  const teams = Array.from(new Set(args.players.map((p) => (p.team ?? '').toUpperCase()).filter(Boolean)))
  const newsSince = new Date(now.getTime() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const league = await prisma.league
    .findUnique({ where: { id: args.leagueId }, select: { season: true } })
    .catch(() => null)
  if (!league) {
    return {
      injury: null,
      schedule: null,
      projections: null,
      weather: null,
      news: null,
      uncertainty: ['signal_league_unresolved: league row not found; season-anchored signals impossible'],
    }
  }

  const [injuryR, scheduleR, projectionR, weatherR, newsR] = await Promise.allSettled([
    (async () => resolveInjuryContext(args.sport, playerIds))(),
    (async () =>
      resolveScheduleContext({ sport: args.sport, season: league.season, currentWeek: args.week, teams }))(),
    (async () => loadProjectionRows(args.sport, playerIds, String(league.season), args.week))(),
    (async () => loadWeatherRows(teams))(),
    (async () => loadNewsRows(args.sport, playerNames, newsSince))(),
  ])

  const portErrors: string[] = []
  const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason))
  if (injuryR.status === 'rejected') portErrors.push(`injury: ${reason(injuryR)}`)
  if (scheduleR.status === 'rejected') portErrors.push(`schedule: ${reason(scheduleR)}`)
  if (projectionR.status === 'rejected') portErrors.push(`projection: ${reason(projectionR)}`)
  if (weatherR.status === 'rejected') portErrors.push(`weather: ${reason(weatherR)}`)
  if (newsR.status === 'rejected') portErrors.push(`news: ${reason(newsR)}`)

  const facts = projectLineupSignalFacts({
    players: args.players,
    sport: args.sport,
    week: args.week,
    injuryById: injuryR.status === 'fulfilled' ? (injuryR.value.byId as never) : null,
    scheduleByTeam: scheduleR.status === 'fulfilled' ? (scheduleR.value.byTeam as never) : null,
    projectionRows: projectionR.status === 'fulfilled' ? projectionR.value : null,
    weatherRows: weatherR.status === 'fulfilled' ? weatherR.value : null,
    newsRows: newsR.status === 'fulfilled' ? newsR.value : null,
    now,
  })
  for (const failure of portErrors) facts.uncertainty.push(`signal_port_error: ${failure}`)
  return facts
}
