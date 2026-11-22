import { describe, expect, it, vi } from 'vitest'

/**
 * A Survivor share card posted to league chat (the week recap, or a card a member shares) carries its
 * picture: the league-chat mirror adds it as an image attachment, which RichMessage draws inline.
 */
import { mirrorSurvivorChatMessageToLeagueChat } from '@/lib/survivor/survivorChatBridge'
import { readSafeAttachments } from '@/components/core-app/comms/RichMessage'

function db() {
  const created: Array<Record<string, unknown>> = []
  return {
    created,
    db: {
      league: { findUnique: vi.fn(async () => ({ userId: 'owner' })) },
      survivorChatChannel: { findUnique: vi.fn(async () => null) },
      leagueChatMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: String(data.id) } }) },
    },
  }
}

const base = { leagueId: 'L1', channelId: 'ch', channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'card', content: 'Week 5 recap · Maya is voted out.' }

describe('share cards in league chat', () => {
  it('a share card carries its picture as an image attachment the chat can draw', async () => {
    const { db: fake, created } = db()
    await mirrorSurvivorChatMessageToLeagueChat(fake as never, { ...base, id: 'm1', cardData: { type: 'share_card', momentId: 'mo-9', momentType: 'recap' } } as never)
    const metadata = created[0].metadata as Record<string, unknown>
    expect(metadata.attachments).toEqual([{ type: 'image', url: '/api/share/survivor/mo-9?f=post', mimeType: 'image/png' }])
    expect(readSafeAttachments(metadata as never).map(a => a.url)).toEqual(['/api/share/survivor/mo-9?f=post'])
  })

  it('CONTROL: an ordinary host announcement gets no picture', async () => {
    const { db: fake, created } = db()
    await mirrorSurvivorChatMessageToLeagueChat(fake as never, { ...base, id: 'm2', contentType: 'host_announcement' } as never)
    expect((created[0].metadata as Record<string, unknown>).attachments).toBeUndefined()
  })
})
