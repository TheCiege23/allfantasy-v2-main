import 'server-only'

import type { League } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { importedActivityLeagueWhere, managerKeysOf, teamResolver } from '@/lib/core-app/importedActivityAttribution'
import type { GradedTrade, TradeGradesPayload } from '@/lib/trade-intel/sleeperTradeGradeService'
import { tradeDeadlineWeek as settingsDeadlineWeek } from '@/lib/core-app/seasonTimeline'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { PUBLIC_RECEIPT_SELECT, publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { buildWeekKickoffMap } from '@/lib/redraft/lineupLock'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { forecastForTeam } from '@/lib/decision-os/value-v2/windowFactsPrismaPort'
import type { TradeEvaluationReceipt } from './evaluateTrade'
import { evaluateStoredTrade, type EvaluateStoredTradeResult } from './evaluateStoredTrade'
import { createLeagueTradeGrader, gradeDeal, loadNativePlayerNames } from './leagueTradeGrader'
import { oneGradeForCompletedTrade } from './completedTradeGrade'
import { receivedValueSplit } from './tankingCalibration'
import { signedGapPct, type TradeGradeView } from './tradeGrade'
import { gradeInputsFromNativeItems, gradeInputsFromRedraftAssets } from './tradeGradeInputs'
import type { LoadedTrade, TradeRef, TradeSide } from './tradeRecord'
import { buildTradeReview, type Known, type ReviewSideLineup, type TradeReview, type TradeReviewFacts } from './tradeReview'

/**
 * Gather the facts commissioner review mode needs (`./tradeReview.ts`) for one stored trade, and build
 * the review. Database reads only.
 *
 * Side A is the side the receipt was graded from — the viewer's side when the commissioner is in the
 * trade, otherwise the proposer's. Every fact that cannot be read comes back as `{ ok: false, reason }`
 * and the check it feeds says "not computed", in those words.
 */

const DAY_MS = 86_400_000
/** A forecast older than this many weeks is not an answer about this week. */
const FORECAST_MAX_WEEK_LAG = 1
/**
 * Where a native league's season starts, for "this season". `AfLeagueTrade` has no season column and a
 * native league runs its seasons on one row, so trades are counted from March 1 of the league's season
 * — after the previous NFL season's playoffs, before any draft.
 */
const seasonStart = (season: number) => new Date(Date.UTC(season, 2, 1))
/** The durable graded-trades cache for one Sleeper league (`lib/core-app/recentTrades.ts` reads the same key). */
const TRADE_GRADES_CACHE_PREFIX = 'trade-grades:v2:'

export type TradeReviewDeps = {
  evaluate: typeof evaluateStoredTrade
  leagueRow: (leagueId: string) => Promise<League | null>
  pairHistory: (args: PairHistoryArgs) => Promise<Known<Array<number | null>>>
  managerHealth: typeof getLeagueManagerHealth
  /** Redraft and imported leagues: when each team last moved (native reads `managerHealth`). */
  lastMoves: (args: LastMovesArgs) => Promise<Known<LastMoves>>
  forecast: (args: { leagueIds: string[]; season: number }) => Promise<{ week: number; teamForecasts: unknown } | null>
  deadlineKickoff: (args: { sport: string; season: number; week: number }) => Promise<Date | null>
  /** Ladder level (1–25) per AllFantasy user id; ids with no profile are simply absent. */
  managerLevels: (userIds: string[]) => Promise<Map<string, number>>
  now: () => Date
}

export type PairHistoryArgs = {
  trade: LoadedTrade
  sideA: TradeSide
  sideB: TradeSide
  league: League
  userId: string
}

// ─── Defaults ────────────────────────────────────────────────────────────────

async function defaultPairHistory(args: PairHistoryArgs): Promise<Known<Array<number | null>>> {
  const { trade, sideA, sideB, league, userId } = args
  const a = sideA.teamId
  const b = sideB.teamId
  const pair = [
    { proposerRosterId: a, receiverRosterId: b },
    { proposerRosterId: b, receiverRosterId: a },
  ]
  let graderPromise: ReturnType<typeof createLeagueTradeGrader> | null = null
  const grader = () => (graderPromise ??= createLeagueTradeGrader({ leagueId: league.id, userId }).catch(() => null))

  if (trade.origin.source === 'af') {
    const rows = await prisma.afLeagueTrade.findMany({
      where: {
        leagueId: league.id,
        id: { not: trade.id },
        status: { in: ['processed', 'accepted', 'scheduled'] },
        OR: pair,
        createdAt: { gte: seasonStart(league.season ?? new Date().getUTCFullYear()) },
      },
      select: { id: true, items: { select: { itemType: true, itemReference: true, fromRosterId: true, toRosterId: true, faabAmount: true, metadata: true } } },
      take: 20,
    })
    // The grade each trade had WHEN IT WAS PROPOSED is the lean that matters; today's values only when none was kept.
    const stored = rows.length
      ? await prisma.tradeDecisionSnapshot.findMany({ where: { tradeId: { in: rows.map((r) => r.id) } }, select: PUBLIC_RECEIPT_SELECT })
      : []
    const byTrade = new Map(stored.map((row) => [row.tradeId, publicTradeDecisionReceipt(row)]))
    const nameFor = rows.length ? await loadNativePlayerNames(rows.flatMap((r) => r.items)) : () => null
    return {
      ok: true,
      value: await Promise.all(
        rows.map(async (r) => {
          const decision = byTrade.get(r.id)?.participantDecisions.find((p) => p.rosterId === a)
          if (decision?.valueGiven != null && decision.valueReceived != null) return signedGapPct(decision.valueGiven, decision.valueReceived)
          const g = await gradeDeal(await grader(), {
            give: gradeInputsFromNativeItems(r.items.filter((i) => i.fromRosterId === a), nameFor),
            get: gradeInputsFromNativeItems(r.items.filter((i) => i.toRosterId === a), nameFor),
            viewerSide: false,
          }).catch(() => null)
          return g?.graded ? g.percentDiff : null
        }),
      ),
    }
  }

  if (trade.origin.source === 'redraft') {
    const current = await prisma.redraftTradeProposal.findUnique({ where: { id: trade.id }, select: { seasonId: true } })
    if (!current) return { ok: false, reason: 'This proposal could not be read again to find its season.' }
    const rows = await prisma.redraftTradeProposal.findMany({
      where: { leagueId: league.id, seasonId: current.seasonId, id: { not: trade.id }, status: 'accepted', OR: pair },
      select: { id: true, assets: true },
      take: 20,
    })
    // Redraft proposals keep no one-grade receipt of their own, so each prior trade is graded (Guap, 2026-09-27).
    return {
      ok: true,
      value: await Promise.all(
        rows.map(async (r) => {
          const g = await gradeDeal(await grader(), {
            give: gradeInputsFromRedraftAssets(r.assets.filter((x) => x.fromRosterId === a)),
            get: gradeInputsFromRedraftAssets(r.assets.filter((x) => x.toRosterId === a)),
            viewerSide: false,
          }).catch(() => null)
          return g?.graded ? g.percentDiff : null
        }),
      ),
    }
  }

  // Imported: the league's graded completed trades — the same cache, and the same one grade, the
  // dashboard band and the trade emails read. Sleeper sides are Sleeper roster ids on both.
  const platform = String(league.platform ?? '').toLowerCase()
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    return { ok: false, reason: `Completed trades are only held for Sleeper leagues; this league is on ${platform || 'an unknown platform'}.` }
  }
  const row = await prisma.sportsDataCache.findFirst({
    where: { cacheKey: `${TRADE_GRADES_CACHE_PREFIX}${league.platformLeagueId}` },
    select: { data: true },
  })
  const payload = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as unknown as TradeGradesPayload) : null
  if (!payload || payload.version !== 2) return { ok: false, reason: "This league's completed trades have not been graded yet." }
  const season = league.season ?? new Date().getUTCFullYear()
  return {
    ok: true,
    value: await Promise.all(
      priorPairTrades({ trades: payload.trades ?? [], a, b, excludeTradeId: trade.origin.externalTradeId, since: seasonStart(season) }).map(async (t) => {
        const g = await oneGradeForCompletedTrade(league.id, t, season).catch(() => null)
        return leanForSideA(g, t, a)
      }),
    ),
  }
}

