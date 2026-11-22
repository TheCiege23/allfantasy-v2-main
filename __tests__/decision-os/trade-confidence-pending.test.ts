/**
 * Trade OS, 2026-11-21: Chimmy's list of offers waiting on the user states how sure each letter is — from AllFantasy's
 * graded redraft deals — beside the grade, and only where the ledger grades that kind of deal (NFL redraft).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'

function graded(sport: string, leagueType: string, letter = 'B') {
  return {
    ok: true,
    trade: {
      id: 'af-1',
      sport,
      sideA: { teamId: 'R-them', rosterId: 'R-them', gives: [{ kind: 'player', playerId: 'p1', name: 'Incoming Guy', position: 'WR' }] },
      sideB: { teamId: 'R-me', rosterId: 'R-me', gives: [{ kind: 'player', playerId: 'p2', name: 'Outgoing Guy', position: 'RB' }] },
    },
    receipt: {
      receiptId: null,
      grade: { graded: true, letter, label: 'Leans you', giveValue: 3000, getValue: 3400, leagueType: { type: leagueType, label: leagueType, source: 'confirmed', platform: null } },
      partnerGrade: { graded: true, letter: 'D' },
      canonical: null,
    },
    perspectiveTeamId: 'R-me',
    viewerInTrade: true,
  }
}

const base = () => ({
  findProposals: vi.fn(async () => []),
  findStoredOffers: vi.fn(async () => [{ ref: { kind: 'af' as const, tradeId: 'af-1' }, from: 'Rival Ray', expiresAt: null }]),
  resolveWorld: vi.fn(async () => null),
  now: () => 0,
})

let letterCalibration: ReturnType<typeof vi.fn>
beforeEach(() => {
  letterCalibration = vi.fn(async () => ({ B: { heldRate: 0.5, decided: 44 } }))
})

describe('the waiting offer’s grade carries how sure it is', () => {
  it('NFL redraft: the confidence line sits under the grade, and says a low one is closer than its letter', async () => {
    const out = (await buildPendingTradeDecisionContext('L', 'me', { ...base(), evaluate: vi.fn(async () => graded('NFL', 'redraft')) as never, letterCalibration }))!
    expect(out).toContain('you B — Leans you; Rival Ray D.')
    expect(out).toContain(
      "  How sure that B is: low — about 50% of AllFantasy's B grades on redraft deals held up (44 decided, recent ones weighted more). Say the deal is closer than the letter suggests. State it beside the grade; it never changes the letter.",
    )
    expect(letterCalibration).toHaveBeenCalledTimes(1)
  })

  it('🛑 a dynasty or non-NFL grade gets no confidence: the ledger does not grade that kind of deal', async () => {
    for (const [sport, type] of [['NFL', 'dynasty'], ['NBA', 'redraft']] as const) {
      const out = (await buildPendingTradeDecisionContext('L', 'me', { ...base(), evaluate: vi.fn(async () => graded(sport, type)) as never, letterCalibration }))!
      expect(out).toContain('you B — Leans you')
      expect(out).not.toContain('How sure')
    }
  })

  it('no record, or a failed read, and the grade reads exactly as before', async () => {
    for (const cal of [vi.fn(async () => null), vi.fn(async () => { throw new Error('down') })]) {
      const out = (await buildPendingTradeDecisionContext('L', 'me', { ...base(), evaluate: vi.fn(async () => graded('NFL', 'redraft')) as never, letterCalibration: cal }))!
      expect(out).toContain('you B — Leans you')
      expect(out).not.toContain('How sure')
    }
  })
})
