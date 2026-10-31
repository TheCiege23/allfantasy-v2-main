import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ rows: vi.fn(), report: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { keeperEligibility: { findMany: m.rows } } }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/keeper/eligibilityEngine', () => ({ computeKeeperEligibility: vi.fn() }))
vi.mock('@/lib/keeper/keeperValueReport', () => ({ keeperValueReport: m.report }))

import { GET } from '@/app/api/keeper/eligibility/route'

const get = () => GET(new NextRequest('http://x/api/keeper/eligibility?leagueId=L&seasonId=S&rosterId=R'))
const row = (playerId: string, isEligible: boolean) => ({ playerId, rosterId: 'R', isEligible, ineligibleReason: isEligible ? null : 'max_years_reached', projectedCost: 'Round 9', projectedCostRound: 9, yearsKept: 0 })

beforeEach(() => {
  vi.clearAllMocks()
  m.rows.mockResolvedValue([row('p1', true), row('p2', false)])
})

describe('keeper eligibility carries the value report', () => {
  it('prices only eligible candidates and returns the report beside the eligibility', async () => {
    m.report.mockResolvedValue({ available: true, values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 } } })
    const body = await (await get()).json()
    expect(m.report.mock.calls[0][1].map((r: { playerId: string }) => r.playerId)).toEqual(['p1'])
    expect(body.valueReport).toEqual({ available: true, values: { p1: { marketRank: 10, pickSlot: 102, surplus: 92 } } })
    expect(body.raw).toHaveLength(2)
  })
  it('a report that throws never hides the eligibility', async () => {
    m.report.mockRejectedValue(new Error('chart down'))
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valueReport).toEqual({ available: false, reason: 'no_market_values' })
    expect(body.eligible).toHaveLength(1)
  })
})
