import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The DM and huddle list: a one-line preview, the other people's avatars, the time of the
 * previewed message, and an unread count — all from the ONE list query.
 *
 * 🛑 A PREVIEW MAY NEVER SAY MORE THAN THE THREAD. The thread hides a private row meant for somebody
 * else (a Chimmy reply, `visibleToUserId`), anything from a person the viewer blocked, a
 * moderator-hidden row, and a deleted row's words. The list is a second place those could leak.
 *
 * Prisma is replaced by a tiny in-memory evaluator of the `where` clauses the service sends, so
 * these tests fail if the filter is missing or wrong — not merely if a mock returns the wrong row.
 */

type Row = Record<string, any>

const db = vi.hoisted(() => ({
  users: [] as Row[],
  threads: [] as Row[],
  members: [] as Row[],
  messages: [] as Row[],
  blocks: [] as Row[],
  memberFindManyArgs: [] as any[],
  countCalls: 0,
}))

function matches(row: Row | null | undefined, where: any): boolean {
  if (!where) return true
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(cond as any[]).every((w) => matches(row, w))) return false
      continue
    }
    if (key === 'OR') {
      if (!(cond as any[]).some((w) => matches(row, w))) return false
      continue
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond]
      // SQL semantics: NOT (col = x) is not true when col is NULL.
      for (const w of list) {
        const [[f, v]] = Object.entries(w as object)
        if (row?.[f] == null) return false
        if (matches(row, { [f]: v })) return false
      }
      continue
    }
    if (key === 'sender') {
      const sender = row?.senderUserId ? db.users.find((u) => u.id === row.senderUserId) : null
      if (!sender) return false
      const rel = (cond as any).platformBlockedBy
      if (rel?.none) {
        const blockedBy = db.blocks.filter((b) => b.blockedUserId === sender.id)
        if (blockedBy.some((b) => matches(b, rel.none))) return false
      }
      continue
    }
    const value = row?.[key]
    if (cond === null) {
      if (value != null) return false
      continue
    }
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as any
      if ('in' in c && !c.in.includes(value)) return false
      if ('notIn' in c && (value == null || c.notIn.includes(value))) return false
      if ('gt' in c && !(value != null && new Date(value).getTime() > new Date(c.gt).getTime())) return false
      continue
    }
    if (value !== cond) return false
  }
  return true
}

function pick(row: Row, select: Record<string, any>): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k]
  }
  return out
}

function buildThread(thread: Row, include: any): Row {
  const out: Row = { ...thread }
  if (include._count) out._count = { members: db.members.filter((m) => m.threadId === thread.id).length }
  if (include.members) {
    out.members = db.members
      .filter((m) => m.threadId === thread.id)
      .map((m) => ({
        userId: m.userId,
        user: pick(db.users.find((u) => u.id === m.userId)!, include.members.select.user.select),
      }))
  }
  if (include.messages) {
    const spec = include.messages
    out.messages = db.messages
      .filter((m) => m.threadId === thread.id && matches(m, spec.where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, spec.take ?? Infinity)
      .map((m) => pick(m, spec.select))
  }
  return out
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: {
      findMany: vi.fn(async (args: any) => {
        db.memberFindManyArgs.push(args)
        return db.members
          .filter((m) => matches(m, args.where))
          .map((m) => ({ ...m, thread: buildThread(db.threads.find((t) => t.id === m.threadId)!, args.include.thread.include) }))
      }),
      findFirst: vi.fn(async (args: any) => {
        const m = db.members.find((x) => matches(x, args.where))
        if (!m) return null
        return { ...m, thread: buildThread(db.threads.find((t) => t.id === m.threadId)!, args.include.thread.include) }
      }),
    },
    platformChatMessage: {
      count: vi.fn(async (args: any) => {
        db.countCalls += 1
        return db.messages.filter((m) => matches(m, args.where)).length
      }),
    },
  },
}))

import { getPlatformChatThreads, getPlatformThreadById } from '@/lib/platform/chat-service'

const EMAIL = 'leak.me@example.test'
const at = (min: number) => new Date(Date.UTC(2026, 8, 25, 12, min))

let seq = 0
function message(threadId: string, senderUserId: string | null, body: string, min: number, over: Row = {}): Row {
  seq += 1
  return {
    id: `m${seq}`,
    threadId,
    senderUserId,
    body,
    messageType: 'text',
    metadata: null,
    isPrivate: false,
    visibleToUserId: null,
    createdAt: at(min),
    ...over,
  }
}

