import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canAccessLeagueDraft: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  draftIntroFindUnique: vi.fn(),
  draftIntroUpsert: vi.fn(),
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mocks.getServerSession(...args),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...args: unknown[]) => mocks.canAccessLeagueDraft(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findFirst: (...args: unknown[]) => mocks.draftSessionFindFirst(...args),
    },
    draftIntroView: {
      findUnique: (...args: unknown[]) => mocks.draftIntroFindUnique(...args),
      upsert: (...args: unknown[]) => mocks.draftIntroUpsert(...args),
    },
  },
}))

import { GET as getDraftIntroStatus } from '@/app/api/leagues/[leagueId]/draft/[draftId]/intro-status/route'
import { POST as postDraftIntroSeen } from '@/app/api/leagues/[leagueId]/draft/[draftId]/intro-seen/route'

describe('draft intro routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.canAccessLeagueDraft.mockResolvedValue(true)
    mocks.draftSessionFindFirst.mockResolvedValue({ id: 'draft-1', draftType: 'snake' })
    mocks.draftIntroFindUnique.mockResolvedValue(null)
    mocks.draftIntroUpsert.mockResolvedValue({ id: 'intro-1' })
  })

  it('returns unseen with draft type and video when no intro row exists', async () => {
    const res = await getDraftIntroStatus(
      new Request('http://localhost/api/leagues/league-1/draft/draft-1/intro-status'),
      {
        params: Promise.resolve({ leagueId: 'league-1', draftId: 'draft-1' }),
      },
    )

    expect(res.status).toBe(200)
    // The draft-start overlay serves the long intro cut; `Snake Draft.mp4` is the short
    // tile loop the create-league selector uses.
    await expect(res.json()).resolves.toEqual({
      seen: false,
      draftTypeKey: 'snake',
      videoUrl: '/media/create-league/drafts/videos/Snake Draft Intro.mp4',
      posterUrl: '/images/draft-types/snake-draft.png',
    })
    expect(mocks.draftIntroFindUnique).toHaveBeenCalledWith({
      where: { draftSessionId_userId: { draftSessionId: 'draft-1', userId: 'user-1' } },
      select: { id: true, seenAt: true, draftTypeKey: true, videoUrl: true },
    })
  })

  it('upserts seen row for draft session on POST', async () => {
    const res = await postDraftIntroSeen(
      new Request('http://localhost/api/leagues/league-1/draft/draft-1/intro-seen', { method: 'POST' }),
      {
        params: Promise.resolve({ leagueId: 'league-1', draftId: 'draft-1' }),
      },
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mocks.draftIntroUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.draftIntroUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { draftSessionId_userId: { draftSessionId: 'draft-1', userId: 'user-1' } },
      }),
    )
  })

  it('rejects requests from users without draft-room access', async () => {
    mocks.canAccessLeagueDraft.mockResolvedValue(false)

    const res = await getDraftIntroStatus(
      new Request('http://localhost/api/leagues/league-1/draft/draft-1/intro-status'),
      {
        params: Promise.resolve({ leagueId: 'league-1', draftId: 'draft-1' }),
      },
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
  })
})
