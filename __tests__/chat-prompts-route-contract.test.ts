import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolvePlatformUserMock = vi.fn()
const dispatchNotificationMock = vi.fn()
const getLeagueMemberUserIdsMock = vi.fn()
const createLeagueChatMessageMock = vi.fn()
const tryDeterministicAnswerMock = vi.fn()

const prismaMock = {
  leagueChatMessage: { findFirst: vi.fn() },
  bracketLeagueMember: { findUnique: vi.fn(), findMany: vi.fn() },
  platformChatThreadMember: { findMany: vi.fn() },
  appUser: { findUnique: vi.fn(), findMany: vi.fn() },
}

vi.mock('@/lib/platform/current-user', () => ({
  resolvePlatformUser: resolvePlatformUserMock,
}))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: dispatchNotificationMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/league-chat/leagueMemberIds', () => ({
  getLeagueMemberUserIds: getLeagueMemberUserIdsMock,
}))

vi.mock('@/lib/chat-core', () => ({
  isLeagueVirtualRoom: (threadId: string) => threadId.startsWith('league:'),
  getLeagueIdFromVirtualRoom: (threadId: string) => threadId.replace(/^league:/, ''),
  getMessageQueryOptions: () => ({}),
  parseCursor: () => null,
}))

vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThreadMessage: vi.fn(),
  createSystemMessage: vi.fn(),
  getPlatformThreadMessages: vi.fn(),
}))

vi.mock('@/lib/chat-core/league-message-proxy', () => ({
  bracketMessagesToPlatform: vi.fn(),
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => null),
}))

vi.mock('@/lib/survivor/constants', () => ({
  parseTribeIdFromSource: vi.fn(() => null),
}))

vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({
  getTribeChatMemberRosterIds: vi.fn(async () => []),
}))

vi.mock('@/lib/survivor/SurvivorOfficialCommandService', () => ({
  processSurvivorOfficialCommand: vi.fn(async () => ({ handled: false })),
}))

vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({
  resolveSurvivorCurrentWeek: vi.fn(async () => 1),
}))

vi.mock('@/lib/survivor/SurvivorMergeEngine', () => ({
  isMergeTriggered: vi.fn(async () => false),
}))

vi.mock('@/lib/moderation', () => ({
  getBlockedUserIds: vi.fn(async () => []),
  filterMessagesByBlocked: vi.fn((messages: unknown[]) => messages),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelState: vi.fn(async () => null),
}))

vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  getLeagueChatMessages: vi.fn(async () => []),
  createLeagueChatMessage: createLeagueChatMessageMock,
}))

vi.mock('@/lib/ai/deterministic', () => ({
  DETERMINISTIC_SOURCE: 'deterministic',
  tryDeterministicAnswer: tryDeterministicAnswerMock,
}))