/** A completed Sleeper trade's earlier trades between the same two rosters this season (at most 20). */
export function priorPairTrades(args: {
  trades: readonly GradedTrade[]
  a: string
  b: string
  excludeTradeId: string | null
  since: Date
}): GradedTrade[] {
  return args.trades
    .filter((t) => {
      if (t.multiTeam || t.sides.length !== 2) return false
      const ids = t.sides.map((s) => String(s.rosterId))
      if (!ids.includes(args.a) || !ids.includes(args.b)) return false
      if (args.excludeTradeId && t.id.split(':').pop() === args.excludeTradeId) return false
      const at = Date.parse(t.createdIso)
      return Number.isFinite(at) && at >= args.since.getTime()
    })
    .slice(0, 20)
}

/** The completed grade is from the trade's FIRST side; turn it to face side A. */
export function leanForSideA(g: TradeGradeView | null, t: GradedTrade, a: string): number | null {
  if (!g?.graded) return null
  return String(t.sides[0]!.rosterId) === a ? g.percentDiff : -g.percentDiff
}

// ─── Activity (redraft and imported leagues) ────────────────────────────────

/** The last move each team made before `asOf`, and the span of moves recorded for the whole league. */
export type LastMoves = {
  byTeam: Map<string, Date>
  /** The earliest and newest move recorded for ANY team in the window — the evidence we were recording. */
  earliest: Date | null
  newest: Date | null
  /** Teams whose moves can be attributed at all. Absent: every team. */
  attributable?: ReadonlySet<string>
}

