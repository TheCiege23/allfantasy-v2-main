/**
 * Put a value on the trades we already store.
 *
 * `LeagueTrade` carries `analyzed`, `valueGiven`, `valueReceived` and
 * `valueDifferential` — and until now NOTHING in the codebase ever set them. The single
 * writer of that table, `lib/dynasty-import/normalize-historical.ts`, writes players,
 * picks, partner and date, and touches none of the valuation fields in either its
 * `create` or its `update` branch. So they sat at their defaults permanently.
 *
 * That is not a cosmetic gap. `computeManagerTendencies` filters
 * `trades.filter(t => t.analyzed || t.valueGiven != null)` and returns null below two
 * survivors, so every manager fell through, `TradePreAnalysisCache` cached nothing,
 * and matchmaking ranked on positional overlap while presenting a five-dimension
 * model. Measured on one account: 468 trades, 0 usable, 0 of 207 managers clearing
 * the bar.
 *
 * VALUED AT THE TIME OF THE TRADE, NOT TODAY. `computeDualModeTradeDelta` returns both
 * readings; this takes `atTheTime`. Judging a 2023 trade at today's prices makes a deal
 * for a since-injured player look like a fleecing that never happened.
 *
 * AN UNPRICEABLE TRADE STAYS UNPRICED. When `atTheTime` is null — the value series does
 * not reach that date, or no asset resolves — the row is left exactly as it was rather
 * than being marked analyzed with zeros. A zero would flow into tendencies as a real
 * observation and be indistinguishable from a genuinely even trade. The count is
 * returned instead, so the gap is visible.
 */
import { prisma } from '@/lib/prisma'
import { computeDualModeTradeDelta, type UserTrade } from '@/lib/hybrid-valuation'

export type ValueStoredTradesResult = {
  considered: number
  valued: number
  /** Priced by the engine but returned nothing usable for that date. */
  unpriceable: number
  /** Missing the inputs to even attempt: no date, or no assets on either side. */
  skipped: number
  failed: number
  /** Distinct reasons, so a systemic cause is visible rather than a bare count. */
  reasons: Record<string, number>
}

type PickRef = { season?: number | string; round?: number }

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}

function asPickArray(v: unknown): PickRef[] {
  return Array.isArray(v) ? (v as PickRef[]).filter((p) => p && p.round != null) : []
}

function toPicks(v: unknown): Array<{ round: number; season: string }> {
  return asPickArray(v).map((p) => ({ round: Number(p.round), season: String(p.season ?? '') }))
}

/**
 * Value a bounded batch of unvalued trades.
 *
 * Bounded on purpose. This runs inside a cron that already does other work under a 300s
 * ceiling, so it drains over days rather than trying to clear a backlog in one request.
 * `fetchFantasyCalcValues` caches for an hour in-process, so a batch costs about two real
 * provider fetches regardless of size.
 */
