/**
 * Last words: who may write, when the window closes, what is refused, and what the league reads
 * (lib/guillotine/lastWordsStore.ts). The event log and the roster states are an in-memory stand-in here; the
 * rules they feed are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  states: [] as Array<{ rosterId: string; choppedAt: Date | null; choppedInPeriod: number | null }>,
  events: [] as Array<{ eventType: string; metadata: Record<string, unknown>; createdAt: Date }>,
  chat: [] as Array<{ userId: string; message: string; key?: string }>,
  clock: 0,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineRosterState: { findMany: vi.fn(async () => db.states.filter((s) => s.choppedAt != null)) },
    guillotineEventLog: {
      findMany: vi.fn(async ({ where }: { where: { eventType: string } }) => db.events.filter((e) => e.eventType === where.eventType)),
      create: vi.fn(async ({ data }: { data: { eventType: string; metadata: Record<string, unknown> } }) => {
        db.events.push({ eventType: data.eventType, metadata: data.metadata, createdAt: new Date(Date.UTC(2026, 9, 6, 12, 0, db.clock++)) })
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: vi.fn(async (_leagueId: string, userId: string, message: string, options: { idempotencyKey?: string }) => {
    // The key is the row id: a second post under it is refused, as the real table does.
    if (options.idempotencyKey && db.chat.some((c) => c.key === options.idempotencyKey)) return null
    db.chat.push({ userId, message, key: options.idempotencyKey })
    return {}
  }),
}))

import { loadLastWordsState, removeLastWords, saveLastWords } from '@/lib/guillotine/lastWordsStore'

const chop = (rosterId: string, week: number) => db.states.push({ rosterId, choppedAt: new Date(), choppedInPeriod: week })
const say = (rosterId: string | null, text: unknown, userId = `user-${rosterId}`) => saveLastWords({ leagueId: 'L', viewerRosterId: rosterId, userId, text })

beforeEach(() => {
  db.states.length = 0
  db.events.length = 0
  db.chat.length = 0
  db.clock = 0
})

describe('who may leave last words', () => {
  it('a manager whose team was chopped, and the league reads it', async () => {
    chop('a', 5)
    expect(await say('a', 'I regret nothing.')).toEqual({ ok: true })
    expect(await loadLastWordsState('L', 'b')).toEqual({ entries: [{ rosterId: 'a', week: 5, text: 'I regret nothing.' }], mine: null })
    expect((await loadLastWordsState('L', 'a'))?.mine).toEqual({ week: 5, text: 'I regret nothing.', window: 'open' })
  })

  it('not a team that is still alive, and not a viewer with no team', async () => {
    chop('a', 5)
    expect(await say('b', 'premature')).toMatchObject({ ok: false, status: 403, code: 'not_chopped' })
    expect(await say(null, 'who am I')).toMatchObject({ ok: false, status: 403, code: 'not_chopped' })
    expect(db.events).toHaveLength(0)
  })

  it('a chopped manager who has written nothing is offered the box', async () => {
    chop('a', 5)
    expect((await loadLastWordsState('L', 'a'))?.mine).toEqual({ week: 5, text: null, window: 'open' })
  })
})

describe('the window', () => {
  it('a rewrite replaces the message while no later team has been chopped', async () => {
    chop('a', 5)
    await say('a', 'frist draft')
    expect(await say('a', 'first draft')).toEqual({ ok: true })
    expect((await loadLastWordsState('L', null))?.entries).toEqual([{ rosterId: 'a', week: 5, text: 'first draft' }])
  })

  it('closes when the next team is chopped: the earlier message is history', async () => {
    chop('a', 5)
    await say('a', 'so long')
    chop('b', 6)
    expect(await say('a', 'one more thing')).toMatchObject({ ok: false, status: 409, code: 'closed' })
    const state = await loadLastWordsState('L', 'a')
    expect(state?.mine).toEqual({ week: 5, text: 'so long', window: 'closed' })
    // The newly chopped team can write, and its message lists first.
    expect(await say('b', 'my turn')).toEqual({ ok: true })
    expect((await loadLastWordsState('L', null))?.entries.map((e) => e.rosterId)).toEqual(['b', 'a'])
  })

  it('a chop the commissioner undoes takes its last words with it', async () => {
    chop('a', 5)
    await say('a', 'so long')
    db.states.length = 0 // the undo: nobody is chopped any more
    expect(await loadLastWordsState('L', 'a')).toEqual({ entries: [], mine: null })
    // Chopped again in a later week: the old message does not come back, and a new one can be written.
    chop('a', 7)
    expect((await loadLastWordsState('L', 'a'))?.mine).toEqual({ week: 7, text: null, window: 'open' })
    expect(await say('a', 'again?!')).toEqual({ ok: true })
    expect((await loadLastWordsState('L', null))?.entries).toEqual([{ rosterId: 'a', week: 7, text: 'again?!' }])
  })
})

describe('what is refused', () => {
  it.each([
    ['nothing', '   ', 'empty'],
    ['a link', 'visit www.example.com', 'has_link'],
    ['too much', 'a'.repeat(201), 'too_long'],
  ])('%s', async (_name, text, code) => {
    chop('a', 5)
    expect(await say('a', text)).toMatchObject({ ok: false, status: 400, code })
    expect(db.events).toHaveLength(0)
    expect(db.chat).toHaveLength(0)
  })

  it('a message the chat would mask, with a reason instead of a card of asterisks', async () => {
    chop('a', 5)
    const r = await say('a', 'this league is shit')
    expect(r).toEqual({ ok: false, status: 400, code: 'not_clean', error: 'Keep it clean: the whole league reads this.' })
    expect(db.events).toHaveLength(0)
  })
})

describe('the chat post', () => {
  it("goes out once, as the manager's own post; a rewrite does not post again", async () => {
    chop('a', 5)
    await say('a', 'frist draft', 'manager-a')
    await say('a', 'first draft', 'manager-a')
    expect(db.chat).toEqual([{ userId: 'manager-a', message: 'My last words: “frist draft”', key: 'guillotine-last-words:L:a:w5' }])
  })
})

describe('the commissioner taking one down', () => {
  it('removes it for everyone, and it cannot be written again', async () => {
    chop('a', 5)
    await say('a', 'something unkind about the commissioner')
    expect(await removeLastWords({ leagueId: 'L', rosterId: 'a', userId: 'commish' })).toEqual({ ok: true })
    expect(await loadLastWordsState('L', 'a')).toEqual({ entries: [], mine: { week: 5, text: null, window: 'removed' } })
    expect(await say('a', 'something worse')).toMatchObject({ ok: false, status: 403, code: 'removed' })
  })

  it('answers plainly when there is nothing to remove', async () => {
    chop('a', 5)
    expect(await removeLastWords({ leagueId: 'L', rosterId: 'a', userId: 'commish' })).toMatchObject({ ok: false, status: 404 })
    expect(await removeLastWords({ leagueId: 'L', rosterId: null, userId: 'commish' })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('reading never fails the page', () => {
  it('returns null when the tables cannot be read', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.guillotineRosterState.findMany).mockRejectedValueOnce(new Error('db down'))
    expect(await loadLastWordsState('L', 'a')).toBeNull()
  })
})