beforeEach(() => {
  seq = 0
  db.users = [
    { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null, email: EMAIL },
    { id: 'jo', username: 'jo', displayName: 'Jo Allen', avatarUrl: 'https://cdn.test/jo.png', email: EMAIL },
    { id: 'kai', username: 'kai', displayName: null, avatarUrl: null, email: EMAIL },
    { id: 'nameless', username: null, displayName: null, avatarUrl: null, email: EMAIL },
    { id: 'troll', username: 'troll', displayName: 'Troll', avatarUrl: null, email: EMAIL },
    { id: 'ben', username: 'ben', displayName: 'Ben', avatarUrl: null, email: EMAIL },
  ]
  db.threads = [
    { id: 'dm1', threadType: 'dm', productType: 'shared', title: null, lastMessageAt: at(30), createdByUserId: 'me' },
    { id: 'hud', threadType: 'group', productType: 'shared', title: 'Waiver wire', lastMessageAt: at(40), createdByUserId: 'me' },
  ]
  db.members = [
    { id: 'a', threadId: 'dm1', userId: 'me', isBlocked: false, isMuted: false, lastReadAt: at(0) },
    { id: 'b', threadId: 'dm1', userId: 'jo', isBlocked: false, isMuted: false, lastReadAt: null },
    { id: 'c', threadId: 'hud', userId: 'me', isBlocked: false, isMuted: false, lastReadAt: at(0) },
    { id: 'd', threadId: 'hud', userId: 'kai', isBlocked: false, isMuted: false, lastReadAt: null },
    { id: 'e', threadId: 'hud', userId: 'nameless', isBlocked: false, isMuted: false, lastReadAt: null },
    { id: 'f', threadId: 'hud', userId: 'troll', isBlocked: false, isMuted: false, lastReadAt: null },
    { id: 'g', threadId: 'hud', userId: 'ben', isBlocked: false, isMuted: false, lastReadAt: null },
  ]
  db.messages = []
  db.blocks = []
  db.memberFindManyArgs = []
  db.countCalls = 0
})

async function listById() {
  const threads = await getPlatformChatThreads('me')
  return Object.fromEntries(threads.map((t) => [t.id, t]))
}

describe('the preview respects what the viewer can read', () => {
  it('🛑 never previews a private message meant for somebody else', async () => {
    db.messages = [
      message('dm1', 'jo', 'you taking Bijan?', 10),
      message('dm1', null, 'SECRET chimmy note for jo only', 20, { isPrivate: true, visibleToUserId: 'jo' }),
    ]
    const { dm1 } = await listById()
    expect(dm1.context?.lastMessagePreview).toBe('you taking Bijan?')
    expect(JSON.stringify(dm1)).not.toContain('SECRET')
  })

  it('shows a private message that IS for the viewer', async () => {
    db.messages = [
      message('dm1', 'jo', 'older', 10),
      message('dm1', null, 'Chimmy: start Jo’s WR', 20, { isPrivate: true, visibleToUserId: 'me' }),
    ]
    const { dm1 } = await listById()
    expect(dm1.context?.lastMessagePreview).toBe('Chimmy: start Jo’s WR')
  })

  it('🛑 never previews a message from somebody the viewer blocked', async () => {
    db.blocks = [{ blockerUserId: 'me', blockedUserId: 'troll' }]
    db.messages = [
      message('hud', 'kai', 'claiming the kicker', 10),
      message('hud', 'troll', 'BLOCKED words', 30),
    ]
    const { hud } = await listById()
    expect(hud.context?.lastMessagePreview).toBe('claiming the kicker')
    expect(JSON.stringify(hud)).not.toContain('BLOCKED')
  })

  it('a block somebody ELSE made does not hide the message from the viewer', async () => {
    db.blocks = [{ blockerUserId: 'kai', blockedUserId: 'troll' }]
    db.messages = [message('hud', 'troll', 'visible to me', 30)]
    const { hud } = await listById()
    expect(hud.context?.lastMessagePreview).toBe('visible to me')
  })

  it('skips a moderator-hidden row and never shows a deleted row’s words', async () => {
    db.messages = [
      message('hud', 'kai', 'fine message', 10),
      message('hud', 'ben', 'DELETED words', 20, { metadata: { deletedAt: '2026-09-25T12:21:00Z' } }),
    ]
    let { hud } = await listById()
    expect(hud.context?.lastMessagePreview).toBe('Message deleted')
    expect(JSON.stringify(hud)).not.toContain('DELETED words')

    db.messages.push(message('hud', 'ben', 'MODHIDDEN words', 30, { metadata: { hiddenByMod: true } }))
    ;({ hud } = await listById())
    expect(hud.context?.lastMessagePreview).toBe('Message deleted')
    expect(JSON.stringify(hud)).not.toContain('MODHIDDEN')
  })

  it('the same rules hold for a single thread read', async () => {
    db.blocks = [{ blockerUserId: 'me', blockedUserId: 'troll' }]
    db.messages = [
      message('hud', 'kai', 'ok to show', 10),
      message('hud', 'troll', 'BLOCKED', 20),
      message('hud', null, 'PRIVATE', 25, { isPrivate: true, visibleToUserId: 'kai' }),
    ]
    const one = await getPlatformThreadById('me', 'hud')
    expect(one?.context?.lastMessagePreview).toBe('ok to show')
  })
})

