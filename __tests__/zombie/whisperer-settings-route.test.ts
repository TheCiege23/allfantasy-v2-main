// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  requireCommissionerOnly: vi.fn(),
  zombieLeagueFindUnique: vi.fn(),
  zombieLeagueUpdate: vi.fn(),
  whispererRecordFindUnique: vi.fn(),
  zombieLeagueConfigUpsert: vi.fn(),
  zombieLeagueConfigFindUnique: vi.fn(),
  zombiePaidConfigFindUnique: vi.fn(),
  zombieFreeRewardConfigFindUnique: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerOnly: h.requireCommissionerOnly,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    zombieLeague: { findUnique: h.zombieLeagueFindUnique, update: h.zombieLeagueUpdate },
    whispererRecord: { findUnique: h.whispererRecordFindUnique },
    zombieLeagueConfig: { upsert: h.zombieLeagueConfigUpsert, findUnique: h.zombieLeagueConfigFindUnique },
    zombiePaidConfig: { findUnique: h.zombiePaidConfigFindUnique },
    zombieFreeRewardConfig: { findUnique: h.zombieFreeRewardConfigFindUnique },
  },
}))

function patch(changes: Record<string, unknown>) {
  return new Request('http://localhost/api/zombie/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ leagueId: 'league-1', ...changes }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'commissioner-1' } })
  h.requireCommissionerOnly.mockResolvedValue(undefined)
  h.zombieLeagueFindUnique.mockResolvedValue({ id: 'zombie-1', leagueId: 'league-1', status: 'setup' })
  h.zombieLeagueUpdate.mockResolvedValue({ id: 'zombie-1' })
  h.whispererRecordFindUnique.mockResolvedValue(null)
  h.zombieLeagueConfigUpsert.mockResolvedValue({ id: 'config-1' })
  h.zombiePaidConfigFindUnique.mockResolvedValue(null)
  h.zombieFreeRewardConfigFindUnique.mockResolvedValue(null)
})

describe('PATCH /api/zombie/settings Whisperer selection', () => {
  it('rejects unsupported manual selection', async () => {
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererSelectionMode: 'manual' }))
    expect(response.status).toBe(400)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

  it('rejects conflicting selection fields', async () => {
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({
      whispererSelectionMode: 'random',
      whispererSelection: 'veteran_priority',
    }))
    expect(response.status).toBe(400)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

  it('locks selection after a Whisperer has been assigned', async () => {
    h.whispererRecordFindUnique.mockResolvedValue({ id: 'whisperer-1' })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererSelectionMode: 'veteran_priority' }))
    expect(response.status).toBe(409)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

  it('locks selection after league activation', async () => {
    h.zombieLeagueFindUnique.mockResolvedValue({ id: 'zombie-1', status: 'active' })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererSelectionMode: 'veteran_priority' }))
    expect(response.status).toBe(409)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

  it('saves the same selection for the league and its activation config', async () => {
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererSelectionMode: 'veteran_priority' }))
    expect(response.status).toBe(200)
    expect(h.zombieLeagueUpdate).toHaveBeenCalledWith({
      where: { id: 'zombie-1' },
      data: { whispererSelectionMode: 'veteran_priority' },
    })
    expect(h.zombieLeagueConfigUpsert).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      create: { leagueId: 'league-1', whispererSelection: 'veteran_priority' },
      update: { whispererSelection: 'veteran_priority' },
    })
  })

  it('returns commissioner denial without writing', async () => {
    h.requireCommissionerOnly.mockRejectedValue(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    )
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererSelectionMode: 'random' }))
    expect(response.status).toBe(403)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })
})
