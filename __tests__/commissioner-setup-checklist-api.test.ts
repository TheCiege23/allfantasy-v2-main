import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), league: vi.fn(), settings: vi.fn(),
  draft: vi.fn(), roster: vi.fn(), rosters: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: mocks.permission }))
vi.mock('@/lib/league/getEffectiveLeagueRosterTemplate', () => ({ getEffectiveLeagueRosterTemplate: mocks.roster }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: mocks.league }, leagueSettings: { findUnique: mocks.settings },
  draftSession: { findFirst: mocks.draft }, roster: { findMany: mocks.rosters },
} }))
import { GET } from '@/app/api/leagues/[leagueId]/setup/checklist/route'
const request = () => GET(new Request('http://localhost/api/leagues/l/setup/checklist'), { params: Promise.resolve({ leagueId: 'l' }) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'commissioner' } })
  mocks.permission.mockResolvedValue(undefined)
  mocks.league.mockResolvedValue({ leagueSize: 2, scoring: 'Half PPR', scoringPresetId: null, settings: {},
    teams: [{ claimedByUserId: 'owner' }, { isOrphan: true, platformUserId: 'open-slot-l-2' }] })
  mocks.settings.mockResolvedValue({ draftDateUtc: null })
  mocks.draft.mockResolvedValue(null)
  mocks.roster.mockResolvedValue({ hasPersistedRosterSchema: true, template: { slots: [{ starterCount: 9 }] } })
  mocks.rosters.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }])
})
describe('commissioner setup checklist API', () => {
  it('requires authentication before any league read', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await request()).status).toBe(401)
    expect(mocks.permission).not.toHaveBeenCalled()
    expect(mocks.league).not.toHaveBeenCalled()
  })
  it('denies non-commissioners before reading setup', async () => {
    mocks.permission.mockRejectedValue(new Response('Forbidden', { status: 403 }))
    expect((await request()).status).toBe(403)
    expect(mocks.league).not.toHaveBeenCalled()
  })
  it('returns private fresh progress from persisted league state', async () => {
    const response = await request()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await response.json()
    expect(body).toMatchObject({ ready: false, completed: 2, total: 6 })
    expect(body.steps.find((s: { id: string }) => s.id === 'managers').detail).toContain('1/2')
    expect(mocks.permission).toHaveBeenCalledWith('l', 'commissioner')
    expect(mocks.draft).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'l' } }))
  })
  it('does not turn an unavailable data source into completed checks', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.roster.mockRejectedValue(new Error('DB unavailable'))
    const response = await request()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Could not load league setup' })
    log.mockRestore()
  })
})
