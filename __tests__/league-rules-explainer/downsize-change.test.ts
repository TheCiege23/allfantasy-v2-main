import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findFirst: vi.fn(), update: vi.fn() },
  roster: { count: vi.fn() },
  publish: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, roster: m.roster } }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/subscription/requireEntitlement', () => ({ requireEntitlement: vi.fn(async () => 'commissioner') }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/dispersal-draft-eligibility', () => ({ isLeagueEligibleForDispersalDraft: () => true }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))

import { POST } from '@/app/api/leagues/[leagueId]/downsize/handler'

beforeEach(() => {
  vi.clearAllMocks()
  m.league.findFirst.mockResolvedValue({ id: 'L', leagueSize: 12, settings: {}, isDynasty: true })
  m.league.update.mockResolvedValue({})
  m.roster.count.mockResolvedValue(12)
  m.publish.mockResolvedValue(undefined)
})

describe('downsize change card', () => {
  it('records the persisted team count after a successful downsize', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ newTeamCount: 10 }) })
    const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'L' }) })
    expect(res.status).toBe(200)
    expect(m.league.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leagueSize: 10 }) }))
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ changes: [{ key: 'teamCount', before: 12, after: 10 }] }))
  })

  it('does not publish when validation rejects the requested size', async () => {
    const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ newTeamCount: 13 }) })
    const res = await POST(req as never, { params: Promise.resolve({ leagueId: 'L' }) })
    expect(res.status).toBe(400)
    expect(m.publish).not.toHaveBeenCalled()
  })
})
