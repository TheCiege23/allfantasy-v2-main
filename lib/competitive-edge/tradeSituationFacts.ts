import { ageAtTrade, postureOf, VETERAN_MIN_AGE } from '@/lib/trade-market/postureMarketLearner'
import { needAt, NEED_POSITIONS, slotsFromRosterPositions, type NeedPosition } from '@/lib/trade-market/needMarketLearner'
import { TRADE_FLOOR, type EdgeFact, type EdgeTrade } from './tradeEdge'

/**
 * THE SITUATION AROUND A MANAGER'S TRADES — facts for the paid manager record (owner's call, 2026-11-22: "manager
 * psychology from trade history for Pro subscribers"; trade learning, step 7).
 *
 * The trade record (`buildTradeRecord`) counts what a manager moved. This adds WHEN and FROM WHERE, read from each
 * trade's saved context (`lib/trade-market/tradeContextSnapshot.ts`, `tradeContextBackfill.ts`):
 *   - when in the season they trade;
 *   - their record when they traded, and what they took on from there (players 27 or older; draft picks);
 *   - their depth at the position they took on — no spare there, superflex counted toward QB;
 *   - FAAB sent and received.
 *
 * 🛑 THE SAME CONTRACT AS EVERY COMPETITIVE EDGE LINE (docs/DECISION_OS_COMPETITIVE_EDGE_PRIVACY_STATUS.md):
 *   - FACTS, NEVER LABELS. "3 of the 4 trades they made at .600 or better took on a player 27 or older" — never
 *     "a win-now buyer". The record and depth thresholds are stated in every line that uses them.
 *   - NO PREDICTION. Nothing here says what they will do next.
 *   - COVERAGE IS PART OF THE ANSWER. A context-based line needs TRADE_FLOOR trades with a saved context, and says how
 *     many of the manager's trades had one; below that, nothing is claimed from context at all.
 *
 * The posture and depth rules are the trade-market learners' own (`postureOf`, `needAt`), so a fact about one
 * manager and the market measurement read a trade the same way.
 *
 * PURE.
 */

/** One side of a cached trade, with the fields this reads (the Sleeper trade-grade cache carries them all). */
type SituationSide = {
  ownerId: string | null
  rosterId?: number | null
  playersIn: Array<{ playerId?: string; position: string | null }>
  picksIn: unknown[]
  faabIn?: number
  faabOut?: number
}
export type SituationTrade = Omit<EdgeTrade, 'sides'> & { sides: SituationSide[] }