describe('what the row needs', () => {
  it('flags your own last message so the row can say "You:"', async () => {
    db.messages = [message('dm1', 'jo', 'hey', 10), message('dm1', 'me', 'sup', 20)]
    const { dm1 } = await listById()
    expect(dm1.context?.lastMessageMine).toBe(true)
    expect(dm1.context?.lastMessagePreview).toBe('sup')
    expect(dm1.context?.lastMessageCreatedAt).toBe(at(20).toISOString())

    db.messages.push(message('dm1', 'jo', 'yo', 25))
    const again = await listById()
    expect(again.dm1.context?.lastMessageMine).toBe(false)
  })

  it('says Photo or GIF for media, whichever shape the row was written in', async () => {
    const cases: Array<[Row, string]> = [
      [{ messageType: 'image', body: 'https://cdn.test/a.jpg' }, 'Photo'],
      [{ body: '📎 Media', metadata: { attachments: [{ type: 'image', url: 'https://cdn.test/a.jpg' }] } }, 'Photo'],
      [{ messageType: 'gif', body: 'https://media.giphy.com/x.gif' }, 'GIF'],
      [{ body: '🎬 GIF', metadata: { gif: { url: 'https://static.klipy.com/a.gif' } } }, 'GIF'],
    ]
    for (const [over, label] of cases) {
      db.messages = [message('dm1', 'jo', 'x', 10, over)]
      const { dm1 } = await listById()
      expect(dm1.context?.lastMessagePreview, JSON.stringify(over)).toBe(label)
    }
  })

  it('carries up to three OTHER members with display name, then username, then "Manager" — and never email', async () => {
    db.messages = [message('hud', 'kai', 'hi', 10)]
    const { hud, dm1 } = await listById()
    expect(hud.context?.members).toEqual([
      { id: 'kai', name: 'kai', avatarUrl: null },
      { id: 'nameless', name: 'Manager', avatarUrl: null },
      { id: 'troll', name: 'Troll', avatarUrl: null },
    ])
    expect(dm1.context?.members).toEqual([{ id: 'jo', name: 'Jo Allen', avatarUrl: 'https://cdn.test/jo.png' }])
    expect(JSON.stringify([hud, dm1])).not.toContain(EMAIL)
    const userSelect = db.memberFindManyArgs[0].include.thread.include.members.select.user.select
    expect(userSelect).not.toHaveProperty('email')
    expect(userSelect).toHaveProperty('avatarUrl', true)
  })

  it('reads every row in ONE list query, whatever the thread count', async () => {
    db.messages = [message('dm1', 'jo', 'a', 10), message('hud', 'kai', 'b', 10)]
    await listById()
    expect(db.memberFindManyArgs).toHaveLength(1)
  })

  it('🛑 the unread count does not count what the viewer cannot read', async () => {
    db.blocks = [{ blockerUserId: 'me', blockedUserId: 'troll' }]
    db.messages = [
      message('hud', 'kai', 'one', 10),
      message('hud', 'troll', 'blocked', 11),
      message('hud', null, 'private', 12, { isPrivate: true, visibleToUserId: 'kai' }),
      message('hud', 'me', 'mine', 13),
    ]
    const { hud } = await listById()
    expect(hud.unreadCount).toBe(1)
  })
})