export type LastMovesArgs = { trade: LoadedTrade; league: League; asOf: Date }

/** Imported activity arrives by cron; a league whose newest row is older than this may just be unsynced. */
export const IMPORTED_ACTIVITY_MAX_STALE_DAYS = 3
/** How far back imported activity is read. */
const IMPORTED_ACTIVITY_WINDOW_DAYS = 90

export function lastMovesFrom(moves: ReadonlyArray<{ teamId: string; at: Date }>): LastMoves {
  const byTeam = new Map<string, Date>()
  let earliest: Date | null = null
  let newest: Date | null = null
  for (const { teamId, at } of moves) {
    const prev = byTeam.get(teamId)
    if (!prev || at > prev) byTeam.set(teamId, at)
    if (!earliest || at < earliest) earliest = at
    if (!newest || at > newest) newest = at
  }
  return { byTeam, earliest, newest }
}

/**
 * Days since each side last moved, as of `asOf`. A side with no recorded move is counted from the
 * first move recorded for anyone in the league — the span we can vouch for — never from nothing.
 */
export function inactiveDaysFrom(args: {
  moves: LastMoves
  teamIds: readonly [string | null, string | null]
  asOf: Date
  maxStaleDays?: number
}): Known<readonly [number | null, number | null]> {
  const { moves, asOf } = args
  if (!moves.newest || !moves.earliest) return { ok: false, reason: 'No manager activity has been recorded for this league.' }
  if (args.maxStaleDays != null) {
    const staleDays = (asOf.getTime() - moves.newest.getTime()) / DAY_MS
    if (staleDays > args.maxStaleDays) {
      return {
        ok: false,
        reason: `This league's activity was last imported ${Math.floor(staleDays)} days ago, so a quiet manager can't be told from a stale import.`,
      }
    }
  }
  const days = (teamId: string | null): number | null => {
    if (!teamId || (moves.attributable && !moves.attributable.has(teamId))) return null
    const since = moves.byTeam.get(teamId) ?? moves.earliest!
    return (asOf.getTime() - since.getTime()) / DAY_MS
  }
  return { ok: true, value: [days(args.teamIds[0]), days(args.teamIds[1])] as const }
}