/** A trade's saved context, as `LeagueTrade.contextSnapshot` stores it — only the fields read here. */
export type SavedTradeContext = {
  unavailable?: unknown
  starterSlots?: Record<string, number> | null
  league?: { roster_positions?: unknown } | null
  sides?: Array<{
    rosterId?: unknown
    record?: { wins?: unknown; losses?: unknown; ties?: unknown } | null
    rosterBefore?: Array<{ position?: string | null }>
  }>
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function buildTradeSituationFacts(input: {
  name: string
  managerOwnerId: string
  trades: readonly SituationTrade[]
  /** Saved context per trade id (`<seasonLeagueId>:<transactionId>`). */
  contexts: ReadonlyMap<string, SavedTradeContext>
  /** Player age today, by Sleeper id. */
  ages: ReadonlyMap<string, number | null>
  now: Date
}): EdgeFact[] {
  const { name } = input
  const theirs = input.trades
    .map((t) => ({ t, side: t.sides.find((s) => s.ownerId === input.managerOwnerId) }))
    .filter((x): x is { t: SituationTrade; side: SituationSide } => Boolean(x.side))
  const n = theirs.length
  if (n < TRADE_FLOOR) return []
  const facts: EdgeFact[] = []

  // ── when in the season ──────────────────────────────────────────────────────────────────────────
  const offseason = theirs.filter(({ t }) => !(t.week > 1)).length
  const early = theirs.filter(({ t }) => t.week >= 2 && t.week <= 8).length
  const late = theirs.filter(({ t }) => t.week >= 9).length
  facts.push({
    key: 'trade.situation.timing',
    text: `Of ${name}'s ${n} trades, ${offseason} came in the offseason or week 1, ${early} in weeks 2–8 and ${late} from week 9 on.`,
    bearsOnDeal: false,
  })

  // ── FAAB ───────────────────────────────────────────────────────────────────────────────────────
  const faabSent = theirs.filter(({ side }) => (side.faabOut ?? 0) > 0)
  const faabGot = theirs.filter(({ side }) => (side.faabIn ?? 0) > 0)
  if (faabSent.length || faabGot.length) {
    const total = (xs: typeof theirs, k: 'faabOut' | 'faabIn') => xs.reduce((s, { side }) => s + (side[k] ?? 0), 0)
    facts.push({
      key: 'trade.situation.faab',
      text: `${name} sent FAAB in ${faabSent.length} of their ${n} trades ($${total(faabSent, 'faabOut')} in all) and received it in ${faabGot.length} ($${total(faabGot, 'faabIn')}).`,
      bearsOnDeal: false,
    })
  }

  // ── from the saved context: record and depth at the trade ─────────────────────────────────────
  type Read = {
    t: SituationTrade
    side: SituationSide
    posture: ReturnType<typeof postureOf>
    depth: (p: NeedPosition) => ReturnType<typeof needAt>
  }
  const reads: Read[] = []
  for (const { t, side } of theirs) {
    const ctx = input.contexts.get(t.id)
    if (!ctx || ctx.unavailable || !Array.isArray(ctx.sides) || side.rosterId == null) continue
    const mine = ctx.sides.find((s) => String(s.rosterId) === String(side.rosterId))
    if (!mine) continue
    const rec = mine.record
      ? { wins: Number(mine.record.wins) || 0, losses: Number(mine.record.losses) || 0, ties: Number(mine.record.ties) || 0 }
      : null
    const slots = ctx.starterSlots ?? slotsFromRosterPositions(ctx.league?.roster_positions)
    reads.push({ t, side, posture: postureOf(rec, t.week), depth: (p) => needAt(mine.rosterBefore, slots, p) })
  }
  if (reads.length < TRADE_FLOOR) {
    if (reads.length > 0) {
      facts.push({
        key: 'trade.situation.coverage',
        text: `Only ${plural(reads.length, 'trade')} of ${name}'s ${n} ${reads.length === 1 ? 'has its' : 'have their'} situation on file — fewer than ${TRADE_FLOOR}, so nothing is read from it yet.`,
        bearsOnDeal: false,
      })
    }
    return facts
  }
  const coverage = reads.length === n ? `all ${n} trades` : `${reads.length} of their ${n} trades`

  // Their record when they traded (week 4 on, three games played).
  const withRecord = reads.filter((r) => r.posture)
  if (withRecord.length > 0) {
    const at = (p: string) => withRecord.filter((r) => r.posture === p)
    const up = at('contend')
    const down = at('rebuild')
    const mid = at('middle')
    facts.push({
      key: 'trade.situation.record',
      text:
        `With a record on file for ${plural(withRecord.length, 'trade')} (week 4 on): ${up.length} made at .600 or better, ` +
        `${down.length} at .400 or worse and ${mid.length} in between.`,
      bearsOnDeal: false,
    })
    const tookVeteran = (r: Read) =>
      r.side.playersIn.some((p) => {
        const age = p.playerId ? ageAtTrade(input.ages.get(p.playerId) ?? null, new Date(r.t.createdIso), input.now) : null
        return age != null && age >= VETERAN_MIN_AGE
      })
    const tookPicks = (r: Read) => r.side.picksIn.length > 0
    for (const [group, words] of [[up, 'at .600 or better'], [down, 'at .400 or worse']] as const) {
      if (group.length === 0) continue
      facts.push({
        key: `trade.situation.${group === up ? 'ahead' : 'behind'}`,
        text:
          `Of the ${plural(group.length, 'trade')} they made ${words}, ${group.filter(tookVeteran).length} took on a player ` +
          `${VETERAN_MIN_AGE} or older and ${group.filter(tookPicks).length} took on draft picks.`,
        bearsOnDeal: false,
      })
    }
  }

  // Their depth at the position they took on.
  for (const p of NEED_POSITIONS) {
    const took = reads.filter((r) => r.side.playersIn.some((pl) => String(pl.position ?? '').toUpperCase() === p))
    const known = took.filter((r) => r.depth(p) != null)
    if (known.length === 0) continue
    const short = known.filter((r) => r.depth(p) === 'short').length
    const spareRule = p === 'QB' ? 'no spare quarterback (superflex counted as a QB slot)' : `no spare ${p}`
    facts.push({
      key: `trade.situation.depth.${p}`,
      text: `${name} took on a ${p} in ${plural(known.length, 'trade')} with their roster on file; in ${short} of them they held ${spareRule}.`,
      bearsOnDeal: false,
    })
  }

  facts.push({
    key: 'trade.situation.source',
    text: `Record and roster at the time are on file for ${coverage}.`,
    bearsOnDeal: false,
  })
  return facts
}