describe('chat prompt contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolvePlatformUserMock.mockResolvedValue({ appUserId: 'u1' })
    prismaMock.leagueChatMessage.findFirst.mockResolvedValue({ id: 'm1' })
    prismaMock.appUser.findUnique.mockResolvedValue({ displayName: 'Sender', username: 'sender' })
    prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u2' }])
    prismaMock.bracketLeagueMember.findUnique.mockResolvedValue(null)
    prismaMock.bracketLeagueMember.findMany.mockResolvedValue([])
    prismaMock.platformChatThreadMember.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u3' },
      { userId: 'u4' },
    ])
    getLeagueMemberUserIdsMock.mockResolvedValue(['u1', 'u3', 'u4'])
    createLeagueChatMessageMock.mockImplementation(async (_leagueId, _userId, body) => ({
      id: `created-${createLeagueChatMessageMock.mock.calls.length}`,
      body,
      threadId: 'league:l1',
    }))
    tryDeterministicAnswerMock.mockResolvedValue('Cached Chimmy answer')
  })

  it('@username and @all fan-out while skipping @global and @chimmy control tokens', async () => {
    const { POST } = await import('../app/api/shared/chat/mentions/route')

    const req = new Request('http://localhost/api/shared/chat/mentions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'league:l1',
        messageId: 'm1',
        mentionedUsernames: ['alice', 'all', 'global', 'chimmy'],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'ok' })

    expect(dispatchNotificationMock).toHaveBeenCalledTimes(1)
    const payload = dispatchNotificationMock.mock.calls[0][0] as { userIds: string[] }
    expect(payload.userIds.sort()).toEqual(['u2', 'u3', 'u4'])
  })

  it('@chimmy in shared thread POST is routed to private chimmy prompt message', async () => {
    const { POST } = await import('../app/api/shared/chat/threads/[threadId]/messages/route')

    const req = new Request('http://localhost/api/shared/chat/threads/league:l1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '@chimmy help me set lineup' }),
    })

    const res = await POST(req as any, { params: { threadId: 'league:l1' } } as any)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json?.commandResult?.intent).toBe('chimmy_prompt')
    expect(json?.aiReply?.body).toBe('Cached Chimmy answer')
    expect(createLeagueChatMessageMock).toHaveBeenCalledWith(
      'l1',
      'u1',
      'help me set lineup',
      expect.objectContaining({
        isPrivate: true,
        visibleToUserId: 'u1',
        messageSubtype: 'chimmy_prompt',
      })
    )
    expect(createLeagueChatMessageMock).toHaveBeenCalledWith(
      'l1',
      'u1',
      'Cached Chimmy answer',
      expect.objectContaining({
        isPrivate: true,
        visibleToUserId: 'u1',
        messageSubtype: 'chimmy_private_response',
      })
    )
  })

  it('@global remains a broadcast control token (not direct mention target)', async () => {
    const { POST } = await import('../app/api/shared/chat/mentions/route')

    const req = new Request('http://localhost/api/shared/chat/mentions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'league:l1',
        messageId: 'm1',
        mentionedUsernames: ['global'],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'ok', notified: 0 })
    expect(dispatchNotificationMock).not.toHaveBeenCalled()
  })

  async function postToLeagueRoom(body: string) {
    const { POST } = await import('../app/api/shared/chat/threads/[threadId]/messages/route')
    const req = new Request('http://localhost/api/shared/chat/threads/league:l1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    return POST(req as any, { params: { threadId: 'league:l1' } } as any)
  }

  it('keeps a Survivor ballot typed in league chat private to the voter', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: true,
      status: 200,
      intent: 'vote',
      message: 'Vote recorded for Team Alpha.',
    })

    const res = await postToLeagueRoom('vote Team Alpha')
    expect(res.status).toBe(200)
    expect(createLeagueChatMessageMock).toHaveBeenCalledTimes(1)
    expect(createLeagueChatMessageMock).toHaveBeenCalledWith(
      'l1',
      'u1',
      'vote Team Alpha',
      expect.objectContaining({ isPrivate: true, visibleToUserId: 'u1', messageSubtype: 'survivor_private_ballot' })
    )
  })

  it('keeps a Survivor jury ballot typed in league chat private to the juror', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: true,
      status: 200,
      intent: 'jury_vote',
      message: 'Final jury vote recorded for Team Beta.',
    })

    const res = await postToLeagueRoom('jury vote Team Beta')
    expect(res.status).toBe(200)
    expect(createLeagueChatMessageMock).toHaveBeenCalledWith(
      'l1',
      'u1',
      'jury vote Team Beta',
      expect.objectContaining({ isPrivate: true, visibleToUserId: 'u1' })
    )
  })

  it('leaves a non-ballot Survivor command and an ordinary message public', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: true,
      status: 200,
      intent: 'challenge_pick',
      message: 'Challenge submission recorded for trivia.',
    })

    expect((await postToLeagueRoom('submit challenge left')).status).toBe(200)
    expect((await postToLeagueRoom('good luck everyone')).status).toBe(200)
    expect(createLeagueChatMessageMock).toHaveBeenCalledTimes(2)
    for (const call of createLeagueChatMessageMock.mock.calls) {
      const options = call[3] as { isPrivate?: boolean; visibleToUserId?: string }
      expect(options.isPrivate).toBeUndefined()
      expect(options.visibleToUserId).toBeUndefined()
    }
  })

  it('does not post a ballot the command service rejected', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: false,
      status: 400,
      error: 'No tribal council open for voting',
    })

    const res = await postToLeagueRoom('vote Team Alpha')
    expect(res.status).toBe(400)
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  // The command service's own help text tells players to type "@Chimmy vote [manager]". Every
  // @chimmy message used to take the private answer path, so that ballot was never recorded.
  it('records "@Chimmy vote X" through the Survivor command service, privately', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: true,
      status: 200,
      intent: 'vote',
      message: 'Vote recorded for Team Alpha.',
    })

    const res = await postToLeagueRoom('@Chimmy vote Team Alpha')
    expect(res.status).toBe(200)
    expect(survivor.processSurvivorOfficialCommand).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'l1', userId: 'u1', command: '@Chimmy vote Team Alpha' })
    )
    expect(tryDeterministicAnswerMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json?.commandResult).toMatchObject({ ok: true, intent: 'vote', message: 'Vote recorded for Team Alpha.' })
    expect(createLeagueChatMessageMock).toHaveBeenCalledTimes(1)
    expect(createLeagueChatMessageMock).toHaveBeenCalledWith(
      'l1',
      'u1',
      '@Chimmy vote Team Alpha',
      expect.objectContaining({ isPrivate: true, visibleToUserId: 'u1', messageSubtype: 'survivor_private_ballot' })
    )
  })

  it('returns the command error for a rejected "@Chimmy vote X" and posts nothing', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    vi.mocked(survivor.processSurvivorOfficialCommand).mockResolvedValueOnce({
      handled: true,
      ok: false,
      status: 400,
      error: 'No tribal council open for voting',
    })

    const res = await postToLeagueRoom('@chimmy vote Team Alpha')
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'No tribal council open for voting' })
    expect(tryDeterministicAnswerMock).not.toHaveBeenCalled()
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  it('keeps an @chimmy question that only mentions voting on the private answer path', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')

    const res = await postToLeagueRoom('@chimmy how do I vote this week')
    expect(res.status).toBe(200)
    expect(survivor.processSurvivorOfficialCommand).not.toHaveBeenCalled()
    expect(tryDeterministicAnswerMock).toHaveBeenCalled()
    expect((await res.json())?.commandResult?.intent).toBe('chimmy_prompt')
  })

  it('keeps "@chimmy immunity rules" private: the command service has no immunity handler', async () => {
    // The parser reads this as immunity_choice, which processSurvivorOfficialCommand does not implement
    // ("Command not implemented for this context"). Routing it would turn a question into a 400.
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')

    const res = await postToLeagueRoom('@chimmy immunity rules')
    expect(res.status).toBe(200)
    expect(survivor.processSurvivorOfficialCommand).not.toHaveBeenCalled()
    expect((await res.json())?.commandResult?.intent).toBe('chimmy_prompt')
  })

  it('falls back to the private answer when "@Chimmy vote X" is not a Survivor command in this league', async () => {
    const survivor = await import('@/lib/survivor/SurvivorOfficialCommandService')
    // Default mock: { handled: false }, which is what a non-Survivor league returns.

    const res = await postToLeagueRoom('@Chimmy vote Team Alpha')
    expect(res.status).toBe(200)
    expect(survivor.processSurvivorOfficialCommand).toHaveBeenCalledTimes(1)
    expect((await res.json())?.commandResult?.intent).toBe('chimmy_prompt')
    for (const call of createLeagueChatMessageMock.mock.calls) {
      const options = call[3] as { isPrivate?: boolean; visibleToUserId?: string }
      expect(options.isPrivate).toBe(true)
      expect(options.visibleToUserId).toBe('u1')
    }
  })
})
