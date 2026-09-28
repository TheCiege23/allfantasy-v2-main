// @vitest-environment node
/**
 * `postChimmyMoment` — the one way Chimmy speaks up in a league's chat on its own.
 *
 * Prisma is replaced by an in-memory store with the two properties the helper relies on: a
 * `SportsDataCache` primary key that refuses a duplicate insert (`createMany({ skipDuplicates })`
 * counts only rows it really wrote), and a league chat table that records who authored each row.
 * The REAL LeagueChatMessageService maps the rows back out, so "shows as Chimmy" is measured on the
 * same code every reader uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CacheRow = { data: unknown; expiresAt: Date }

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  rows: [] as Array<Record<string, unknown>>,
  league: { id: 'L1', userId: 'commish', settings: null as unknown },
  createFail: null as Error | null,
  relay: vi.fn(async () => ({ synced: true })),
}))

function matches(key: string, where: Record<string, unknown>, row: CacheRow): boolean {
  const k = where.cacheKey as unknown
  const keyOk =
    typeof k === 'string' ? k === key : k && typeof k === 'object' && Array.isArray((k as { in?: string[] }).in)
      ? (k as { in: string[] }).in.includes(key)
      : true
  const exp = where.expiresAt as { lte?: Date; gt?: Date } | undefined
  const expOk = !exp || ((!exp.lte || row.expiresAt <= exp.lte) && (!exp.gt || row.expiresAt > exp.gt))
  return Boolean(keyOk) && expOk
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === h.league.id ? { ...h.league } : null)),
    },
    sportsDataCache: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0
        for (const [key, row] of [...h.cache.entries()]) {
          if (matches(key, where, row)) {
            h.cache.delete(key)
            count += 1
          }
        }
        return { count }
      }),
      createMany: vi.fn(async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        let count = 0
        for (const r of data) {
          if (h.cache.has(r.cacheKey)) continue
          h.cache.set(r.cacheKey, { data: r.data, expiresAt: r.expiresAt })
          count += 1
        }
        return { count }
      }),
    },
    leagueChatMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (h.createFail) throw h.createFail
        const row = {
          id: `m${h.rows.length + 1}`,
          ...data,
          createdAt: new Date(Date.UTC(2026, 8, 25, 12, h.rows.length)),
          user: { id: data.userId, username: 'pat', displayName: 'Pat Commissioner', avatarUrl: 'https://cdn.example/pat.png', profile: null },
        }
        h.rows.push(row)
        return row
      }),
      findMany: vi.fn(async () => [...h.rows].reverse()),
    },
  },
}))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: h.relay }))

import { CHIMMY_DAILY_CAP, chimmyDayKey, postChimmyMoment } from '@/lib/league-chat/chimmyMoments'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

/** A Friday afternoon in US Eastern. */
const NOW = new Date('2026-09-25T18:00:00.000Z')
const trade = (n: number, now = NOW) =>
  postChimmyMoment({ leagueId: 'L1', kind: 'trade', dedupeKey: `native:t${n}`, text: `Trade ${n}: Alex wins it by 1,240.`, now })

beforeEach(() => {
  h.cache.clear()
  h.rows = []
  h.league = { id: 'L1', userId: 'commish', settings: null }
  h.createFail = null
  h.relay.mockClear()
})

describe('identity', () => {
  it('posts under the league owner underneath, and every reader sees Chimmy', async () => {
    const out = await trade(1)
    expect(out).toEqual({ posted: true, messageId: 'm1' })

    const row = h.rows[0]!
    expect(row.userId).toBe('commish')
    expect(row.metadata).toMatchObject({ chimmy: true, isSystem: true, chimmyMoment: { v: 1, kind: 'trade' } })

    // The commissioner reading their own league: Chimmy's name, no sender id, no commissioner avatar.
    const [read] = await getLeagueChatMessages('L1', { requestingUserId: 'commish' })
    expect(read).toMatchObject({ senderName: 'Chimmy', senderUserId: null, senderAvatarUrl: null, senderUsername: null })
    expect(JSON.stringify(read)).not.toContain('Pat Commissioner')
  })

  it('a card cannot override the identity', async () => {
    await postChimmyMoment({
      leagueId: 'L1',
      kind: 'trade',
      dedupeKey: 'native:x',
      text: 'take',
      card: { chimmy: false, chimmyMoment: { kind: 'upset' }, discordAuthorName: 'Pat', tradeCard: { manager: 'Alex' } },
      now: NOW,
    })
    const meta = h.rows[0]!.metadata as Record<string, unknown>
    expect(meta.chimmy).toBe(true)
    expect(meta.chimmyMoment).toEqual({ v: 1, kind: 'trade' })
    expect(meta).not.toHaveProperty('discordAuthorName')
    expect(meta.tradeCard).toEqual({ manager: 'Alex' })
  })

  it('relays to Discord as Chimmy', async () => {
    await trade(1)
    await vi.waitFor(() => expect(h.relay).toHaveBeenCalledTimes(1))
    expect(h.relay).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', messageId: 'm1', authorName: 'Chimmy' }))
  })
})

