// @vitest-environment node
/**
 * /api/leagues/[leagueId]/season-recap-ai: writing Chimmy's recap is the commissioner's and needs AF
 * Commissioner (Storyline Studio's `storylineEntitled`), checked before anything can spend; reading
 * the league's cached recap is any member's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  access: vi.fn(),
  entitled: vi.fn(),
  upgrade: vi.fn(),
  generate: vi.fn(),
  readCached: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: m.access }))
vi.mock('@/lib/storyline-studio/storylineService', () => ({ storylineEntitled: m.entitled, storylineUpgradePath: m.upgrade }))
vi.mock('@/lib/season-recap/seasonRecapAi', () => ({ generateSeasonRecapNarrative: m.generate, readCachedSeasonRecapNarrative: m.readCached }))

import { GET, POST } from '@/app/api/leagues/[leagueId]/season-recap-ai/handler'

const ctx = { params: Promise.resolve({ leagueId: 'l1' }) }
const post = (body: unknown) => POST(new Request('http://x/r', { method: 'POST', body: JSON.stringify(body) }), ctx)
const get = (qs: string) => GET(new Request(`http://x/r?${qs}`), ctx)
const NARRATIVE = { text: '[[Aces]] won.', source: 'ai', lang: 'en' }

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'u1' } })
  m.role.mockResolvedValue('commissioner')
  m.access.mockResolvedValue({ isMember: true })
  m.entitled.mockResolvedValue(true)
  m.upgrade.mockResolvedValue('/commissioner-upgrade')
  m.generate.mockResolvedValue({ ok: true, narrative: NARRATIVE, cached: false, factGuardErrors: [] })
  m.readCached.mockResolvedValue(null)
})

describe('POST — write the recap', () => {
  it('signed out → 401, nothing generated', async () => {
    m.session.mockResolvedValue(null)
    expect((await post({ season: 2026 })).status).toBe(401)
    expect(m.generate).not.toHaveBeenCalled()
  })

  it('a member who is not the commissioner → 403, nothing generated', async () => {
    m.role.mockResolvedValue('member')
    expect((await post({ season: 2026 })).status).toBe(403)
    expect(m.generate).not.toHaveBeenCalled()
  })

  it('a commissioner without AF Commissioner → 402 with the upgrade path, nothing generated', async () => {
    m.entitled.mockResolvedValue(false)
    const res = await post({ season: 2026 })
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ error: 'not_entitled', upgradePath: '/commissioner-upgrade' })
    expect(m.generate).not.toHaveBeenCalled()
  })

  it('a bad season costs nothing', async () => {
    expect((await post({ season: 'soon' })).status).toBe(400)
    expect(m.entitled).not.toHaveBeenCalled()
  })

  it('a co-commissioner with the plan writes it', async () => {
    m.role.mockResolvedValue('co_commissioner')
    const res = await post({ season: 2026, lang: 'es', regenerate: true })
    expect(res.status).toBe(200)
    expect(m.generate).toHaveBeenCalledWith({ leagueId: 'l1', season: 2026, userId: 'u1', lang: 'es', regenerate: true })
    expect(await res.json()).toMatchObject({ narrative: NARRATIVE })
  })

  it('the daily cap answers 429', async () => {
    m.generate.mockResolvedValue({ ok: false, reason: 'daily_cap', message: 'cap hit', resetsAt: '2027-01-02T00:00:00.000Z', limit: 5 })
    const res = await post({ season: 2026 })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'daily_cap', limit: 5 })
  })
})

describe('GET — read the recap', () => {
  it('a non-member → 403', async () => {
    m.access.mockResolvedValue(null)
    expect((await get('season=2026')).status).toBe(403)
  })

  it('a member reads the cached recap and may not write one; their plan is not even looked up', async () => {
    m.role.mockResolvedValue('member')
    m.readCached.mockResolvedValue(NARRATIVE)
    const body = await (await get('season=2026&lang=en')).json()
    expect(body).toMatchObject({ narrative: NARRATIVE, isCommissioner: false, canGenerate: false, upgradePath: null })
    expect(m.entitled).not.toHaveBeenCalled()
  })

  it('a commissioner without the plan gets the upsell path', async () => {
    m.entitled.mockResolvedValue(false)
    const body = await (await get('season=2026')).json()
    expect(body).toMatchObject({ isCommissioner: true, canGenerate: false, upgradePath: '/commissioner-upgrade' })
  })

  it('a commissioner with the plan may write', async () => {
    const body = await (await get('season=2026')).json()
    expect(body).toMatchObject({ canGenerate: true })
  })
})
