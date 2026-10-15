import { beforeEach, expect, it, vi } from 'vitest'
import type { StoredStrategy } from '@/lib/decision-os/value-v2/strategyStore'
import type { StrategyEvidenceFacts } from '@/lib/decision-os/value-v2/strategyEvidence'
const mocks = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), league: vi.fn(), read: vi.fn(), initialize: vi.fn(), commit: vi.fn(), load: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: mocks.role }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league } } }))
vi.mock('@/lib/decision-os/value-v2/strategyPrisma', () => ({ strategyPrismaPort: { read: mocks.read, initialize: mocks.initialize, commit: mocks.commit } }))
vi.mock('@/lib/decision-os/value-v2/strategyEvidencePrisma', () => ({ strategyEvidencePrismaPort: { load: mocks.load } }))
vi.mock('@/lib/decision-os/userOs', () => ({ resolveUserOsSnapshot: vi.fn() }))
import { POST } from '@/app/api/decision-os/user-os/route'
import { strategyPrompt } from '@/lib/decision-os/value-v2/strategyPrompt'
let row: StoredStrategy | null
let completedWeek: number
const scope = { userId: 'owner', leagueId: 'L', season: 2026 }
beforeEach(() => {
  vi.clearAllMocks(); row = null; completedWeek = 3
  mocks.session.mockResolvedValue({ user: { id: 'owner' } }); mocks.role.mockResolvedValue('member'); mocks.league.mockResolvedValue({ season: 2026 })
  mocks.read.mockImplementation(async () => structuredClone(row))
  mocks.initialize.mockImplementation(async () => row ??= { ...scope, id: 'S', active: 'balanced', revision: 0, lastObservedWeek: null, pending: null })
  mocks.commit.mockImplementation(async input => {
    if (input.previous.revision !== row?.revision) return false
    row = structuredClone(input.next); return true
  })
  mocks.load.mockImplementation(async (): Promise<StrategyEvidenceFacts> => ({ ...scope, sport: 'NFL', isDynasty: true,
    teamCount: 2, teamIds: ['a', 'b'], ownerTeamId: 'a', currentPeriod: completedWeek + 1, periodSource: 'sleeper_state_nfl',
    loadedAt: new Date().toISOString(), lastSyncedAt: new Date().toISOString(),
    results: Array.from({ length: completedWeek }, (_, i) => ['a', 'b'].map(teamId => ({
      id: `${teamId}:${i}`, teamId, season: 2026, week: i + 1, points: teamId === 'a' ? 70 : 120, result: teamId === 'a' ? 'L' : 'W',
    }))).flat(),
  }))
})
const post = (body: unknown) => POST(new Request('https://allfantasy.ai/api/decision-os/user-os?view=strategy&leagueId=L', {
  method: 'POST', headers: { origin: 'https://allfantasy.ai' }, body: JSON.stringify(body),
}))
it('runs server evidence through the real route, hysteresis and confirmation into the saved advice preference', async () => {
  let view
  for (completedWeek = 3; completedWeek <= 5; completedWeek++) {
    const response = await post({ action: 'refresh' })
    expect(response.status).toBe(200)
    view = await response.json()
    expect(view.active).toBe('balanced')
  }
  completedWeek = 5
  expect(view.evidence.canConfirm).toBe(true)
  expect(view.pending.observations).toBe(3)
  expect((await post({ expectedRevision: 2, strategy: 'rebuild', confirmed: true })).status).toBe(409)
  const response = await post({ expectedRevision: view.revision, strategy: view.pending.strategy, confirmed: true })
  expect(response.status).toBe(200)
  expect((await response.json()).active).toBe('rebuild')
  expect(strategyPrompt(row)).toContain('Active preference: rebuild')
  expect(mocks.commit.mock.calls.map(([input]) => input.action)).toEqual(['observe', 'observe', 'observe', 'confirm'])
})
it('revoked membership cannot refresh evidence or confirm a proposal', async () => {
  mocks.role.mockResolvedValue(null)
  expect((await post({ action: 'refresh' })).status).toBe(403)
  expect((await post({ expectedRevision: 3, strategy: 'rebuild', confirmed: true })).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.commit).not.toHaveBeenCalled()
})
