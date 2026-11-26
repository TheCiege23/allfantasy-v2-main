import 'server-only'

import { NOT_YOUR_LEAGUE_REASON, resolveEvaluationLeagueId } from '@/lib/decision-os/trade/evaluationLeague'
import { oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { loadFrozenCompletedGrades, type FrozenCompletedGrade } from '@/lib/decision-os/trade/frozenCompletedGrade'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { NO_LEAGUE_TO_GRADE_REASON, SIGN_IN_TO_GRADE_REASON, COULD_NOT_GRADE_REASON } from './legacyOneGrade'

/**
 * THE grade of each COMPLETED trade the AF Legacy trade report reads (`/api/legacy/trade-analytics`).
 *
 * 🛑 THE REPORT GRADED HISTORY ON A SECOND ENGINE UNTIL 2026-11-26. Its "at the time" and "now" values,
 * win/loss counts, best and worst trade and the three-lens report card all came from
 * `computeDualModeTradeDelta` (`lib/hybrid-valuation.ts`), while the /core Trades history, the grade
 * email and the dashboard band graded the SAME Sleeper trades through `oneGradeForCompletedTrade`. One
 * trade, two letters, depending on the screen.
 *
 * Now every trade goes through `oneGradeForCompletedTrade` on the viewer's own AF league row: the
 * letter is the trade's FROZEN ORIGINAL (priced at the time of the trade when a capture covers it),
 * with today's re-grade beside it as `current` — the "at the time" and "now" this report shows.
 *
 * ⚠ READ-ONLY ON THE FROZEN ORIGINALS. The legacy page sends a trade as names, positions and Sleeper
 * player ids, but a used pick only as season + round — it cannot say which player the pick became,
 * which the ledger surfaces key a frozen row by. Freezing from here could write a row the ledger
 * readers then refuse as "a different deal" and never replace. So this reads the frozen originals the
 * ledger surfaces wrote, prices the rest the same way they would, and freezes nothing.
 *
 * ⚠ MEMBERSHIP IS PROVEN HERE, as everywhere on the legacy page: the client sends a SLEEPER league id,
 * and `resolveEvaluationLeagueId` returns an AF league only when the signed-in user owns or has claimed
 * a team in it. Every way the grade cannot be taken is a withheld view with its reason.
 */

export type LegacyTradeParty = {
  userId: string
  teamName?: string
  displayName?: string
  playersReceived: Array<{ name: string; position?: string | null; id?: string | null }>
  picksReceived: Array<{ round: number; season: string; slot?: string }>
}

export type LegacyCompletedTrade = {
  transactionId: string
  timestamp: number
  week: number
  parties: LegacyTradeParty[]
}

function side(
  me: LegacyTradeParty,
  them: LegacyTradeParty,
  rosterId: number,
): TradeSideGrade {
  const asset = (p: LegacyTradeParty['playersReceived'][number]) => ({
    playerId: String(p.id ?? '').trim(),
    name: p.name,
    position: p.position ?? null,
    pointsBySeason: {},
    creditedBySeason: {},
    departed: null,
    gamesMissedBySeason: {},
  })
  const pick = (pk: LegacyTradeParty['picksReceived'][number]) => ({
    season: String(pk.season),
    round: Number(pk.round),
    // Unknown here. `completedTradeInputs` reads it only when present (`!= null`).
    originalRosterId: null as unknown as number,
    label: `${pk.season} Round ${pk.round}`,
    // The legacy page does not say which player a used pick became: unresolved, never guessed.
    resolved: null,
    pending: false,
    rerouted: false,
  })
  return {
    rosterId,
    ownerId: me.userId ?? null,
    managerName: me.teamName || me.displayName || me.userId || 'Unknown',
    teamName: me.teamName ?? null,
    avatar: null,
    playersIn: (me.playersReceived ?? []).filter((p) => p?.name?.trim()).map(asset),
    playersOut: (them.playersReceived ?? []).filter((p) => p?.name?.trim()).map(asset),
    picksIn: (me.picksReceived ?? []).map(pick),
    picksOut: (them.picksReceived ?? []).map(pick),
    madePlayoffs: null,
    seasonNets: [],
    cumulativeNet: 0,
    initialGrade: 'C',
    currentGrade: 'C',
    trend: 'steady',
  }
}

/**
 * A legacy trade in the ledger's terms, with side ONE as the viewer — so the grade is the viewer's.
 * Null when the viewer is not a party. A trade with more than two parties is marked multi-team, which
 * the one grade withholds rather than forcing three teams onto one value gap.
 */
export function legacyTradeAsGradedTrade(
  trade: LegacyCompletedTrade,
  isViewer: (p: LegacyTradeParty) => boolean,
): GradedTrade | null {
  const parties = trade.parties ?? []
  const me = parties.find(isViewer)
  if (!me) return null
  const others = parties.filter((p) => p !== me)
  const them = others[0] ?? { userId: '', playersReceived: [], picksReceived: [] }
  const at = new Date(Number(trade.timestamp))
  const createdIso = Number.isFinite(at.getTime()) ? at.toISOString() : new Date(0).toISOString()
  return {
    id: String(trade.transactionId),
    season: String(at.getUTCFullYear()),
    week: Number(trade.week) || 0,
    createdIso,
    multiTeam: parties.length > 2,
    tie: false,
    sides: [side(me, them, 1), side(them, me, 2)],
    hasPendingPicks: false,
  }
}

export type LegacyCompletedGradeDeps = {
  resolveLeague: typeof resolveEvaluationLeagueId
  loadFrozen: (afLeagueId: string, tradeIds: string[]) => Promise<ReadonlyMap<string, FrozenCompletedGrade>>
  grade: typeof oneGradeForCompletedTrade
  now: () => Date
}

const defaultDeps: LegacyCompletedGradeDeps = {
  resolveLeague: resolveEvaluationLeagueId,
  loadFrozen: (id, ids) => loadFrozenCompletedGrades(id, ids),
  grade: oneGradeForCompletedTrade,
  now: () => new Date(),
}

const withheld = (reason: string): TradeGradeView => ({ graded: false, reason, basis: null })

/**
 * THE grade of each trade, from the viewer's side, in `trades` order. Never throws: a trade that
 * cannot be graded is a withheld view with its reason.
 */
export async function gradeLegacyCompletedTrades(
  args: {
    suppliedLeagueId: string | null | undefined
    userId: string | null | undefined
    trades: ReadonlyArray<LegacyCompletedTrade>
    isViewer: (p: LegacyTradeParty) => boolean
  },
  deps: Partial<LegacyCompletedGradeDeps> = {},
): Promise<TradeGradeView[]> {
  const d = { ...defaultDeps, ...deps }
  const all = (reason: string) => args.trades.map(() => withheld(reason))
  if (!args.suppliedLeagueId?.trim()) return all(NO_LEAGUE_TO_GRADE_REASON)
  if (!args.userId?.trim()) return all(SIGN_IN_TO_GRADE_REASON)
  const leagueId = await d.resolveLeague({ suppliedLeagueId: args.suppliedLeagueId, userId: args.userId }).catch(() => null)
  if (!leagueId) return all(NOT_YOUR_LEAGUE_REASON)

  const ledger = args.trades.map((t) => legacyTradeAsGradedTrade(t, args.isViewer))
  const ids = ledger.flatMap((t) => (t ? [t.id] : []))
  const frozen = await d.loadFrozen(leagueId, ids).catch(() => new Map<string, FrozenCompletedGrade>())
  const now = d.now()
  const currentSeason = now.getUTCFullYear()

  const out: TradeGradeView[] = new Array(ledger.length)
  const CONCURRENCY = 4
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ledger.length) }, async () => {
      while (next < ledger.length) {
        const i = next++
        const trade = ledger[i]
        if (!trade) {
          out[i] = withheld('You are not a party to this trade, so it is not graded from your side.')
          continue
        }
        // `onFreeze` swallows: this surface never writes a frozen original (see the header).
        out[i] = await d
          .grade(leagueId, trade, currentSeason, { frozen, onFreeze: () => {}, now })
          .catch(() => withheld(COULD_NOT_GRADE_REASON))
      }
    }),
  )
  return out
}
