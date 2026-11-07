import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { LOPSIDED_GAP_PCT } from '@/lib/decision-os/trade/tradeReview'
import { PROJECTED_EVEN_BAND } from '@/lib/trade-intel/gradeScale'
import {
  AUDIT_OUTSIDE_PCT,
  auditTeams,
  buildTradeReviewText,
  fairnessBand,
  pairFrequency,
  teamTradeLines,
  type AuditRow,
} from '@/lib/integrity/tradeAudit'
import { AT_COMPLETION_WINDOW_MS, auditRowFromReview, tradeKeyOf } from '@/lib/integrity/tradeValueAudit'
import { disputeHealthSignals, type LeagueDispute } from '@/lib/disputes/disputeStore'
import { monitorLeagueHealth, LeagueHealthInputSchema } from '@/lib/league-health/league-health-engine'

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  tradeKey: 'af:t1',
  sideATeamId: 'A',
  sideBTeamId: 'B',
  sideAName: 'Alpha',
  sideBName: 'Bravo',
  sideAGave: ['Star Runner'],
  sideBGave: ['Bench Guy', '2027 2nd'],
  sideAValue: 5000,
  sideBValue: 4800,
  gapPct: -4,
  basis: 'at_completion',
  completedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

describe('fairness bands — the trade review’s own lines', () => {
  it('uses the review’s even band and lopsided line, not a second set', () => {
    expect(AUDIT_OUTSIDE_PCT).toBe(LOPSIDED_GAP_PCT)
    expect(fairnessBand(PROJECTED_EVEN_BAND - 0.1)).toBe('fair')
    expect(fairnessBand(-(PROJECTED_EVEN_BAND + 1))).toBe('watch')
    expect(fairnessBand(LOPSIDED_GAP_PCT)).toBe('watch')
    expect(fairnessBand(LOPSIDED_GAP_PCT + 1)).toBe('outside')
  })
})

describe('teamTradeLines — one team’s side of every trade', () => {
  it('orients each trade to the chosen team, whichever side it was on', () => {
    const rows = [row(), row({ tradeKey: 'af:t2', sideATeamId: 'C', sideAName: 'Charlie', sideBTeamId: 'A', sideBName: 'Alpha', gapPct: 50, completedAt: '2026-10-05T00:00:00.000Z' })]
    const lines = teamTradeLines(rows, 'A')
    expect(lines.map((l) => l.tradeKey)).toEqual(['af:t2', 'af:t1']) // newest first
    // In t2 Alpha is side B and Charlie received 50% more: from Alpha's side that is -50.
    expect(lines[0]).toMatchObject({ partnerName: 'Charlie', gapPct: -50, band: 'outside' })
    expect(lines[1]).toMatchObject({ partnerName: 'Bravo', sent: ['Star Runner'], received: ['Bench Guy', '2027 2nd'], gapPct: -4, band: 'fair' })
    expect(auditTeams(rows)[0]).toEqual({ teamId: 'A', name: 'Alpha', trades: 2 })
  })

  it('writes a review a commissioner can post', () => {
    const text = buildTradeReviewText({ teamName: 'Alpha', lines: teamTradeLines([row()], 'A') })
    expect(text).toContain('2026-10-01 with Bravo: sent Star Runner (5,000) for Bench Guy, 2027 2nd (4,800) — 4% gap, within the fair range.')
    expect(text).toContain('1 trades: 1 fair, 0 worth a look, 0 outside the fair range.')
    expect(text).toContain("not today's")
  })
})

describe('pairFrequency — a pattern, never one trade', () => {
  const league = (pairTrades: number, others: number) => [
    ...Array.from({ length: pairTrades }, (_, i) => row({ tradeKey: `p${i}`, gapPct: i === 0 ? 55 : 5 })),
    ...Array.from({ length: others }, (_, i) => row({ tradeKey: `o${i}`, sideATeamId: `X${i}`, sideAName: `X${i}`, sideBTeamId: `Y${i}`, sideBName: `Y${i}` })),
  ]

  it('names a pair trading far above the league’s volume', () => {
    const [f] = pairFrequency(league(4, 6), 12)
    expect(f).toMatchObject({ teamIds: ['A', 'B'], count: 4, outside: 1 })
  })

  it('two trades is never a pattern, however quiet the league', () => {
    expect(pairFrequency(league(2, 0), 12)).toEqual([])
  })

  it('three trades is not a pattern in a league that trades constantly', () => {
    // 120 trades across 66 possible pairs: ~1.8 expected per pair, so 3 is under 3x.
    expect(pairFrequency(league(3, 117), 12)).toEqual([])
  })
})

