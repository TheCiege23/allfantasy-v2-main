import { expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorChatChannel: { findFirst: vi.fn(async () => ({ id: 'league-channel' })) },
  survivorChatMessage: { create: vi.fn(), upsert: vi.fn() },
  // The chat bridge mirrors every engine post into league chat under the league owner's id.
  league: { findUnique: vi.fn(async () => ({ userId: 'owner-1' })) },
  leagueChatMessage: { create: vi.fn(async () => ({ id: 'mirrored' })) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

it('posts weekly recaps through a retry-safe message id', async () => {
  const { postWeeklyRecap } = await import('@/lib/survivor/leagueChatPoster')
  await postWeeklyRecap('league-1', 4, { topScorer: 'Manager', topScore: 180.5 })
  expect(db.survivorChatMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'survivor-weekly-recap:league-1:4' },
    create: expect.objectContaining({
      channelId: 'league-channel',
      content: expect.stringContaining('Top scorer: Manager'),
    }),
  }))
  expect(db.survivorChatMessage.create).not.toHaveBeenCalled()
  // Players read league chat, so the recap is mirrored there under a retry-safe id as Chimmy.
  expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      id: 'survivor-chat:survivor-weekly-recap:league-1:4',
      userId: 'owner-1',
      source: null,
      message: expect.stringContaining('Top scorer: Manager'),
      metadata: expect.objectContaining({ chimmy: true }),
    }),
  }))
})
