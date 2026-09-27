import 'server-only'

import type { League } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { tradeDeadlineWeek as settingsDeadlineWeek } from '@/lib/core-app/seasonTimeline'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { PUBLIC_RECEIPT_SELECT, publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { buildWeekKickoffMap } from '@/lib/redraft/lineupLock'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { forecastForTeam } from '@/lib/decision-os/value-v2/windowFactsPrismaPort'
import type { TradeEvaluationReceipt } from './evaluateTrade'
import { evaluateStoredTrade, type EvaluateStoredTradeResult } from './evaluateStoredTrade'
import { createLeagueTradeGrader, gradeDeal, loadNativePlayerNames } from './leagueTradeGrader'
import { signedGapPct } from './tradeGrade'
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

export type TradeReviewDeps = {
  evaluate: typeof evaluateStoredTrade
  leagueRow: (leagueId: string) => Promise<League | null>
  pairHistory: (args: PairHistoryArgs) => Promise<Known<Array<number | null>>>
  managerHealth: typeof getLeagueManagerHealth
  forecast: (args: { leagueIds: string[]; season: number }) => Promise<{ week: number; teamForecasts: unknown } | null>
  deadlineKickoff: (args: { sport: string; season: number; week: number }) => Promise<Date | null>
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

  return { ok: false, reason: 'Trade history between two teams is not joined for imported leagues yet.' }
}

export const defaultTradeReviewDeps: TradeReviewDeps = {
  evaluate: evaluateStoredTrade,
  leagueRow: (leagueId) => prisma.league.findUnique({ where: { id: leagueId } }).catch(() => null),
  pairHistory: (args) => defaultPairHistory(args).catch(() => ({ ok: false as const, reason: 'Trade history could not be read.' })),
  managerHealth: getLeagueManagerHealth,
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
  let receivedValue: number | null = 0
  let receivedBenchValue: number | null = 0
  const startersAfter = new Set(ri.startersAfter)
  for (const line of receivedLines) {
    if (line.leagueValue == null) {
      receivedValue = null
      receivedBenchValue = null
      break
    }
    receivedValue += line.leagueValue
    const asset = other.gives.find((g) => g.kind === 'player' && g.name === line.name)
    const starts = asset?.kind === 'player' && startersAfter.has(asset.playerId)
    // A pick or FAAB starts for nobody this week: it is not lineup value.
    if (!starts) receivedBenchValue += line.leagueValue
  }

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
    }
  | Extract<EvaluateStoredTradeResult, { ok: false }>

export async function reviewStoredTrade(
  args: { leagueId: string; ref: TradeRef; userId: string },
  deps: Partial<TradeReviewDeps> = {},
): Promise<StoredTradeReview> {
  const d: TradeReviewDeps = { ...defaultTradeReviewDeps, ...deps }
  const evaluated = await d.evaluate({ leagueId: args.leagueId, ref: args.ref, userId: args.userId, surface: 'commissioner-review' })
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

  // Inactivity — native leagues only, on the commissioner hub's own basis (roster last changed).
  const inactiveDays: TradeReviewFacts['inactiveDays'] =
    trade.origin.source !== 'af'
      ? { ok: false, reason: trade.origin.source === 'redraft' ? 'Manager activity is not tracked for redraft rosters yet.' : 'Manager activity for imported leagues is not wired into reviews yet.' }
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

  const review = buildTradeReview({
    sides: [{ name: sideNames[0] }, { name: sideNames[1] }],
    gapPct,
    lineup,
    history,
    inactiveDays,
    playoffPct,
    deadlineAt,
    now: now.toISOString(),
  })
  return { ok: true, review, receipt, trade, sideNames }
}
