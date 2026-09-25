import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from './helpers/createMockNextRequest'

/*
 * The draft room sends GIFs, photos, polls and replies in league chat's own metadata shape,
 * and its wire carries that metadata back — the missing half that made a league-chat GIF
 * arrive in the draft room as the words "🎬 GIF".
 */

const h = vi.hoisted(() => ({ created: [] as Array<{ body: string; opts: Record<string, unknown> }> }))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: async () => ({ liveDraftChatSyncEnabled: false }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: async () => ({ status: 'in_progress' }) } } }))
vi.mock('@/lib/draft-room/draftRoomChatWireLoad', () => ({ loadDraftChatWireMessages: vi.fn() }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: async (_leagueId: string, _userId: string, body: string, opts: Record<string, unknown>) => {
    h.created.push({ body, opts })
    return {
      id: `m-${h.created.length}`,
      threadId: 'league:l1',
      senderUserId: 'u1',
      senderName: 'Casey',
      senderAvatarUrl: null,
      body,
      createdAt: '2026-09-25T20:00:00.000Z',
      messageType: String(opts.type ?? 'text'),
      channelSource: (opts.source as string | null) ?? null,
      parentMessageId: (opts.parentMessageId as string | null) ?? null,
      metadata: (opts.metadata as Record<string, unknown> | undefined) ?? undefined,
    }
  },
}))

import { buildDraftChatWireMessage, sanitizeDraftChatRichMeta } from '@/lib/draft-room/draft-chat-contract'

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/leagues/[leagueId]/draft/chat/route')
  const res = await POST(
    createMockNextRequest('http://localhost/api/leagues/l1/draft/chat', { method: 'POST', body }) as never,
    { params: Promise.resolve({ leagueId: 'l1' }) },
  )
  return { status: res.status, data: (await res.json()) as { message?: Record<string, unknown>; error?: string } }
}

beforeEach(() => {
  h.created.length = 0
})

describe('sanitizeDraftChatRichMeta — client JSON that lands in every member’s chat', () => {
  it('keeps https GIFs and our own upload paths, drops everything else', () => {
    const out = sanitizeDraftChatRichMeta({
      gif: { url: 'https://media.giphy.com/a.gif', previewUrl: 'http://insecure.test/a.gif', title: 'win' },
      gifUrl: 'javascript:alert(1)',
      attachments: [
        { type: 'image', url: '/api/chat/upload?path=a.png', mimeType: 'image/png' },
        { type: 'image', url: '//evil.test/b.png' },
        { type: 'script', url: 'https://cdn.test/c.js' },
        { type: 'image', url: 'https://cdn.test/d.png' },
      ],
      isPrivate: true,
      reactions: [{ emoji: '🔥', userIds: ['someone-else'] }],
    })
    expect(out.gif).toEqual({ url: 'https://media.giphy.com/a.gif', previewUrl: 'https://media.giphy.com/a.gif', title: 'win' })
    expect(out.gifUrl).toBeUndefined()
    expect(out.attachments).toEqual([
      { type: 'image', url: '/api/chat/upload?path=a.png', mimeType: 'image/png' },
      { type: 'image', url: 'https://cdn.test/d.png' },
    ])
    expect(out).not.toHaveProperty('isPrivate')
    expect(out).not.toHaveProperty('reactions')
  })

  it('posts a poll with its votes emptied, and refuses one with fewer than two options', () => {
    const out = sanitizeDraftChatRichMeta({
      poll: { question: 'Trade up?', options: [{ id: 'y', text: 'Yes', votes: ['stuffed'] }, { id: 'n', text: 'No', votes: [] }], anonymous: true },
    })
    expect(out.poll).toEqual({
      question: 'Trade up?',
      options: [
        { id: 'y', text: 'Yes', votes: [] },
        { id: 'n', text: 'No', votes: [] },
      ],
      allowMultiple: false,
      anonymous: true,
    })
    expect(sanitizeDraftChatRichMeta({ poll: { question: 'Only one?', options: [{ text: 'Yes' }] } })).toEqual({})
  })

  it('caps photos at four', () => {
    const attachments = Array.from({ length: 6 }, (_, i) => ({ type: 'image', url: `/api/chat/upload?path=${i}.png` }))
    expect((sanitizeDraftChatRichMeta({ attachments }).attachments as unknown[]).length).toBe(4)
  })
})

describe('the draft chat wire carries what league chat renders', () => {
  const base = {
    id: 'm1',
    threadId: 'league:l1',
    senderUserId: 'u2',
    senderName: 'Jo',
    senderAvatarUrl: null,
    body: '🎬 GIF',
    createdAt: '2026-09-25T20:00:00.000Z',
    messageType: 'text',
    parentMessageId: 'm0',
    channelSource: null,
  }
  const opts = {
    syncActive: true,
    leagueId: 'l1',
    sanitizePlayerContext: () => null,
    parsePollPayload: () => null,
  }

  it('passes the metadata and the reply target through', () => {
    const gif = { url: 'https://static.klipy.com/a.gif', previewUrl: 'https://static.klipy.com/a.gif', title: 'lol' }
    const m = buildDraftChatWireMessage({ ...base, metadata: { gif } } as never, opts)
    expect(m.metadata).toMatchObject({ gif })
    expect(m.parentMessageId).toBe('m0')
  })

  it('redacts anonymous poll voters other than the viewer', () => {
    const poll = { question: 'Q', anonymous: true, options: [{ id: 'a', text: 'A', votes: ['u9', 'viewer'] }] }
    const m = buildDraftChatWireMessage({ ...base, metadata: { poll } } as never, { ...opts, viewerUserId: 'viewer' })
    const votes = ((m.metadata!.poll as { options: Array<{ votes: string[] }> }).options[0]!).votes
    expect(votes).toContain('viewer')
    expect(votes).not.toContain('u9')
  })
})

describe('POST /api/leagues/[id]/draft/chat', () => {
  it('stores a GIF-only message in league chat’s shape, as plain text rather than the old [GIF] path', async () => {
    const { status, data } = await post({
      text: '',
      metadata: { gif: { url: 'https://media.giphy.com/w.gif', previewUrl: 'https://media.giphy.com/w.gif', title: 'win' } },
    })
    expect(status).toBe(200)
    expect(h.created[0]!.body).toBe('🎬 GIF')
    expect(h.created[0]!.opts.type).toBe('text')
    expect((h.created[0]!.opts.metadata as Record<string, unknown>).gif).toMatchObject({ url: 'https://media.giphy.com/w.gif' })
    /* Sync off: the draft room's own channel — league chat shows it tagged while the draft is live. */
    expect(h.created[0]!.opts.source).toBe('draft')
    expect((data.message!.metadata as Record<string, unknown>).gif).toBeTruthy()
  })

  it('stores the reply target', async () => {
    await post({ text: 'bold', parentMessageId: 'm0' })
    expect(h.created[0]!.opts.parentMessageId).toBe('m0')
  })

  it('still reads the old `[GIF] <url>` text form', async () => {
    await post({ text: '[GIF] https://media.giphy.com/old.gif' })
    expect(h.created[0]!.opts.type).toBe('gif')
    expect((h.created[0]!.opts.metadata as Record<string, unknown>).mediaUrl).toBe('https://media.giphy.com/old.gif')
  })

  it('refuses an empty message with nothing rich attached', async () => {
    const { status } = await post({ text: '   ', metadata: { gifUrl: 'javascript:alert(1)' } })
    expect(status).toBe(400)
    expect(h.created).toHaveLength(0)
  })
})