describe('auditRowFromReview — what a trade review becomes', () => {
  const NOW = new Date('2026-11-07T12:00:00.000Z')
  const review = (over: Record<string, unknown> = {}, grade: Record<string, unknown> = {}) =>
    ({
      ok: true,
      trade: { status: 'completed', completedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), origin: { source: 'af' }, ...over },
      receipt: {
        grade: { graded: true, giveValue: 5000, getValue: 3000, percentDiff: -40, ...grade },
        assets: [
          { side: 'give', name: 'Star Runner' },
          { side: 'get', name: 'Bench Guy' },
        ],
      },
      sides: [
        { teamId: 'rA', rosterId: 'rA', gives: [] },
        { teamId: 'rB', rosterId: null, gives: [] },
      ],
      sideNames: ['Alpha', 'Bravo'],
    }) as never

  it('a trade graded as it settles is priced at completion', () => {
    const r = auditRowFromReview(review(), { kind: 'af', tradeId: 't1' }, NOW)
    expect(r).toMatchObject({ tradeKey: 'af:t1', sideATeamId: 'rA', sideBTeamId: 'rB', sideAGave: ['Star Runner'], sideBGave: ['Bench Guy'], sideAValue: 5000, sideBValue: 3000, gapPct: -40, basis: 'at_completion' })
  })

  it('a trade first reached long after it settled says so', () => {
    const old = new Date(NOW.getTime() - AT_COMPLETION_WINDOW_MS - 1).toISOString()
    expect(auditRowFromReview(review({ completedAt: old }), { kind: 'af', tradeId: 't1' }, NOW)?.basis).toBe('first_audited')
  })

  it('records nothing for a pending trade or a withheld grade', () => {
    expect(auditRowFromReview(review({ status: 'proposed' }), { kind: 'af', tradeId: 't1' }, NOW)).toBeNull()
    expect(auditRowFromReview(review({}, { graded: false }), { kind: 'af', tradeId: 't1' }, NOW)).toBeNull()
  })

  it('keys a Sleeper trade on the transaction id alone', () => {
    expect(tradeKeyOf({ kind: 'provider', provider: 'sleeper', providerTradeId: 'L9:12345' })).toBe('sleeper:12345')
  })
})

describe('League Health reads the dispute desk', () => {
  const NOW = new Date('2026-11-07T12:00:00.000Z')
  const d = (over: Partial<LeagueDispute>): LeagueDispute => ({
    id: Math.random().toString(36),
    category: 'other',
    subject: 's',
    details: '',
    filedByUserId: 'u1',
    filedByName: null,
    status: 'open',
    createdAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    closedAt: null,
    ruling: null,
    ...over,
  })

  it('counts disputes, open ones, collusion complaints and distinct managers who might leave', () => {
    const s = disputeHealthSignals(
      [
        d({ category: 'collusion' }),
        d({ category: 'collusion', status: 'ruled', filedByUserId: 'u2' }),
        d({ category: 'trade', status: 'withdrawn' }),
        d({ category: 'leaving', filedByUserId: 'u3' }),
        d({ category: 'leaving', filedByUserId: 'u3' }),
        d({ category: 'leaving', filedByUserId: 'u4', status: 'ruled', createdAt: new Date(NOW.getTime() - 90 * 86_400_000).toISOString() }),
        d({ category: 'lineup', createdAt: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
      ],
      NOW,
    )
    expect(s).toEqual({ disputeCount: 2, unresolvedDisputes: 1, collusionComplaints: 2, departureSignals: 1 })
  })

  it('a manager who might leave raises churn risk; supplying nothing scores exactly as before', () => {
    const base = LeagueHealthInputSchema.parse({ leagueId: 'L1' })
    const before = monitorLeagueHealth(base)
    expect(monitorLeagueHealth({ ...base, departureSignals: 0, collusionComplaints: 0 })).toMatchObject({ churnRiskScore: before.churnRiskScore, sustainabilityScore: before.sustainabilityScore })
    const leaving = monitorLeagueHealth({ ...base, departureSignals: 2, collusionComplaints: 2 })
    expect(leaving.churnRiskScore).toBeGreaterThan(before.churnRiskScore)
    expect(leaving.biggestProblems.join(' ')).toMatch(/2 managers said they might leave the league/)
    expect(leaving.urgentAlerts.join(' ')).toMatch(/might leave/)
    expect(leaving.interventionRecommendations.join(' ')).toMatch(/trade history review/)
  })
})