async function redraftLastMoves(args: LastMovesArgs): Promise<Known<LastMoves>> {
  const current = await prisma.redraftTradeProposal.findUnique({ where: { id: args.trade.id }, select: { seasonId: true } })
  if (!current) return { ok: false, reason: 'This proposal could not be read again to find its season.' }
  const base = { leagueId: args.league.id, seasonId: current.seasonId }
  const before = { lt: args.asOf }
  // A manager's own moves: lineup saves they made, transactions on their roster, waiver claims they filed.
  const [saves, txns, claims] = await Promise.all([
    prisma.redraftRosterMoveHistory.findMany({ where: { ...base, source: 'user', createdAt: before }, select: { rosterId: true, createdAt: true } }),
    prisma.redraftLeagueTransaction.findMany({ where: { ...base, createdAt: before }, select: { rosterId: true, createdAt: true } }),
    prisma.redraftWaiverClaim.findMany({ where: { ...base, submittedAt: before }, select: { rosterId: true, submittedAt: true } }),
  ])
  return {
    ok: true,
    value: lastMovesFrom([
      ...saves.map((r) => ({ teamId: r.rosterId, at: r.createdAt })),
      ...txns.map((r) => ({ teamId: r.rosterId, at: r.createdAt })),
      ...claims.map((r) => ({ teamId: r.rosterId, at: r.submittedAt })),
    ]),
  }
}

async function importedLastMoves(args: LastMovesArgs): Promise<Known<LastMoves>> {
  const { league, asOf } = args
  const [teams, rows] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId: league.id }, select: { externalId: true, platformUserId: true, claimedByUserId: true } }),
    prisma.decisionOsImportedActivity.findMany({
      where: {
        ...importedActivityLeagueWhere(league),
        activityType: { in: ['trade', 'waiver', 'roster_move'] },
        occurredAt: { lt: asOf, gte: new Date(asOf.getTime() - IMPORTED_ACTIVITY_WINDOW_DAYS * DAY_MS) },
      },
      orderBy: { occurredAt: 'desc' },
      take: 4000,
      select: { occurredAt: true, normalized: true },
    }),
  ])
  if (rows.length === 0) return { ok: false, reason: 'No manager activity has been imported for this league.' }
  const attribution = teamResolver(teams)
  await attribution.withProfileKeys(rows.flatMap((r) => managerKeysOf(r.normalized)))
  const moves: Array<{ teamId: string; at: Date }> = []
  for (const r of rows) {
    const hit = new Set(managerKeysOf(r.normalized).flatMap((k) => attribution.resolve(k)?.externalId ?? []))
    for (const teamId of hit) moves.push({ teamId, at: r.occurredAt })
  }
  return {
    ok: true,
    value: {
      ...lastMovesFrom(moves),
      // Every row is evidence the league was being recorded, attributed or not.
      earliest: rows[rows.length - 1]!.occurredAt,
      newest: rows[0]!.occurredAt,
      // A team with no linked manager can never be named on a row, so its silence proves nothing.
      attributable: new Set(teams.filter((t) => t.platformUserId || t.claimedByUserId).map((t) => t.externalId)),
    },
  }
}

async function defaultLastMoves(args: LastMovesArgs): Promise<Known<LastMoves>> {
  if (args.trade.origin.source === 'redraft') return redraftLastMoves(args)
  if (args.trade.origin.source === 'provider') return importedLastMoves(args)
  return { ok: false, reason: 'Native leagues read the commissioner hub’s activity instead.' }
}

