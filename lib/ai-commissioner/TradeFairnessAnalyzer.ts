import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadGradedLeagueTradeRows, type GradedLeagueTradeRows, type LeagueTradeRow } from '@/lib/core-app/leagueTradeRowGrades'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { toLeagueSport } from './SportCommissionerResolver'
import type { TradeFairnessInsight, TradeControversyLevel } from './types'

/**
 * The AI Commissioner's trade-fairness watchlist, on THE grade.
 *
 * 🛑 UNTIL 2026-11-26 THIS WAS A FAIRNESS RULE OF ITS OWN: `|valueGiven − valueReceived| / max(…)`
 * off the stale `LeagueTrade.valueGiven/valueReceived` columns, `100 − imbalance` as a "fairness
 * score", and ≤45 / ≤65 cut-offs for "Immediate commissioner review recommended". It read no league
 * chart, no scoring, no league concept — and two NULL columns scored 0% imbalance, i.e. 100/100 "looks
 * healthy", for a trade nobody had priced.
 *
 * Now every number comes from the one grader through `loadGradedLeagueTradeRows` — the same reader
 * /core Trades and the Trade Center's completed history use, so a trade reads the same letter here as
 * on every other screen (frozen original, mirrored rows collapsed, provider ids resolved, picks and FAAB
 * priced, the league concept's own rule). The only mapping left is presentation:
 *   - `controversyLevel` is the letter's own band: A/F (a strong lean either way) → high, B/D (a
 *     slight lean) → medium, C (even) → low. Letters are exact mirrors, so either side gives the same.
 *   - `fairnessScore` is `100 − |percentDiff|` of that grade, kept for the existing "N/100" readout.
 * A withheld grade stays withheld: `graded: false`, null numbers, `controversyLevel: 'unknown'`, and
 * the grader's reason. It is never ranked as fine or as lopsided.
 */

interface AnalyzeTradeFairnessInput {
  leagueId: string
  sport?: string | null
  season?: number | null
  limit?: number
}

type LeagueRow = { id: string; sport: string; platformLeagueId: string | null; platform: string | null }

export type TradeFairnessDeps = {
  loadLeague: (leagueId: string) => Promise<LeagueRow | null>
  loadRows: typeof loadGradedLeagueTradeRows
  /** A legacy `LeagueTrade.id` → its platform transaction id (older clients sent the row id). */
  transactionIdForRow: (args: { rowId: string; platformLeagueId: string }) => Promise<string | null>
}

const defaultDeps: TradeFairnessDeps = {
  loadLeague: (leagueId) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true, platformLeagueId: true, platform: true },
    }) as Promise<LeagueRow | null>,
  loadRows: loadGradedLeagueTradeRows,
  transactionIdForRow: async ({ rowId, platformLeagueId }) =>
    (
      await prisma.leagueTrade
        .findFirst({ where: { id: rowId, history: { sleeperLeagueId: platformLeagueId } }, select: { transactionId: true } })
        .catch(() => null)
    )?.transactionId ?? null,
}

/** The letter's own band — see the header. Exported for tests. */
export function controversyFromLetter(letter: string | null | undefined): TradeControversyLevel {
  if (letter === 'A' || letter === 'F') return 'high'
  if (letter === 'B' || letter === 'D') return 'medium'
  if (letter === 'C') return 'low'
  return 'unknown'
}

function tone(level: TradeControversyLevel): string {
  if (level === 'high') return 'Commissioner review recommended.'
  if (level === 'medium') return 'Review context and manager intent.'
  if (level === 'low') return 'Even on league values.'
  return 'No fairness read is possible until it can be graded.'
}

