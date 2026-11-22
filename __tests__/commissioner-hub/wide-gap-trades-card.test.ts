import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const queryRaw = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))

import { NO_REVIEW_SIGNALS, reviewSignalCards, WIDE_GAP_PCT, WIDE_GAP_TRADE_DAYS } from '@/lib/core-app/commissioner/signals'
import { AUDIT_OUTSIDE_PCT } from '@/lib/integrity/tradeAudit'
import { countWideGapAudits, resetTradeValueAuditsReadyCache } from '@/lib/integrity/tradeValueAudit'

/**
 * The commissioner hub's "trades worth a look" card (owner's call, 2026-11-22): recent completed trades far from even
 * on the day's values. A count and a link to the review — a fact, never an accusation.
 */

describe('the card', () => {
  it('uses the same gap the trade review already calls "outside"', () => {
    expect(WIDE_GAP_PCT).toBe(AUDIT_OUTSIDE_PCT)
  })

  it('no wide-gap trades, no card', () => {
    expect(reviewSignalCards('L1', NO_REVIEW_SIGNALS)).toEqual([])
  })

  it('says how many, over what window, that it is not a finding, and sends you to the review', () => {
    const [card] = reviewSignalCards('L 1', { ...NO_REVIEW_SIGNALS, wideGapTrades: 2 })
    expect(card).toEqual({
      id: 'review:trade-gaps',
      severity: 'info',
      source: 'review',
      title: '2 recent trades with a value gap of 40% or more',
      detail: `Completed in the last ${WIDE_GAP_TRADE_DAYS} days. A gap is what the values said on the day, not a finding. See each one against what similar trades cost.`,
      due: null,
      action: { label: 'Look at the trades', href: '/league/L%201/commissioner/integrity', external: false },
    })
    expect(reviewSignalCards('L1', { ...NO_REVIEW_SIGNALS, wideGapTrades: 1 })[0]!.title).toBe('1 recent trade with a value gap of 40% or more')
  })

  it('in Spanish a trade is «intercambio», and the card still says it is not a conclusion', () => {
    const [card] = reviewSignalCards('L1', { ...NO_REVIEW_SIGNALS, wideGapTrades: 2 }, 'es')
    expect(card!.title).toBe('2 intercambios recientes con una diferencia de valor del 40% o más')
    expect(card!.detail).toMatch(/no una conclusión/)
    expect(card!.action!.label).toBe('Ver los intercambios')
  })
})

describe('the read', () => {
  const SINCE = new Date('2026-11-08T00:00:00Z')
  beforeEach(() => {
    queryRaw.mockReset()
    resetTradeValueAuditsReadyCache()
  })

  it('one grouped count for every league; a gap either way counts', async () => {
    queryRaw.mockResolvedValueOnce([{ n: 1 }]).mockResolvedValueOnce([{ league_id: 'L1', n: 2 }, { league_id: 'L3', n: BigInt(1) }])
    const out = await countWideGapAudits(['L1', 'L2', 'L3'], SINCE, 40)
    expect([...out.entries()]).toEqual([['L1', 2], ['L3', 1]])
    const sql = (queryRaw.mock.calls[1]![0] as TemplateStringsArray).join('?')
    expect(sql).toContain('ABS(gap_pct) >=')
    expect(sql).toContain('GROUP BY league_id')
    expect(queryRaw.mock.calls[1]).toContain(SINCE)
    expect(queryRaw.mock.calls[1]).toContain(40)
  })

  it('no leagues, or the table not there yet: an empty map and no count query', async () => {
    expect((await countWideGapAudits([], SINCE, 40)).size).toBe(0)
    expect(queryRaw).not.toHaveBeenCalled()
    queryRaw.mockResolvedValueOnce([{ n: 0 }])
    expect((await countWideGapAudits(['L1'], SINCE, 40)).size).toBe(0)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })
})