describe('dedupe', () => {
  it('posts one moment once', async () => {
    expect((await trade(1)).posted).toBe(true)
    expect(await trade(1)).toEqual({ posted: false, reason: 'duplicate' })
    expect(h.rows).toHaveLength(1)
  })

  it('🛑 holds under concurrency — the claim is the insert, not a read then a write', async () => {
    const results = await Promise.all([trade(1), trade(1), trade(1)])
    expect(results.filter((r) => r.posted)).toHaveLength(1)
    expect(h.rows).toHaveLength(1)
  })

  it('the same key in another league, or for another kind, is a different moment', async () => {
    h.league = { id: 'L1', userId: 'commish', settings: null }
    await trade(1)
    const other = await postChimmyMoment({ leagueId: 'L1', kind: 'upset', dedupeKey: 'native:t1', text: 'Upset!', now: NOW })
    expect(other.posted).toBe(true)
  })
})

describe(`the daily cap (${CHIMMY_DAILY_CAP} a day)`, () => {
  it('lets four moments through and refuses the fifth', async () => {
    for (let i = 1; i <= CHIMMY_DAILY_CAP; i++) expect((await trade(i)).posted).toBe(true)
    expect(await trade(99)).toEqual({ posted: false, reason: 'daily_cap' })
    expect(h.rows).toHaveLength(CHIMMY_DAILY_CAP)
  })

  it('resets on the next US-Eastern day, and a capped moment is spent, not queued', async () => {
    for (let i = 1; i <= CHIMMY_DAILY_CAP + 1; i++) await trade(i)
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    expect((await trade(100, tomorrow)).posted).toBe(true)
    // The one refused yesterday does not surface today as stale news.
    expect(await trade(CHIMMY_DAILY_CAP + 1, tomorrow)).toEqual({ posted: false, reason: 'duplicate' })
  })

  it('counts the day in US Eastern, not UTC', () => {
    // 03:30 UTC Saturday is still Friday evening in New York.
    expect(chimmyDayKey(new Date('2026-09-26T03:30:00.000Z'))).toBe('2026-09-25')
    expect(chimmyDayKey(new Date('2026-09-26T04:30:00.000Z'))).toBe('2026-09-26')
  })

  it('weekly awards bypass the cap and do not spend a slot', async () => {
    for (let i = 1; i <= CHIMMY_DAILY_CAP; i++) await trade(i)
    const awards = await postChimmyMoment({ leagueId: 'L1', kind: 'weekly_awards', dedupeKey: '2026:3', text: 'Week 3 recap', now: NOW })
    expect(awards.posted).toBe(true)
    expect([...h.cache.keys()].filter((k) => k.startsWith('chimmy-moment-slot:'))).toHaveLength(CHIMMY_DAILY_CAP)
  })
})

describe('the league switch', () => {
  it('is ON when the commissioner never touched it', async () => {
    h.league = { id: 'L1', userId: 'commish', settings: { commissionerRecipes: {} } }
    expect((await trade(1)).posted).toBe(true)
  })

  it('OFF silences every moment — awards included — and claims nothing', async () => {
    h.league = { id: 'L1', userId: 'commish', settings: { chimmySpeaksUp: false } }
    expect(await trade(1)).toEqual({ posted: false, reason: 'disabled' })
    expect(
      await postChimmyMoment({ leagueId: 'L1', kind: 'weekly_awards', dedupeKey: '2026:3', text: 'recap', now: NOW }),
    ).toEqual({ posted: false, reason: 'disabled' })
    expect(h.rows).toHaveLength(0)
    expect(h.cache.size).toBe(0)
  })
})

describe('never fails the caller', () => {
  it('a failed insert returns, releases its claims so a retry can land, and logs no ids', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.createFail = Object.assign(new Error('connection reset for league L1 by commish'), { name: 'PrismaClientKnownRequestError' })
    await expect(trade(1)).resolves.toEqual({ posted: false, reason: 'error' })
    expect(h.cache.size).toBe(0)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('L1')
    expect(logged).not.toContain('commish')
    expect(logged).toContain('PrismaClientKnownRequestError')

    h.createFail = null
    expect((await trade(1)).posted).toBe(true)
    warn.mockRestore()
  })

  it('refuses nonsense without touching the store', async () => {
    const bad = await postChimmyMoment({ leagueId: 'L1', kind: 'gossip' as never, dedupeKey: 'k', text: 'hi', now: NOW })
    expect(bad).toEqual({ posted: false, reason: 'invalid' })
    expect(await postChimmyMoment({ leagueId: 'L1', kind: 'trade', dedupeKey: 'k', text: '   ', now: NOW })).toEqual({
      posted: false,
      reason: 'invalid',
    })
    expect(await postChimmyMoment({ leagueId: 'nope', kind: 'trade', dedupeKey: 'k', text: 'hi', now: NOW })).toEqual({
      posted: false,
      reason: 'no_league',
    })
    expect(h.cache.size).toBe(0)
  })
})