/** One graded (or withheld) row as an insight. Pure; exported for tests. */
export function insightFromGrade(input: {
  row: Pick<LeagueTradeRow, 'transactionId' | 'partnerName' | 'partnerRosterId' | 'tradeDate'>
  grade: TradeGradeView
  sport: LeagueSport
}): TradeFairnessInsight {
  const { row, grade } = input
  const partner = row.partnerName?.trim() ? row.partnerName.trim() : 'a league manager'
  const base = {
    tradeId: row.transactionId,
    transactionId: row.transactionId,
    createdAt: row.tradeDate ? new Date(row.tradeDate).toISOString() : null,
    sport: input.sport,
    relatedManagerIds: row.partnerRosterId != null ? [String(row.partnerRosterId)] : [],
  }
  if (!grade.graded) {
    return {
      ...base,
      graded: false,
      letter: null,
      partnerLetter: null,
      fairnessScore: null,
      imbalancePct: null,
      controversyLevel: 'unknown',
      withheldReason: grade.reason,
      summary: `Trade ${row.transactionId} with ${partner}: grade withheld — ${grade.reason}. ${tone('unknown')}`,
    }
  }
  const imbalancePct = Math.round(Math.abs(grade.percentDiff))
  const controversyLevel = controversyFromLetter(grade.letter)
  return {
    ...base,
    graded: true,
    letter: grade.letter,
    partnerLetter: grade.partnerLetter,
    fairnessScore: Math.max(0, Math.min(100, 100 - imbalancePct)),
    imbalancePct,
    controversyLevel,
    withheldReason: null,
    summary: `Trade ${row.transactionId} with ${partner} grades ${grade.letter} / ${grade.partnerLetter} on this league’s values (${imbalancePct}% value gap). ${tone(controversyLevel)}`,
  }
}

async function gradedInsights(
  league: LeagueRow,
  deps: TradeFairnessDeps,
): Promise<{ loaded: Extract<GradedLeagueTradeRows, { available: true }>; insights: TradeFairnessInsight[] } | null> {
  const loaded = await deps.loadRows({
    leagueId: league.id,
    platformLeagueId: league.platformLeagueId,
    viewerPlatformUserId: null,
    sport: league.sport,
    platform: league.platform,
  })
  if (!loaded.available) return null
  const sport = toLeagueSport(league.sport) as LeagueSport
  const insights: TradeFairnessInsight[] = []
  for (const row of loaded.rows) {
    const g = loaded.graded.get(row.transactionId)
    if (g) insights.push(insightFromGrade({ row, grade: g.grade, sport }))
  }
  return { loaded, insights }
}

/** Graded trades first, most lopsided first; withheld ones after, newest first. */
function byReviewPriority(a: TradeFairnessInsight, b: TradeFairnessInsight): number {
  if (a.fairnessScore != null && b.fairnessScore != null && a.fairnessScore !== b.fairnessScore) return a.fairnessScore - b.fairnessScore
  if (a.fairnessScore != null && b.fairnessScore == null) return -1
  if (a.fairnessScore == null && b.fairnessScore != null) return 1
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
}

export async function loadTradeFairnessWatchlist(
  input: AnalyzeTradeFairnessInput,
  deps: Partial<TradeFairnessDeps> = {},
): Promise<TradeFairnessInsight[]> {
  const d = { ...defaultDeps, ...deps }
  const league = await d.loadLeague(input.leagueId)
  if (!league) throw new Error('League not found')

  const limit = Math.max(1, Math.min(20, input.limit ?? 6))
  const result = await gradedInsights(league, d)
  if (!result) return []
  const seasonOf = new Map(result.loaded.rows.map((r) => [r.transactionId, r.season] as const))
  return result.insights
    .filter((i) => input.season == null || seasonOf.get(i.tradeId) == null || seasonOf.get(i.tradeId) === input.season)
    .sort(byReviewPriority)
    .slice(0, limit)
}

/**
 * One trade's insight, by its platform transaction id (what the watchlist hands out) or, for older
 * clients, its `LeagueTrade.id`.
 */
export async function getTradeFairnessByTradeId(
  input: { leagueId: string; tradeId: string },
  deps: Partial<TradeFairnessDeps> = {},
): Promise<TradeFairnessInsight | null> {
  const d = { ...defaultDeps, ...deps }
  const league = await d.loadLeague(input.leagueId)
  if (!league?.platformLeagueId) return null
  const result = await gradedInsights(league, d)
  if (!result) return null
  const direct = result.insights.find((i) => i.tradeId === input.tradeId)
  if (direct) return direct
  const txId = await d.transactionIdForRow({ rowId: input.tradeId, platformLeagueId: league.platformLeagueId })
  return txId ? (result.insights.find((i) => i.tradeId === txId) ?? null) : null
}

export function explainTradeFairnessInsight(insight: TradeFairnessInsight): string {
  if (!insight.graded) return insight.summary
  const severityText =
    insight.controversyLevel === 'high'
      ? 'high controversy'
      : insight.controversyLevel === 'medium'
        ? 'moderate controversy'
        : 'low controversy'
  return `AllFantasy grades this trade ${insight.letter} / ${insight.partnerLetter} on the league’s own values — fairness ${insight.fairnessScore}/100 (${severityText}), a ${insight.imbalancePct}% value gap. ${insight.summary}`
}
