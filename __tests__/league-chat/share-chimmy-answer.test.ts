/**
 * "Share with league" for a private @chimmy answer (2026-11-16, owner's decision): answers stay private
 * by default; the asker can post one publicly, once, and a Survivor vote or power can never be shared.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  msg: vi.fn(),
  msgUpdate: vi.fn(async () => ({})),
  user: vi.fn(async () => ({ displayName: 'Sam', username: 'sam_k' })),
  league: vi.fn(async () => ({ userId: 'owner' })),
  claimCreate: vi.fn(async () => ({})),
  claimFind: vi.fn(),
  claimUpdate: vi.fn(async () => ({})),
  claimDelete: vi.fn(async () => ({})),
  access: vi.fn(async () => ({ role: 'member' })),
  post: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueChatMessage: { findUnique: h.msg, update: h.msgUpdate },
    appUser: { findUnique: h.user },
    league: { findUnique: h.league },
    sportsDataCache: { create: h.claimCreate, findUnique: h.claimFind, update: h.claimUpdate, delete: h.claimDelete },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: h.post }))

import { questionForLeague, shareChimmyAnswer, sharedAnswerBody } from '@/lib/league-chat/shareChimmyAnswer'

const REPLY = {
  id: 'r1',
  leagueId: 'L1',
  message: 'Start Puka Nacua over Drake London this week.',
  isPrivate: true,
  visibleToUserId: 'u1',
  messageSubtype: 'chimmy_private',
  metadata: { isSystem: true, chimmyPrivateReply: true, chimmyShareable: true, questionMessageId: 'q1' },
}
const QUESTION = { message: '@chimmy who should I start, Puka or London?', leagueId: 'L1', visibleToUserId: 'u1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.msg.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === 'r1' ? { ...REPLY } : where.id === 'q1' ? { ...QUESTION } : null))
  h.access.mockResolvedValue({ role: 'member' })
  h.claimCreate.mockResolvedValue({})
  h.post.mockResolvedValue({ id: 'pub1', senderUserId: null, senderName: 'Chimmy', body: 'x', createdAt: '2026-11-16T20:00:00Z', messageType: 'system', metadata: {} })
})

const share = (over: Partial<{ userId: string; messageId: string; leagueId: string }> = {}) =>
  shareChimmyAnswer({ leagueId: 'L1', userId: 'u1', messageId: 'r1', ...over })

describe('shareChimmyAnswer', () => {
  it('posts the question and the answer publicly, credited to the asker, as Chimmy', async () => {
    const r = await share()
    expect(r).toMatchObject({ ok: true, alreadyShared: false, sharedMessageId: 'pub1' })
    expect(h.post).toHaveBeenCalledWith(
      'L1',
      'owner',
      'Sam asked Chimmy: "who should I start, Puka or London?"\n\nStart Puka Nacua over Drake London this week.',
      { type: 'system', metadata: { isSystem: true, chimmy: true, sharedChimmyAnswer: { askedByUserId: 'u1', askedByName: 'Sam', sourceMessageId: 'r1' } } },
    )
    // The public row is NOT private, and the private bubble learns it was shared.
    expect((h.post.mock.calls[0] as unknown[])[3]).not.toHaveProperty('isPrivate')
    expect(h.msgUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { metadata: expect.objectContaining({ sharedMessageId: 'pub1' }) } })
  })

  it("🛑 never shares someone else's answer, and does not say whether it exists", async () => {
    const r = await share({ userId: 'u2' })
    expect(r).toEqual({ ok: false, status: 404, error: 'That answer could not be found.' })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('🛑 never shares an answer that was not marked shareable (a Survivor vote, a power, an old answer)', async () => {
    h.msg.mockImplementation(async () => ({ ...REPLY, metadata: { isSystem: true, chimmyPrivateReply: true } }))
    const r = await share()
    expect(r).toEqual({ ok: false, status: 409, error: 'This answer is private to you and cannot be shared.' })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('refuses a public row, a non-Chimmy row, another league, and a member who left', async () => {
    h.msg.mockImplementationOnce(async () => ({ ...REPLY, isPrivate: false }))
    expect((await share()).ok).toBe(false)
    h.msg.mockImplementationOnce(async () => ({ ...REPLY, metadata: { chimmyShareable: true, questionMessageId: 'q1' } }))
    expect((await share()).ok).toBe(false)
    expect((await share({ leagueId: 'L2' })).ok).toBe(false)
    h.access.mockResolvedValueOnce(null)
    expect(await share()).toEqual({ ok: false, status: 403, error: 'You are no longer in this league.' })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('posts once: a second tap gets the first share back, not a second post', async () => {
    h.claimCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    h.claimFind.mockResolvedValue({ data: { status: 'shared', sharedMessageId: 'pub1' } })
    expect(await share()).toEqual({ ok: true, alreadyShared: true, message: null, sharedMessageId: 'pub1' })
    expect(h.post).not.toHaveBeenCalled()
  })

  it("does not post a question that is not the asker's own private row", async () => {
    h.msg.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'r1' ? { ...REPLY } : { ...QUESTION, visibleToUserId: 'u2', userId: 'u2', message: '@chimmy secret' },
    )
    await share()
    expect((h.post.mock.calls[0] as unknown[])[2]).toBe('Sam shared a Chimmy answer:\n\nStart Puka Nacua over Drake London this week.')
  })

  it('a failed post releases the claim so the user can try again', async () => {
    h.post.mockResolvedValue(null)
    expect((await share()).ok).toBe(false)
    expect(h.claimDelete).toHaveBeenCalledWith({ where: { cacheKey: 'chimmy-share:r1' } })
  })
})

describe('the shared text', () => {
  it('drops the @chimmy prefix, flattens, and caps the question', () => {
    expect(questionForLeague('  @Chimmy,   who\n starts?  ')).toBe('who starts?')
    expect(questionForLeague(`@chimmy ${'x'.repeat(400)}`)).toHaveLength(280)
    expect(sharedAnswerBody('Sam', '@chimmy', 'Answer.')).toBe('Sam shared a Chimmy answer:\n\nAnswer.')
  })
})

describe('wiring', () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8')
  it('the chat route marks only a general answer shareable, and links its question', () => {
    const route = read('app/api/league/chat/route.ts')
    expect(route).toMatch(/const shareable = !sgReply && !voteResult\?\.handled && !survivorAsk && Boolean\(replyText\?\.trim\(\)\)/)
    expect(route).toMatch(/\.\.\.\(shareable \? \{ chimmyShareable: true, questionMessageId: privateUserMsg\.id \} : \{\}\)/)
  })
  it('league chat offers the button on the league channel only, and both chat views use the one component', () => {
    const conv = read('components/core-app/comms/LeagueConversation.tsx')
    expect(conv).toMatch(/onShareChimmyAnswer=\{\s*tribe\s*\?\s*undefined/)
    expect(read('components/core-app/comms/ChatMessageList.tsx')).toMatch(/onShareChimmyAnswer && !m\.pending && isShareableChimmyAnswer\(m\.metadata\)/)
    expect(read('app/dashboard/components/LeagueChatInPanel.tsx')).toMatch(/isShareableChimmyAnswer\(meta\) \?/)
  })
})