async function defaultManagerLevels(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (userIds.length === 0) return out
  const rows = await prisma.userProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, xpLevel: true, legacyCareerLevel: true },
  })
  for (const r of rows) {
    const level = r.xpLevel ?? r.legacyCareerLevel
    if (level != null && Number.isFinite(Number(level))) out.set(r.userId, Math.max(1, Math.floor(Number(level))))
  }
  return out
}

export const defaultTradeReviewDeps: TradeReviewDeps = {
  evaluate: evaluateStoredTrade,
  managerLevels: (ids) => defaultManagerLevels(ids),
  leagueRow: (leagueId) => prisma.league.findUnique({ where: { id: leagueId } }).catch(() => null),
  pairHistory: (args) => defaultPairHistory(args).catch(() => ({ ok: false as const, reason: 'Trade history could not be read.' })),
  managerHealth: getLeagueManagerHealth,
  lastMoves: (args) => defaultLastMoves(args).catch(() => ({ ok: false as const, reason: 'Manager activity could not be read.' })),
  forecast: async ({ leagueIds, season }) =>
    prisma.seasonForecastSnapshot
      .findFirst({ where: { leagueId: { in: leagueIds }, season }, orderBy: { week: 'desc' }, select: { week: true, teamForecasts: true } })
      .catch(() => null),
  deadlineKickoff: async (args) => (await buildWeekKickoffMap(prisma, args).catch(() => null))?.firstKickoff ?? null,
  now: () => new Date(),
}

// ─── Pure helpers (exported for tests) ──────────────────────────────────────

/** A side's lineup facts, from the receipt's canonical evaluation and the world's actual lineup. */
export function sideLineup(args: {
  receipt: TradeEvaluationReceipt
  side: TradeSide
  other: TradeSide
  /** True when this side is the receipt's graded side (its `give` lines are what it sends). */
  isGradedSide: boolean
  world: CanonicalWorld | null
}): ReviewSideLineup | null {
  const { receipt, side, other, isGradedSide, world } = args
  if (!side.rosterId) return null
  const participant = receipt.canonical?.participants.find((p) => p.rosterId === side.rosterId)
  const ri = participant?.rosterImpact
  if (!ri || ri.startingPointsBefore == null || ri.startingPointsDelta == null || !ri.startersAfter) return null

  // What this side RECEIVES is what the other side gives; its league value is on the receipt's lines.
  const receivedLines = receipt.assets.filter((l) => l.side === (isGradedSide ? 'get' : 'give'))
  const startersAfter = new Set(ri.startersAfter)
  // The same split the tanking calibration measures saved receipts with. A pick or FAAB starts for
  // nobody this week: it is not lineup value.
  const { receivedValue, receivedBenchValue } = receivedValueSplit(receivedLines, (name) => {
    const asset = other.gives.find((g) => g.kind === 'player' && g.name === name)
    return asset?.kind === 'player' && startersAfter.has(asset.playerId)
  })

  const actual = world?.rosters.find((r) => r.rosterId === side.rosterId)?.starterIds ?? []
  const startersNow = new Set(actual.length ? actual : ri.startersBefore ?? [])
  const sentStarterNames = side.gives.flatMap((g) => (g.kind === 'player' && startersNow.has(g.playerId) ? [g.name] : []))

  return {
    startingBefore: ri.startingPointsBefore,
    startingDelta: ri.startingPointsDelta,
    receivedValue,
    receivedBenchValue,
    sentStarterNames,
  }
}

