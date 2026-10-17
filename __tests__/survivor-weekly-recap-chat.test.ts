import { expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorChatChannel: { findFirst: vi.fn(async () => ({ id: 'league-channel' })) },
  survivorChatMessage: { create: vi.fn(), upsert: vi.fn() },
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
})
