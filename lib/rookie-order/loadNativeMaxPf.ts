import 'server-only'

/**
 * Server half of ./nativeMaxPf.ts: reads a native season's finished regular-season weeks, each team's
 * saved weekly lineups, its players' positions and their weekly stat lines, then hands them to the
 * pure computation. All Postgres; a handful of bulk reads, never one query per player.
 *
 * Scored the way matchups score — `buildLeagueStatScorer` over `player_weekly_scores` — and only where
 * matchups score that way. Leagues whose weekly score is built differently answer `unsupported`, and
 * the rookie order keeps its points-for fallback with its note:
 *   daily lineups   NBA / NHL / MLB leagues that set a lineup per day
 *   games count     best-N-games or lock-in leagues
 *   devy engine     devy / C2C leagues scored by the devy engine
 * Best ball is the one shortcut: its weekly score already IS the optimal lineup, so Max PF = points for.
 */
import { prisma } from '@/lib/prisma'
import { buildBestBallSlots, buildLeagueStatScorer, leagueIsBestBall } from '@/lib/redraft/scoringEngine'
import { isDailyLineupScoringEnabled } from '@/lib/redraft/dailyLineups'
import { gamesCountActive } from '@/lib/redraft/gamesCount'
import { leagueUsesDevyEngine } from '@/lib/devy/scoringEligibilityEngine'
import { nativeSeasonMaxPf, type NativeMaxPfResult, type NativeMaxPfTeam } from './nativeMaxPf'

export type NativeMaxPfLoad =
  | { kind: 'computed'; result: NativeMaxPfResult }
  | { kind: 'best_ball' }
  | { kind: 'unsupported'; reason: 'daily_lineups' | 'games_count' | 'devy_engine' | 'no_scoring' | 'no_slots' | 'no_finished_week' }

/** Slots a roster row can hold that can never start. */
const RESERVE_SLOTS = new Set(['ir', 'taxi', 'devy', 'reserve', 'injured_reserve'])
const LINEUP_SECTIONS = ['starters', 'bench']

export async function loadNativeMaxPf(args: {
  leagueId: string
  league: { sport: string | null; settings: unknown; leagueVariant: string | null; leagueType: string | null; bestBallMode?: boolean | null }
  seasonId: string
  season: number
  playoffStartWeek: number
  /** `RedraftRoster.id`s — the engine's team ids. */
  teamIds: readonly string[]
}): Promise<NativeMaxPfLoad> {
  const sport = String(args.league.sport ?? 'NFL').toUpperCase()
  if (leagueIsBestBall(args.league)) return { kind: 'best_ball' }
  if (isDailyLineupScoringEnabled(args.league.settings, sport)) return { kind: 'unsupported', reason: 'daily_lineups' }
  if (gamesCountActive(args.league.settings, sport)) return { kind: 'unsupported', reason: 'games_count' }
  if (await leagueUsesDevyEngine(args.leagueId)) return { kind: 'unsupported', reason: 'devy_engine' }
  const scorer = buildLeagueStatScorer({ sport, settings: args.league.settings })
  if (!scorer) return { kind: 'unsupported', reason: 'no_scoring' }
  const slots = buildBestBallSlots(sport, args.league.settings)
  if (slots.length === 0) return { kind: 'unsupported', reason: 'no_slots' }

  // A week counts once every one of its regular-season games is final.
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: args.seasonId, isMedianMatchup: false, week: { lt: args.playoffStartWeek > 0 ? args.playoffStartWeek : 1000 } },
    select: { week: true, status: true },
  })
  const done = new Map<number, boolean>()
  for (const m of matchups) done.set(m.week, (done.get(m.week) ?? true) && m.status === 'final')
  const weeks = [...done].filter(([, final]) => final).map(([w]) => w).sort((a, b) => a - b)
  if (weeks.length === 0) return { kind: 'unsupported', reason: 'no_finished_week' }

  const [links, rosterRows] = await Promise.all([
    prisma.roster.findMany({ where: { redraftRosterId: { in: [...args.teamIds] } }, select: { id: true, redraftRosterId: true } }),
    // Dropped players too: a week's saved lineup can name someone the team has since released.
    prisma.redraftRosterPlayer.findMany({
      where: { rosterId: { in: [...args.teamIds] } },
      select: { rosterId: true, playerId: true, position: true, sport: true, slotType: true, droppedAt: true },
    }),
  ])
  const teamByAfRoster = new Map(links.filter((l) => l.redraftRosterId).map((l) => [l.id, l.redraftRosterId as string]))
  const assignments = teamByAfRoster.size
    ? await prisma.afRosterLineupAssignment.findMany({
        where: { rosterId: { in: [...teamByAfRoster.keys()] }, season: args.season, week: { lte: weeks.at(-1)! }, section: { in: LINEUP_SECTIONS } },
        select: { rosterId: true, week: true, playerId: true },
      })
    : []

  const saved = new Map<string, Map<number, string[]>>()
  for (const a of assignments) {
    const team = teamByAfRoster.get(a.rosterId)
    if (!team) continue
    const byWeek = saved.get(team) ?? new Map<number, string[]>()
    const list = byWeek.get(a.week) ?? []
    list.push(a.playerId)
    byWeek.set(a.week, list)
    saved.set(team, byWeek)
  }

  const positionOf = new Map<string, string | null>()
  const sportOf = new Map<string, string>()
  const current = new Map<string, string[]>()
  for (const r of rosterRows) {
    if (!positionOf.get(r.playerId)) positionOf.set(r.playerId, r.position ?? null)
    if (!sportOf.has(r.playerId)) sportOf.set(r.playerId, String(r.sport ?? sport).toUpperCase())
    if (r.droppedAt == null && !RESERVE_SLOTS.has(String(r.slotType ?? '').trim().toLowerCase())) {
      current.set(r.rosterId, [...(current.get(r.rosterId) ?? []), r.playerId])
    }
  }

  const teams: NativeMaxPfTeam[] = args.teamIds.map((teamId) => ({
    teamId,
    saved: [...(saved.get(teamId) ?? new Map()).entries()].map(([week, playerIds]) => ({ week, playerIds })),
    current: current.get(teamId) ?? [],
  }))

  const playerIds = [...new Set([...assignments.map((a) => a.playerId), ...rosterRows.map((r) => r.playerId)])]
  const stats = playerIds.length
    ? await prisma.playerWeeklyScore.findMany({
        where: { playerId: { in: playerIds }, season: args.season, week: { in: weeks } },
        select: { playerId: true, week: true, sport: true, stats: true },
      })
    : []
  const points = new Map<string, number>()
  for (const s of stats) {
    if (String(s.sport ?? '').toUpperCase() !== (sportOf.get(s.playerId) ?? sport)) continue
    points.set(`${s.playerId}:${s.week}`, scorer((s.stats ?? {}) as Record<string, number>, positionOf.get(s.playerId) ?? null))
  }

  return {
    kind: 'computed',
    result: nativeSeasonMaxPf({
      weeks,
      teams,
      positionOf: (id) => positionOf.get(id) ?? null,
      pointsOf: (id, week) => points.get(`${id}:${week}`) ?? null,
      slots,
    }),
  }
}
