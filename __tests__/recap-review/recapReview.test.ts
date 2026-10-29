import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_POST_MIN_AGE_MS, cleanRecapText, newDraft, readRecapReview, shouldAutoPost } from '@/lib/recap-review/recapReview'

const state = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; createdAt: Date; expiresAt: Date }>(),
  settings: {} as Record<string, unknown>,
  posts: [] as Array<{ kind: string; text: string }>,
  postResult: { posted: true } as { posted: boolean; reason?: string },
  notifies: [] as Array<{ userIds: string[]; title: string }>,
  memberPushes: [] as unknown[][],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      createMany: vi.fn(async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        const [row] = data
        if (state.cache.has(row.cacheKey)) return { count: 0 }
        state.cache.set(row.cacheKey, { data: row.data, createdAt: new Date(), expiresAt: row.expiresAt })
        return { count: 1 }
      }),
      update: vi.fn(async ({ where, data }: { where: { cacheKey: string }; data: { data: unknown } }) => {
        state.cache.get(where.cacheKey)!.data = data.data
      }),
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
        const r = state.cache.get(where.cacheKey)
        return r ? { cacheKey: where.cacheKey, data: r.data } : null
      }),
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { startsWith: string } } }) =>
        [...state.cache.entries()].filter(([k]) => k.startsWith(where.cacheKey.startsWith)).map(([, v]) => ({ data: v.data })),
      ),
    },
    league: { findUnique: vi.fn(async () => ({ userId: 'owner', settings: state.settings })) },
    leagueTeam: { findMany: vi.fn(async () => [{ claimedByUserId: 'co' }]) },
  },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: vi.fn(async (p: { userIds: string[]; title: string }) => state.notifies.push({ userIds: p.userIds, title: p.title })),
}))
vi.mock('@/lib/league-chat/weeklyRecapMoment', () => ({
  postWeeklyRecapAsChimmy: vi.fn(async (p: { text: string }) => (state.posts.push({ kind: 'sleeper', text: p.text }), state.postResult)),
}))
vi.mock('@/lib/league-chat/nativeWeeklyRecap', () => ({
  postNativeRecapText: vi.fn(async (p: { text: string }) => (state.posts.push({ kind: 'native', text: p.text }), state.postResult)),
}))
vi.mock('@/lib/league-chat/weeklyRecapNotify', () => ({ notifyWeeklyRecaps: vi.fn(async (posted: unknown[]) => state.memberPushes.push(posted)) }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://allfantasy.ai' }))

import { discardRecapDraft, holdRecapDraft, postRecapDraft, postUntouchedRecapDrafts, readPendingDraft, saveRecapEdit } from '@/lib/recap-review/recapReviewService'

const TUE = new Date('2026-10-20T14:00:00Z')
const WED = new Date('2026-10-21T08:40:00Z')
const base = { leagueId: 'L1', leagueName: 'Dynasty Bros', ownerUserId: 'owner', sleeperLeagueId: 'S1', season: '2026', week: 7, generatedText: 'Week 7 recap' }

beforeEach(() => {
  state.cache.clear()
  state.settings = { weekly_recap_review: { mode: 'review', autoPostIfUntouched: true } }
  state.posts = []
  state.postResult = { posted: true }
  state.notifies = []
  state.memberPushes = []
})

describe('pure rules', () => {
  it('defaults to auto — every league keeps today’s behaviour', () => {
    expect(readRecapReview({})).toEqual({ mode: 'auto', autoPostIfUntouched: true })
  })
  it('an empty edit is refused', () => {
    expect(cleanRecapText('  \r\n ')).toBeNull()
    expect(cleanRecapText(' hi\r\nthere ')).toBe('hi\nthere')
  })
  it('auto-posts only untouched drafts at least 12 h old, in review mode with the option on', () => {
    const d = newDraft(base, TUE)
    const review = { mode: 'review' as const, autoPostIfUntouched: true }
    expect(shouldAutoPost(d, review, new Date(TUE.getTime() + AUTO_POST_MIN_AGE_MS - 1))).toBe(false)
    expect(shouldAutoPost(d, review, WED)).toBe(true)
    expect(shouldAutoPost({ ...d, editedText: 'x' }, review, WED)).toBe(false)
    expect(shouldAutoPost(d, { ...review, autoPostIfUntouched: false }, WED)).toBe(false)
    expect(shouldAutoPost(d, { mode: 'auto', autoPostIfUntouched: true }, WED)).toBe(false)
  })
})

describe('holding and posting', () => {
  it('holds once per week, tells the commissioners once, and never overwrites the draft', async () => {
    expect(await holdRecapDraft(base, TUE)).toBe('held')
    await saveRecapEdit('L1', '2026', 7, 'Edited recap', 'owner')
    expect(await holdRecapDraft({ ...base, generatedText: 'regenerated' }, TUE)).toBe('exists')
    expect(state.notifies).toEqual([{ userIds: ['owner', 'co'], title: 'Week 7 recap is ready for you' }])
    expect((await readPendingDraft('L1'))?.editedText).toBe('Edited recap')
  })

  it('posts the commissioner’s edit through the Sleeper path, then tells members', async () => {
    await holdRecapDraft(base, TUE)
    expect(await postRecapDraft('L1', '2026', 7, { text: 'Final words', actorUserId: 'owner' })).toEqual({ ok: true })
    expect(state.posts).toEqual([{ kind: 'sleeper', text: 'Final words' }])
    expect(state.memberPushes).toHaveLength(1)
    expect(await readPendingDraft('L1')).toBeNull()
    expect(await postRecapDraft('L1', '2026', 7, { actorUserId: 'owner' })).toEqual({ ok: false, error: 'not_pending' })
  })

  it('native leagues post through the native path', async () => {
    await holdRecapDraft({ ...base, sleeperLeagueId: null }, TUE)
    await postRecapDraft('L1', '2026', 7, { actorUserId: 'owner' })
    expect(state.posts).toEqual([{ kind: 'native', text: 'Week 7 recap' }])
  })

  it('a week already in chat closes the draft instead of posting twice', async () => {
    await holdRecapDraft(base, TUE)
    state.postResult = { posted: false, reason: 'duplicate' }
    expect(await postRecapDraft('L1', '2026', 7, { actorUserId: 'owner' })).toEqual({ ok: false, error: 'already_posted' })
    expect(await readPendingDraft('L1')).toBeNull()
    expect(state.memberPushes).toEqual([])
  })

  it('Chimmy switched off keeps the draft — and the edit — for later', async () => {
    await holdRecapDraft(base, TUE)
    state.postResult = { posted: false, reason: 'disabled' }
    expect(await postRecapDraft('L1', '2026', 7, { text: 'Keep me', actorUserId: 'owner' })).toEqual({ ok: false, error: 'chimmy_quiet' })
    expect((await readPendingDraft('L1'))?.editedText).toBe('Keep me')
  })

  it('a discarded week never posts, not even on Wednesday morning', async () => {
    await holdRecapDraft(base, TUE)
    expect(await discardRecapDraft('L1', '2026', 7, 'owner')).toBe(true)
    expect(await postUntouchedRecapDrafts(WED)).toEqual({ checked: 0, posted: 0, failed: 0 })
    expect(state.posts).toEqual([])
  })
})

describe('Wednesday morning', () => {
  it('posts an untouched draft and leaves an edited one for the commissioner', async () => {
    await holdRecapDraft(base, TUE)
    await holdRecapDraft({ ...base, leagueId: 'L2' }, TUE)
    await saveRecapEdit('L2', '2026', 7, 'half done', 'owner')
    expect(await postUntouchedRecapDrafts(WED)).toEqual({ checked: 2, posted: 1, failed: 0 })
    expect(state.posts).toEqual([{ kind: 'sleeper', text: 'Week 7 recap' }])
  })

  it('does nothing for a league that turned the option off', async () => {
    state.settings = { weekly_recap_review: { mode: 'review', autoPostIfUntouched: false } }
    await holdRecapDraft(base, TUE)
    expect((await postUntouchedRecapDrafts(WED)).posted).toBe(0)
  })
})
