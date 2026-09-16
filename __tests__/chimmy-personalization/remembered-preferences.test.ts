import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Chimmy item 6 — what Chimmy remembers from conversation, and the user's control over it.
 *
 * The storage existed and fed the prompt; nobody could see it, correct it, or make Chimmy forget
 * it. These pin the three operations the settings screen needs, the access rule on league names,
 * and the merge bug the screen made visible.
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  deleteMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  leagueFindMany: vi.fn(),
  resolveLeagueAccess: vi.fn(),
  recordQuality: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiMemory: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      deleteMany: h.deleteMany,
      create: h.create,
      update: h.update,
    },
    league: { findMany: h.leagueFindMany },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.resolveLeagueAccess }))
vi.mock('@/lib/chimmy-quality/ChimmyQualityAnalytics', () => ({ recordChimmyQualityEvent: h.recordQuality }))

import {
  forgetRememberedPreferences,
  listRememberedPreferences,
  mergeCoachingProfiles,
  setRememberedTeamDirection,
} from '@/lib/chimmy-personalization/remembered'
import { rememberChimmyUserMessageMemory } from '@/lib/ai-memory/ai-memory-store'

const at = new Date('2026-09-16T12:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueFindMany.mockResolvedValue([])
  h.resolveLeagueAccess.mockResolvedValue(null)
  h.create.mockResolvedValue({ id: 'new' })
  h.update.mockResolvedValue({ id: 'existing' })
  h.recordQuality.mockResolvedValue(undefined)
})

describe('listing what Chimmy remembers', () => {
  it('names only leagues the user can access, and drops the rest entirely', async () => {
    h.findMany.mockResolvedValue([
      { leagueId: 'mine', value: { teamArchetype: 'rebuilder', riskStyle: 'aggressive' }, updatedAt: at },
      { leagueId: 'strangers', value: { teamArchetype: 'contender' }, updatedAt: at },
      { leagueId: null, value: { detailLevel: 'concise' }, updatedAt: at },
    ])
    h.resolveLeagueAccess.mockImplementation(async (leagueId: string) => (leagueId === 'mine' ? { isMember: true } : null))
    h.leagueFindMany.mockResolvedValue([{ id: 'mine', name: 'Dynasty Degens' }])

    const list = await listRememberedPreferences('u1')

    expect(list.map((r) => r.leagueId)).toEqual([null, 'mine'])
    expect(list[1]).toMatchObject({
      leagueName: 'Dynasty Degens',
      teamDirection: 'rebuilder',
      learned: { riskStyle: 'aggressive' },
    })
    expect(list[0]).toMatchObject({ leagueName: null, teamDirection: null, learned: { detailLevel: 'concise' } })
    /*
     * 🛑 THE NAME LOOKUP NEVER ASKS FOR THE STRANGER'S LEAGUE. Asking and then filtering would
     * still be one refactor away from printing it.
     */
    expect(h.leagueFindMany.mock.calls[0][0].where.id.in).toEqual(['mine'])
  })

  it('scopes the read to this user and this profile', async () => {
    h.findMany.mockResolvedValue([])
    await listRememberedPreferences('u1')
    expect(h.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', scope: 'user_preferences', key: 'coaching_profile' })
  })

  it('omits a row holding nothing the screen can show', async () => {
    h.findMany.mockResolvedValue([{ leagueId: null, value: { updatedAt: 'x', aliases: {} }, updatedAt: at }])
    expect(await listRememberedPreferences('u1')).toEqual([])
  })
})

describe('setting a team direction', () => {
  it('refuses a league the user cannot access, and writes nothing', async () => {
    h.resolveLeagueAccess.mockResolvedValue(null)
    expect(await setRememberedTeamDirection('u1', 'strangers', 'rebuilder')).toBe('forbidden')
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('keeps every other remembered flag', async () => {
    h.resolveLeagueAccess.mockResolvedValue({ isMember: true })
    h.findFirst.mockResolvedValue({ id: 'row-1', value: { riskStyle: 'aggressive', scoringPreference: 'ppr' } })

    expect(await setRememberedTeamDirection('u1', 'mine', 'rebuilder')).toBe('ok')

    const written = h.update.mock.calls[0][0].data.value
    expect(written).toMatchObject({ riskStyle: 'aggressive', scoringPreference: 'ppr', teamArchetype: 'rebuilder' })
  })

  it('clears only the direction', async () => {
    h.resolveLeagueAccess.mockResolvedValue({ isMember: true })
    h.findFirst.mockResolvedValue({ id: 'row-1', value: { riskStyle: 'aggressive', teamArchetype: 'contender' } })

    await setRememberedTeamDirection('u1', 'mine', null)

    const written = h.update.mock.calls[0][0].data.value
    expect(written).not.toHaveProperty('teamArchetype')
    expect(written).toMatchObject({ riskStyle: 'aggressive' })
  })

  it('needs no league check for "all leagues"', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await setRememberedTeamDirection('u1', null, 'contender')).toBe('ok')
    expect(h.resolveLeagueAccess).not.toHaveBeenCalled()
    expect(h.create.mock.calls[0][0].data).toMatchObject({ userId: 'u1', leagueId: null, key: 'coaching_profile' })
  })
})

describe('forgetting', () => {
  it('deletes only this user\'s profile and its mirror for that league', async () => {
    h.deleteMany.mockResolvedValue({ count: 2 })
    await forgetRememberedPreferences('u1', 'mine')
    expect(h.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        leagueId: 'mine',
        OR: [
          { scope: 'user_preferences', key: 'coaching_profile' },
          { scope: 'chimmy_strategy_profile', key: 'snapshot' },
        ],
      },
    })
  })
})

describe('the chat route\'s view of it', () => {
  it('overlays the league profile on the all-leagues one', () => {
    expect(
      mergeCoachingProfiles({ detailLevel: 'concise', teamArchetype: 'contender' }, { teamArchetype: 'rebuilder' }),
    ).toEqual({ detailLevel: 'concise', teamArchetype: 'rebuilder' })
  })

  it('is null when neither says anything', () => {
    expect(mergeCoachingProfiles(null, [])).toBeNull()
  })
})

/*
 * 🛑 THE MERGE BUG. The conversational writer read the existing profile under `key: ''` and wrote
 * it under 'coaching_profile', so the read always missed and each declaration REPLACED the profile.
 */
describe('a new declaration adds to what Chimmy remembers', () => {
  it('reads the existing profile under the key it writes, and keeps the earlier direction', async () => {
    h.findFirst.mockImplementation(async ({ where }: { where: { scope: string; key: string } }) =>
      where.scope === 'user_preferences' && where.key === 'coaching_profile'
        ? { id: 'row-1', value: { teamArchetype: 'rebuilder' } }
        : null,
    )
    h.findMany.mockResolvedValue([])

    await rememberChimmyUserMessageMemory({ userId: 'u1', leagueId: null, sport: 'NFL', message: 'keep it concise please' })

    const prefWrite = h.update.mock.calls.find((c) => c[0].where.id === 'row-1')
    expect(prefWrite, 'the coaching profile was not updated in place').toBeTruthy()
    expect(prefWrite![0].data.value).toMatchObject({ teamArchetype: 'rebuilder', detailLevel: 'concise' })
  })
})
