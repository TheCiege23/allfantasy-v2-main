// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), audit: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/prisma', () => ({ prisma: { survivorAuditEntry: { findMany: h.audit } } }))

import { GET } from '@/app/api/survivor/episodes/route'

const get = (q = '?leagueId=L1') => GET({ nextUrl: new URL(`https://example.test/api/survivor/episodes${q}`) } as never)
const episode = { week: 3, title: 'The Tribe Has Spoken', scenes: [{ label: 'Tribal Council', text: 'Ben was voted out.' }] }

describe('GET /api/survivor/episodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.session.mockResolvedValue({ user: { id: 'u1' } })
    h.access.mockResolvedValue({ role: 'member' })
    h.audit.mockResolvedValue([{ week: 3, data: { posted: true, episode } }, { week: 2, data: { posted: true } }])
  })

  it('returns the stored episodes, skipping weeks recapped before episodes existed', async () => {
    const res = await get()
    expect(await res.json()).toEqual({ episodes: [episode] })
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', action: 'weekly_recap_posted', isVisibleToPublic: true } }))
  })

  it('is members only', async () => {
    h.access.mockResolvedValue(null)
    expect((await get()).status).toBe(403)
    h.session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(h.audit).not.toHaveBeenCalled()
  })
})