export async function valueStoredTrades(
  opts: { limit?: number; historyIds?: string[] } = {},
): Promise<ValueStoredTradesResult> {
  const limit = opts.limit ?? 100
  const reasons: Record<string, number> = {}
  const note = (r: string) => {
    reasons[r] = (reasons[r] ?? 0) + 1
  }

  const trades = await prisma.leagueTrade.findMany({
    where: {
      analyzed: false,
      valueGiven: null,
      ...(opts.historyIds?.length ? { historyId: { in: opts.historyIds } } : {}),
    },
    select: {
      id: true, historyId: true, transactionId: true, week: true, tradeDate: true,
      isSuperFlex: true, playersGiven: true, playersReceived: true,
      picksGiven: true, picksReceived: true, partnerRosterId: true,
    },
    orderBy: { tradeDate: 'desc' },
    take: limit,
  })

  const result: ValueStoredTradesResult = {
    considered: trades.length, valued: 0, unpriceable: 0, skipped: 0, failed: 0, reasons,
  }
  if (trades.length === 0) return result

  // The viewer is the history owner. That column is NAMED sleeperUsername but holds the
  // numeric Sleeper user id — documented in TransactionFactBackfill, and confirmed on
  // production where the top holder across 18 leagues is 591462610482806784.
  const histories = await prisma.leagueTradeHistory.findMany({
    where: { id: { in: [...new Set(trades.map((t) => t.historyId))] } },
    select: { id: true, sleeperUsername: true },
  })
  const viewerByHistory = new Map(histories.map((h) => [h.id, h.sleeperUsername]))

  // Resolve every player id once. TradeParty wants names; LeagueTrade stores ids.
  const allIds = new Set<string>()
  for (const t of trades) {
    for (const id of asIdArray(t.playersGiven)) allIds.add(id)
    for (const id of asIdArray(t.playersReceived)) allIds.add(id)
  }
  const players = allIds.size
    ? await prisma.sportsPlayer.findMany({
        where: { sleeperId: { in: [...allIds] } },
        select: { sleeperId: true, name: true, position: true },
      })
    : []
  /** Exactly the shape TradeParty.playersReceived wants, so no cast is needed later. */
  type ResolvedPlayer = { name: string; position?: string }
  const nameById = new Map<string, ResolvedPlayer>()
  for (const p of players) {
    if (!p.sleeperId) continue
    const entry: ResolvedPlayer = p.position ? { name: p.name, position: p.position } : { name: p.name }
    nameById.set(String(p.sleeperId), entry)
  }

  for (const t of trades) {
    const viewerId = viewerByHistory.get(t.historyId)
    if (!viewerId) { result.skipped++; note('no history owner'); continue }
    if (!t.tradeDate) { result.skipped++; note('no trade date'); continue }

    const gaveIds = asIdArray(t.playersGiven)
    const gotIds = asIdArray(t.playersReceived)
    const gavePicks = toPicks(t.picksGiven)
    const gotPicks = toPicks(t.picksReceived)
    if (!gaveIds.length && !gotIds.length && !gavePicks.length && !gotPicks.length) {
      result.skipped++; note('no assets on either side'); continue
    }

    // Collect rather than map+filter: a type predicate over `T | undefined` does not
    // narrow cleanly to an optional-property shape, and a cast would hide a real miss.
    const resolve = (ids: string[]): ResolvedPlayer[] => {
      const out: ResolvedPlayer[] = []
      for (const id of ids) {
        const hit = nameById.get(id)
        if (hit) out.push(hit)
      }
      return out
    }

    const received = resolve(gotIds)
    const gave = resolve(gaveIds)
    if (received.length !== gotIds.length || gave.length !== gaveIds.length) {
      // Partial resolution would value only the half we recognise and call it a delta.
      result.skipped++; note('unresolved player id'); continue
    }

    /*
     * Two parties: the history owner, and the counterparty. What the owner GAVE is what
     * the partner RECEIVED — the engine reads each party's `playersReceived`, so the
     * sides must be mirrored, not repeated.
     */
    const userTrade: UserTrade = {
      transactionId: t.transactionId,
      timestamp: t.tradeDate.getTime(),
      week: t.week ?? undefined,
      parties: [
        { userId: String(viewerId), playersReceived: received, picksReceived: gotPicks },
        { userId: `roster:${t.partnerRosterId ?? 'unknown'}`, playersReceived: gave, picksReceived: gavePicks },
      ],
    }

    try {
      const { atTheTime } = await computeDualModeTradeDelta(userTrade, String(viewerId), t.isSuperFlex === true)
      if (!atTheTime) { result.unpriceable++; note('no value for that date'); continue }

      await prisma.leagueTrade.update({
        where: { id: t.id },
        data: {
          valueGiven: atTheTime.userGaveValue,
          valueReceived: atTheTime.userReceivedValue,
          valueDifferential: atTheTime.deltaValue,
          analyzed: true,
        },
      })
      result.valued++
    } catch (e) {
      result.failed++
      note(e instanceof Error ? e.message.slice(0, 60) : 'valuation threw')
    }
  }

  return result
}
