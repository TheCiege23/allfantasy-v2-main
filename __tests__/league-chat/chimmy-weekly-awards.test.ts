// @vitest-environment node
/**
 * The weekly recap posts AS CHIMMY, once per league per week, past the daily cap — and reads in
 * Chimmy's voice with the real numbers from the week.
 *
 * `postWeeklyRecapAsChimmy` runs against the REAL postChimmyMoment and the REAL
 * LeagueChatMessageService over an in-memory Prisma, so "posted as Chimmy" is what a reader sees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  rows: [] as Array<Record<string, unknown>>,
  settings: null as unknown,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ id: 'L1', userId: 'commish', settings: h.settings }) },
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) =>
        h.cache.has(where.cacheKey) ? { cacheKey: where.cacheKey, ...h.cache.get(where.cacheKey)! } : null,
      findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
        where.cacheKey.in.filter((k) => h.cache.has(k)).map((cacheKey) => ({ cacheKey })),
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Array<{ cacheKey: string; data: unknown; expiresAt: Date }> }) => {
        let count = 0
        for (const r of data) {
          if (h.cache.has(r.cacheKey)) continue
          h.cache.set(r.cacheKey, { data: r.data, expiresAt: r.expiresAt })
          count += 1
        }
        return { count }
      },
      upsert: async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown; expiresAt: Date } }) => {
        h.cache.set(where.cacheKey, { data: create.data, expiresAt: create.expiresAt })
        return {}
      },
    },
    leagueChatMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `m${h.rows.length + 1}`,
          ...data,
          createdAt: new Date('2026-09-22T14:00:00.000Z'),
          user: { id: data.userId, username: 'pat', displayName: 'Pat Commissioner', avatarUrl: null, profile: null },
        }
        h.rows.push(row)
        return row
      },
    },
  },
}))
vi.mock('@/lib/discord/sync-outbound', () => ({ syncOutboundLeagueChat: async () => ({ synced: false }) }))

import { buildWeeklyRecap, legacyRecapCacheKey, postWeeklyRecapAsChimmy, weeklyRecapAlreadyPosted } from '@/lib/league-chat/weeklyRecapMoment'
import { CHIMMY_DAILY_CAP, chimmyDayKey, chimmyMomentSlotCacheKey } from '@/lib/league-chat/chimmyMoments'

const NOW = new Date('2026-09-22T14:00:00.000Z')

const managers = [
  { ownerId: 'o1', name: 'Alex' },
  { ownerId: 'o2', name: 'Sam' },
  { ownerId: 'o3', name: 'Jordan' },
  { ownerId: 'o4', name: 'Riley' },
] as never

const awards = {
  season: '2026',
  week: 3,
  topScore: { ownerId: 'o1', points: 162.44, season: '2026', week: 3 },
  lowScore: { ownerId: 'o4', points: 71.2, season: '2026', week: 3 },
  narrowEscape: { winnerOwnerId: 'o2', loserOwnerId: 'o3', margin: 1.8, season: '2026', week: 3 },
  biggestBlowout: { winnerOwnerId: 'o1', loserOwnerId: 'o4', margin: 91.24, season: '2026', week: 3 },
}

const records = {
  highestWeek: { ownerId: 'o1', points: 162.44, season: '2026', week: 3 },
  lowestWeek: null,
  biggestBlowout: null,
  closestGame: null,
  longestWinStreak: null,
  longestLossStreak: null,
  bestSeasonAvg: null,
}

const recapText = () =>
  buildWeeklyRecap({
    leagueName: 'Iron Horse',
    sleeperLeagueId: 'sl-1',
    h2h: { managers, records } as never,
    awards: awards as never,
    rosters: [
      { roster_id: 1, owner_id: 'o1', settings: { wins: 3, losses: 0, fpts: 420 } },
      { roster_id: 2, owner_id: 'o2', settings: { wins: 2, losses: 1, fpts: 390 } },
      { roster_id: 3, owner_id: 'o3', settings: { wins: 1, losses: 2, fpts: 350 } },
      { roster_id: 4, owner_id: 'o4', settings: { wins: 0, losses: 3, fpts: 300 } },
    ],
    users: [
      { user_id: 'o1', display_name: 'Alex' },
      { user_id: 'o2', display_name: 'Sam' },
      { user_id: 'o3', display_name: 'Jordan' },
      { user_id: 'o4', display_name: 'Riley' },
    ],
    matchups: [
      { roster_id: 1, matchup_id: 1, points: 162.44 },
      { roster_id: 4, matchup_id: 1, points: 71.2 },
      { roster_id: 2, matchup_id: 2, points: 118.6 },
      { roster_id: 3, matchup_id: 2, points: 116.8 },
    ],
  })

beforeEach(() => {
  h.cache.clear()
  h.rows = []
  h.settings = null
})

describe('the weekly recap posts as Chimmy', () => {
  it('is authored by the league owner underneath and marked as Chimmy’s weekly awards', async () => {
    const out = await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: recapText(), now: NOW })
    expect(out).toEqual({ posted: true, messageId: 'm1' })
    const row = h.rows[0]!
    expect(row.userId).toBe('commish')
    expect(row.type).toBe('system')
    expect(row.metadata).toMatchObject({
      chimmy: true,
      chimmyMoment: { v: 1, kind: 'weekly_awards' },
      weeklyRecap: true,
      season: '2026',
      week: 3,
    })
  })

  it('posts once a week — and honours the pre-Chimmy dedupe key, which it also writes', async () => {
    await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: 'recap', now: NOW })
    expect(h.cache.has(legacyRecapCacheKey('sl-1', '2026', 3))).toBe(true)
    const again = await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: 'recap', now: NOW })
    expect(again.posted).toBe(false)
    expect(h.rows).toHaveLength(1)
    expect(await weeklyRecapAlreadyPosted({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3 })).toBe(true)
  })

  it('a week already recapped under the old identity is not posted again as Chimmy', async () => {
    h.cache.set(legacyRecapCacheKey('sl-1', '2026', 3), { data: {}, expiresAt: new Date(NOW.getTime() + 1e10) })
    const out = await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: 'recap', now: NOW })
    expect(out).toEqual({ posted: false, reason: 'already_posted_legacy' })
    expect(h.rows).toHaveLength(0)
  })

  it('bypasses a full day', async () => {
    const day = chimmyDayKey(NOW)
    for (let s = 1; s <= CHIMMY_DAILY_CAP; s++) {
      h.cache.set(chimmyMomentSlotCacheKey('L1', day, s), { data: {}, expiresAt: new Date(NOW.getTime() + 1e9) })
    }
    const out = await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: 'recap', now: NOW })
    expect(out.posted).toBe(true)
  })

  it('stays quiet when the commissioner switched Chimmy off', async () => {
    h.settings = { chimmySpeaksUp: false }
    const out = await postWeeklyRecapAsChimmy({ afLeagueId: 'L1', sleeperLeagueId: 'sl-1', season: '2026', week: 3, text: 'recap', now: NOW })
    expect(out).toEqual({ posted: false, reason: 'disabled' })
    // Nothing written, so switching back on this week still gets the recap out.
    expect(h.cache.has(legacyRecapCacheKey('sl-1', '2026', 3))).toBe(false)
  })
})

describe('the recap reads in Chimmy’s voice, with the week’s real numbers', () => {
  it('keeps every section and every counted number', () => {
    const text = recapText()
    expect(text).toContain('Week 3 recap — Iron Horse (2026)')
    expect(text).toContain('Alex 162.4 def. Riley 71.2')
    expect(text).toContain('Sam 118.6 def. Jordan 116.8')
    expect(text).toContain('1. Alex (3-0) · 2. Sam (2-1) · 3. Jordan (1-2)')
    expect(text).toContain('Boom of the week: Alex, 162.4')
    expect(text).toContain('Bust of the week: Riley, 71.2')
    expect(text).toContain('Narrow escape: Sam over Jordan by 1.8')
    expect(text).toContain('Hammer of the week: Alex over Riley by 91.2')
    expect(text).toContain('Alex set the all-time single-week high: 162.4')
  })

  it('is Chimmy talking: first person, the margin in the call, and nothing off-brand', () => {
    const text = recapText()
    expect(text).toContain('🎙 My call')
    expect(text).not.toContain('Chimmy’s call')
    // Both calls restate counted margins.
    expect(text).toMatch(/91\.2/)
    expect(text).toMatch(/1\.8/)
    expect(text).not.toMatch(/\b(leverage|synergy|disrupt|revolutionary|game-changing)\b/i)
    expect(text).not.toMatch(/\bAI\b/)
    // The old copy's jabs at the loser are gone.
    expect(text).not.toMatch(/restraining order|support group|abandoned|check on/i)
  })
})