function teamFor(world: CanonicalWorld | null, rosterId: string | null) {
  if (!world || !rosterId) return null
  const teamId = world.rosters.find((r) => r.rosterId === rosterId)?.teamId
  return teamId ? world.teams.find((t) => t.teamId === teamId) ?? null : null
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export type StoredTradeReview =
  | {
      ok: true
      review: TradeReview
      receipt: TradeEvaluationReceipt
      trade: LoadedTrade
      sideNames: [string, string]
      /** The two sides in the review's order — side A is the receipt's graded side. */
      sides: [TradeSide, TradeSide]
      /** The facts the review was built from, for a caller that files them as evidence. */
      facts: TradeReviewFacts
    }
  | Extract<EvaluateStoredTradeResult, { ok: false }>

export async function reviewStoredTrade(
  args: { leagueId: string; ref: TradeRef; userId: string; surface?: string },
  deps: Partial<TradeReviewDeps> = {},
): Promise<StoredTradeReview> {
  const d: TradeReviewDeps = { ...defaultTradeReviewDeps, ...deps }
  const evaluated = await d.evaluate({ leagueId: args.leagueId, ref: args.ref, userId: args.userId, surface: args.surface ?? 'commissioner-review' })
  if (!evaluated.ok) return evaluated
  const { trade, receipt, world = null } = evaluated
  const [sideA, sideB] = evaluated.perspectiveTeamId === trade.sideB.teamId ? [trade.sideB, trade.sideA] : [trade.sideA, trade.sideB]
  const now = d.now()

  const teamA = teamFor(world, sideA.rosterId)
  const teamB = teamFor(world, sideB.rosterId)
  const sideNames: [string, string] = [teamA?.displayName?.trim() || 'Team A', teamB?.displayName?.trim() || 'Team B']
  const league = await d.leagueRow(trade.leagueId)

  // Gap — the one grade.
  const g = receipt.grade
  const gapPct: Known<number> = g.graded ? { ok: true, value: g.percentDiff } : { ok: false, reason: g.reason }

  // Lineup — this week, while the trade is still pending.
  const lineup: TradeReviewFacts['lineup'] =
    trade.status !== 'proposed'
      ? { ok: false, reason: 'Lineup effect is only measured while a trade is still pending.' }
      : !receipt.canonical
        ? { ok: false, reason: receipt.canonicalError ?? 'The lineup effect could not be computed for this league.' }
        : {
            ok: true,
            value: [
              sideLineup({ receipt, side: sideA, other: sideB, isGradedSide: true, world }),
              sideLineup({ receipt, side: sideB, other: sideA, isGradedSide: false, world }),
            ],
          }

  // Repeat partners — earlier trades between these two, plus this one.
  const history: TradeReviewFacts['history'] = !league
    ? { ok: false, reason: 'The league could not be read.' }
    : await (async () => {
        const prior = await d.pairHistory({ trade, sideA, sideB, league, userId: args.userId })
        if (!prior.ok) return prior
        return { ok: true as const, value: [...prior.value, gapPct.ok ? gapPct.value : null] }
      })()

  // Inactivity. Native: the commissioner hub's own basis (roster last changed). Redraft and imported:
  // each manager's last recorded move, as of when the trade was proposed — a completed trade's own
  // processing is a move, and must not clear the manager who made it.
  const inactiveDays: TradeReviewFacts['inactiveDays'] =
    trade.origin.source !== 'af'
      ? await (async () => {
          if (!league) return { ok: false as const, reason: 'The league could not be read.' }
          const proposed = trade.proposedAt ? Date.parse(trade.proposedAt) : NaN
          const asOf = trade.status !== 'proposed' && Number.isFinite(proposed) ? new Date(proposed) : now
          const moves = await d.lastMoves({ trade, league, asOf })
          if (!moves.ok) return moves
          return inactiveDaysFrom({
            moves: moves.value,
            teamIds: [sideA.teamId, sideB.teamId],
            asOf,
            maxStaleDays: trade.origin.source === 'provider' ? IMPORTED_ACTIVITY_MAX_STALE_DAYS : undefined,
          })
        })()
      : await (async () => {
          const health = await d.managerHealth(trade.leagueId).catch(() => null)
          if (!health || health.rows.length === 0) return { ok: false as const, reason: 'Manager activity could not be read.' }
          const days = (rosterId: string | null) => {
            const at = health.rows.find((r) => r.rosterId === rosterId)?.lastActionAt
            return at ? (now.getTime() - Date.parse(at)) / DAY_MS : null
          }
          return { ok: true as const, value: [days(sideA.rosterId), days(sideB.rosterId)] as const }
        })()

  // Elimination — the season forecast, when one exists and is current.
  const playoffPct: TradeReviewFacts['playoffPct'] = await (async () => {
    const season = world?.league.season ?? league?.season ?? null
    if (!world || season == null) return { ok: false as const, reason: 'The league season could not be read.' }
    const ids = [...new Set([league?.platformLeagueId, trade.leagueId].filter((x): x is string => Boolean(x)))]
    const snap = await d.forecast({ leagueIds: ids, season }).catch(() => null)
    if (!snap) return { ok: false as const, reason: 'No season forecast has been run for this league.' }
    const week = world.league.currentWeek
    if (week != null && snap.week < week - FORECAST_MAX_WEEK_LAG) {
      return { ok: false as const, reason: `The latest season forecast is from week ${snap.week}; it is too old to say who is eliminated in week ${week}.` }
    }
    const pa = teamA?.source.sourceTeamId ? forecastForTeam(snap.teamForecasts, teamA.source.sourceTeamId) : null
    const pb = teamB?.source.sourceTeamId ? forecastForTeam(snap.teamForecasts, teamB.source.sourceTeamId) : null
    if (pa == null || pb == null) return { ok: false as const, reason: 'The season forecast has no playoff odds for both teams.' }
    return { ok: true as const, value: [pa, pb] as const }
  })()

  // Deadline — the first kickoff of the league's deadline week (Guap, 2026-09-27).
  const deadlineAt: TradeReviewFacts['deadlineAt'] = await (async () => {
    if (!league) return { ok: false as const, reason: 'The league could not be read.' }
    const week = resolveLeagueTradeSettings(league).tradeDeadlineWeek ?? settingsDeadlineWeek(league.settings)
    if (week == null) return { ok: true as const, value: null }
    const season = world?.league.season ?? league.season
    const sport = world?.league.sport ?? String(league.sport)
    if (season == null) return { ok: false as const, reason: 'The league season could not be read.' }
    const kickoff = await d.deadlineKickoff({ sport, season, week }).catch(() => null)
    if (!kickoff) return { ok: false as const, reason: `The schedule for week ${week} (the trade deadline) is not loaded, so the deadline has no time.` }
    return { ok: true as const, value: kickoff.toISOString() }
  })()

  // Manager levels — `managerUserId` is the AF user id once a team is claimed, otherwise a provider id
  // that simply has no profile, which the check reports as "not an AllFantasy manager".
  const managerLevels: TradeReviewFacts['managerLevels'] = await (async () => {
    const ids = [teamA?.managerUserId ?? null, teamB?.managerUserId ?? null]
    if (!ids[0] && !ids[1]) return { ok: false as const, reason: 'The managers behind these teams could not be identified.' }
    const levels = await d.managerLevels(ids.filter((x): x is string => Boolean(x))).catch(() => null)
    if (!levels) return { ok: false as const, reason: 'Manager levels could not be read.' }
    return { ok: true as const, value: [ids[0] ? levels.get(ids[0]) ?? null : null, ids[1] ? levels.get(ids[1]) ?? null : null] as const }
  })()

  const facts: TradeReviewFacts = {
    sides: [{ name: sideNames[0] }, { name: sideNames[1] }],
    gapPct,
    lineup,
    history,
    inactiveDays,
    playoffPct,
    deadlineAt,
    now: now.toISOString(),
    // The type the one grade priced the trade on — so "tanking" and "rebuild" follow the grade's own format.
    leagueType: receipt.grade.leagueType ? { type: receipt.grade.leagueType.type, label: receipt.grade.leagueType.label } : null,
    managerLevels,
  }
  return { ok: true, review: buildTradeReview(facts), receipt, trade, sideNames, sides: [sideA, sideB], facts }
}
