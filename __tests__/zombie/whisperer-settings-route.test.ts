// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  generateRulesDocument: vi.fn(),
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

vi.mock('@/lib/zombie/rulesDocGenerator', () => ({ generateRulesDocument: h.generateRulesDocument }))
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
  h.generateRulesDocument.mockResolvedValue(undefined)
  h.getServerSession.mockResolvedValue({ user: { id: 'commissioner-1' } })
  h.requireCommissionerOnly.mockResolvedValue(undefined)
  h.zombieLeagueFindUnique.mockResolvedValue({ id: 'zombie-1', leagueId: 'league-1', status: 'setup', sport: 'NFL', experienceMode: 'enhanced', whispererCount: 1, whispererAmbushCount: 3 })
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
  it('rejects ambush caps larger than a season grant', async () => {
    h.zombieLeagueFindUnique.mockResolvedValue({
      id: 'zombie-1', leagueId: 'league-1', status: 'setup', whispererAmbushCount: 3,
    })
    h.zombieLeagueConfigFindUnique.mockResolvedValue({ ambushCountPerWeek: 1 })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ whispererAmbushCount: 0 }))
    expect(response.status).toBe(400)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

  it('rejects an impossible serum revival cost', async () => {
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({ serumReviveCount: 0 }))
    expect(response.status).toBe(400)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
  })

})

describe('commissioner Zombie rule persistence contract', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('saves ambush and serum settings for %s and regenerates rules', async sport => {
    h.zombieLeagueFindUnique.mockResolvedValue({
      id: 'zombie-1', leagueId: 'league-1', status: 'setup',
      sport, experienceMode: 'enhanced', whispererCount: 1, whispererAmbushCount: 3,
    })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    const response = await PATCH(patch({
      whispererCount: sport === 'NFL' ? 1 : 2, whispererAmbushCount: 5,
      ambushCountPerWeek: 2, serumReviveCount: sport === 'NFL' ? 2 : 3, autoSerumRevive: true,
    }))
    expect(response.status).toBe(200)
    expect(h.zombieLeagueUpdate).toHaveBeenCalledWith({
      where: { id: 'zombie-1' },
      data: { whispererCount: sport === 'NFL' ? 1 : 2, whispererAmbushCount: 5 },
    })
    expect(h.zombieLeagueConfigUpsert).toHaveBeenCalledWith({
      where: { leagueId: 'league-1' },
      create: { leagueId: 'league-1', ambushCountPerWeek: 2, serumReviveCount: sport === 'NFL' ? 2 : 3, autoSerumRevive: true },
      update: { ambushCountPerWeek: 2, serumReviveCount: sport === 'NFL' ? 2 : 3, autoSerumRevive: true },
    })
    expect(h.generateRulesDocument).toHaveBeenCalledWith('zombie-1')
  })

  it.each([
    ['NFL', 'enhanced'], ['NFL', 'simple'], ['NBA', 'simple'], ['NHL', 'simple'], ['MLB', 'simple'],
  ])('rejects two Whisperers in %s %s without writes', async (sport, experienceMode) => {
    h.zombieLeagueFindUnique.mockResolvedValue({ id: 'zombie-1', status: 'setup', sport, experienceMode })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    expect((await PATCH(patch({ whispererCount: 2 }))).status).toBe(400)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
    expect(h.zombieLeagueConfigUpsert).not.toHaveBeenCalled()
  })

  it('locks serum rule changes once active', async () => {
    h.zombieLeagueFindUnique.mockResolvedValue({ id: 'zombie-1', status: 'active' })
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    expect((await PATCH(patch({ serumReviveCount: 3, autoSerumRevive: true }))).status).toBe(409)
    expect(h.zombieLeagueUpdate).not.toHaveBeenCalled()
    expect(h.zombieLeagueConfigUpsert).not.toHaveBeenCalled()
  })
})

it('rejects attempts to re-enable Zombie trading under the 2025 rules', async () => {
  const { PATCH } = await import('@/app/api/zombie/settings/route')
  const response = await PATCH(patch({ zombieTradeBlocked: false }))
  expect(response.status).toBe(400)
  expect(h.zombieLeagueConfigUpsert).not.toHaveBeenCalled()
})

describe('fixed 2025 NFL item rules', () => {
  it.each([{ serumReviveCount: 3 }, { autoSerumRevive: false }, { weaponTopTwoActive: false }, { bombOneTimeOverride: false }, { serumUseBeforeLastStarter: false }])('rejects incompatible rules without writes: %j', async change => {
    const { PATCH } = await import('@/app/api/zombie/settings/route')
    expect((await PATCH(patch(change))).status).toBe(400)
    expect(h.zombieLeagueConfigUpsert).not.toHaveBeenCalled()
  })
})
