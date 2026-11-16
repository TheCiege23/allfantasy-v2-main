/**
 * Chimmy sees every offer waiting on the user (Trade OS, 2026-11-16) — not only the redraft proposal table, which
 * holds no rows in production. A native AllFantasy offer (`AfLeagueTrade`) and a Sleeper offer from the provider
 * ledger (`ProviderTradeOffer`) are read, graded through the one evaluator, and named with where to answer them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  proposals: vi.fn(),
  rosters: vi.fn(),
  afTrades: vi.fn(),
  teamFirst: vi.fn(),
  offers: vi.fn(),
  user: vi.fn(),
  coOwner: vi.fn(),
  evaluate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findMany: m.proposals },
    redraftRoster: { findMany: async () => [] },
    roster: { findMany: m.rosters },
    afLeagueTrade: { findMany: m.afTrades },
    leagueTeam: { findFirst: m.teamFirst },
    providerTradeOffer: { findMany: m.offers },
    appUser: { findUnique: m.user },
  },
}))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: m.coOwner }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: m.evaluate }))

import { buildPendingTradeDecisionContext } from '@/lib/chimmy-trade/pendingTradeDecisionGrounding'

function graded(id: string, me: string, them: string) {
  return {
    ok: true,
    trade: {
      id,
      sideA: { teamId: them, rosterId: null, gives: [{ kind: 'player', playerId: 'p1', name: 'Incoming Guy', position: 'WR' }] },
      sideB: {
        teamId: me,
        rosterId: null,
        gives: [
          { kind: 'pick', season: 2027, round: 2, originalTeamId: null, label: '2027 Round 2' },
          { kind: 'faab', amount: 15 },
        ],
      },
    },
    receipt: {
      receiptId: `rcpt_${id}`,
      grade: { graded: true, letter: 'A-', label: 'Favors you', giveValue: 3000, getValue: 3900 },
      partnerGrade: { graded: true, letter: 'C' },
      canonical: null,
    },
    perspectiveTeamId: me,
    viewerInTrade: true,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  m.proposals.mockResolvedValue([])
  m.rosters.mockResolvedValue([{ id: 'R-me' }])
  m.coOwner.mockResolvedValue(null)
  m.afTrades.mockResolvedValue([{ id: 'af-1', expiresAt: new Date('2026-11-20T00:00:00.000Z'), proposerRoster: { platformUserId: 'u-rival' } }])
  m.user.mockResolvedValue({ displayName: 'Rival Ray', username: 'ray' })
  m.teamFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.claimedByUserId === 'me') return { externalId: '0003', teamName: 'My Team' }
    if (where.claimedByUserId === 'u-rival') return null
    const ids = (where.externalId as { in: string[] } | undefined)?.in ?? []
    if (ids.includes('5')) return { teamName: 'Sleeper Sharks', ownerName: 'shark' }
    return null
  })
  m.offers.mockResolvedValue([
    { providerTradeId: 'sl-needs-me', proposedByRosterId: '5', consentedRosterIds: ['5'], expiresAt: null },
    { providerTradeId: 'sl-i-sent', proposedByRosterId: '3', consentedRosterIds: ['3'], expiresAt: null },
    { providerTradeId: 'sl-i-agreed', proposedByRosterId: '5', consentedRosterIds: ['5', '3'], expiresAt: null },
  ])
  m.evaluate.mockImplementation(async ({ ref }: { ref: { kind: string; tradeId?: string; providerTradeId?: string } }) =>
    ref.kind === 'af' ? graded(ref.tradeId!, 'R-me', 'R-rival') : graded(ref.providerTradeId!, '3', '5'),
  )
})

describe('Chimmy sees native and Sleeper offers', () => {
  it('reads native offers where one of the user\'s rosters is the receiver', async () => {
    await buildPendingTradeDecisionContext('L', 'me')
    expect(m.afTrades.mock.calls[0]![0].where).toEqual({ leagueId: 'L', status: 'pending', receiverRosterId: { in: ['R-me'] } })
  })

  it('includes the co-owned roster in the native read', async () => {
    m.coOwner.mockResolvedValue('R-co')
    await buildPendingTradeDecisionContext('L', 'me')
    expect(m.afTrades.mock.calls[0]![0].where.receiverRosterId).toEqual({ in: ['R-me', 'R-co'] })
  })

  it('reads Sleeper offers on the unpadded provider id and keeps only the ones that need the user', async () => {
    const out = (await buildPendingTradeDecisionContext('L', 'me'))!
    expect(m.offers.mock.calls[0]![0].where).toEqual({ leagueId: 'L', provider: 'sleeper', status: 'pending', rosterIds: { has: '3' } })
    expect(out).toContain('Sleeper offer sl-needs-me from Sleeper Sharks')
    expect(out).not.toContain('sl-i-sent')
    expect(out).not.toContain('sl-i-agreed')
    const refs = m.evaluate.mock.calls.map((c) => c[0].ref)
    expect(refs).toEqual([
      { kind: 'af', tradeId: 'af-1' },
      { kind: 'provider', provider: 'sleeper', providerTradeId: 'sl-needs-me' },
    ])
  })

  it('describes each offer from the user\'s side, with the one grade and where to answer it', async () => {
    const onGrade = vi.fn()
    const out = (await buildPendingTradeDecisionContext('L', 'me', { onGrade }))!
    expect(out).toContain('PENDING INCOMING TRADES (2)')
    expect(out).toContain(
      "- AllFantasy offer af-1 from Rival Ray: you receive [Incoming Guy], you send [2027 Round 2, 15 FAAB]. Expires 2026-11-20T00:00:00.000Z. Answer it in AllFantasy's Trade Center.",
    )
    expect(out).toContain('Answer it on Sleeper — AllFantasy can read and grade Sleeper offers but cannot answer them.')
    expect(out).toContain('you A- — Favors you; Rival Ray C.')
    expect(out).toContain('Evaluation receipt: rcpt_sl-needs-me.')
    expect(onGrade).toHaveBeenCalledTimes(2)
    expect(onGrade.mock.calls[1]![0].letters).toEqual(['A-', 'C'])
  })

  it('a broken Sleeper read leaves the native offer in place, and the reverse', async () => {
    m.offers.mockRejectedValue(new Error('down'))
    let out = (await buildPendingTradeDecisionContext('L', 'me'))!
    expect(out).toContain('AllFantasy offer af-1')
    expect(out).toContain('PENDING INCOMING TRADES (1)')

    m.offers.mockResolvedValue([{ providerTradeId: 'sl-needs-me', proposedByRosterId: '5', consentedRosterIds: [], expiresAt: null }])
    m.afTrades.mockRejectedValue(new Error('down'))
    out = (await buildPendingTradeDecisionContext('L', 'me'))!
    expect(out).toContain('Sleeper offer sl-needs-me')
    expect(out).not.toContain('AllFantasy offer')
  })

  it('stays silent when nothing waits anywhere', async () => {
    m.afTrades.mockResolvedValue([])
    m.offers.mockResolvedValue([])
    expect(await buildPendingTradeDecisionContext('L', 'me')).toBeNull()
  })

  it('a refused grade names the offer and withholds a letter', async () => {
    m.offers.mockResolvedValue([])
    m.evaluate.mockResolvedValue({ ok: false, refusal: { code: 'not_found', reason: 'Trade gone.', missingAssets: [] } })
    const out = (await buildPendingTradeDecisionContext('L', 'me'))!
    expect(out).toContain("- AllFantasy offer from Rival Ray. Expires 2026-11-20T00:00:00.000Z. Answer it in AllFantasy's Trade Center.")
    expect(out).toContain('Grade: NOT AVAILABLE — Trade gone. Do not grade it yourself.')
  })

  it('never shows more than three offers, redraft proposals first', async () => {
    m.afTrades.mockImplementation(async ({ take }: { take: number }) =>
      Array.from({ length: take }, (_, i) => ({ id: `af-${i}`, expiresAt: null, proposerRoster: { platformUserId: 'u-rival' } })),
    )
    const out = (await buildPendingTradeDecisionContext('L', 'me'))!
    expect(out).toContain('PENDING INCOMING TRADES (3)')
    expect(m.afTrades.mock.calls[0]![0].take).toBe(3)
  })
})
