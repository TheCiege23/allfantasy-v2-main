import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolvePlatformUser: vi.fn(),
  createPlatformThread: vi.fn(),
  getPlatformChatThreads: vi.fn(),
  resolveConversationSafetyForUser: vi.fn(),
  appUserFindMany: vi.fn(),
}))

vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: mocks.resolvePlatformUser }))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThread: mocks.createPlatformThread,
  getPlatformChatThreads: mocks.getPlatformChatThreads,
}))
vi.mock('@/lib/moderation', () => ({
  resolveConversationSafetyForUser: mocks.resolveConversationSafetyForUser,
}))
vi.mock('@/lib/prisma', () => ({ prisma: { appUser: { findMany: mocks.appUserFindMany } } }))

function req(body: unknown) {
  return { json: async () => body } as never
}

describe('POST /api/shared/chat/threads — direct messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePlatformUser.mockResolvedValue({ appUserId: 'me' })
    mocks.createPlatformThread.mockResolvedValue({ id: 't1', threadType: 'dm' })
    mocks.appUserFindMany.mockResolvedValue([{ id: 'them' }])
  })

  /*
   * The change this covers: `createPlatformThread` takes member USER IDS, and a
   * UI that lets you start a conversation only ever has a username. Group
   * already resolved them; dm did not, so "message this person" was unreachable
   * from any surface without a people-picker handing over a uuid.
   */
  it('resolves a username into a member id for a dm', async () => {
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'dm', usernames: ['rival'] }))

    expect(res.status).toBe(200)
    expect(mocks.appUserFindMany).toHaveBeenCalled()
    expect(mocks.createPlatformThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadType: 'dm', memberUserIds: ['them'] }),
    )
  })

  it('says which username failed rather than failing generically', async () => {
    mocks.appUserFindMany.mockResolvedValue([])
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'dm', usernames: ['ghost'] }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no valid participants/i)
    expect(mocks.createPlatformThread).not.toHaveBeenCalled()
  })

  /*
   * createPlatformThread returns null for any member count other than two, which
   * would surface as a bare "Unable to create thread". Say what is wrong instead.
   */
  it('explains that a dm is one-to-one when given several people', async () => {
    mocks.appUserFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'dm', usernames: ['a', 'b'] }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/one-to-one/i)
    expect(mocks.createPlatformThread).not.toHaveBeenCalled()
  })

  it('still requires somebody to message', async () => {
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'dm' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/needs one other person/i)
  })

  it('leaves group creation working as before', async () => {
    mocks.appUserFindMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    mocks.createPlatformThread.mockResolvedValue({ id: 't2', threadType: 'group' })

    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'group', usernames: ['a', 'b'], title: 'Huddle' }))

    expect(res.status).toBe(200)
    expect(mocks.createPlatformThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadType: 'group', memberUserIds: ['a', 'b'] }),
    )
  })

  it('rejects an unsupported thread type', async () => {
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'league' }))
    expect(res.status).toBe(400)
  })

  it('refuses an anonymous caller', async () => {
    mocks.resolvePlatformUser.mockResolvedValue({ appUserId: null })
    const { POST } = await import('@/app/api/shared/chat/threads/route')
    const res = await POST(req({ threadType: 'dm', usernames: ['rival'] }))
    expect(res.status).toBe(401)
  })
})
