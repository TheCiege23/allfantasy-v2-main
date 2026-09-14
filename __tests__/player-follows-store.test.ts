// @vitest-environment node
/**
 * `lib/follows/playerFollows` — the one reader/writer of `player_follows` (user decisions,
 * 2026-09-14). The migration is parked, so the store must treat a missing table as
 * "unavailable", never as "follows nobody", and must key on the Sleeper id first.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const $queryRaw = vi.fn()
const $executeRaw = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => $queryRaw(...a),
    $executeRaw: (...a: unknown[]) => $executeRaw(...a),
  },
}))

import {
  MAX_PLAYER_FOLLOWS,
  followKeyFor,
  followPlayer,
  isFollowingPlayer,
  listPlayerFollows,
  unfollowPlayer,
} from '@/lib/follows/playerFollows'

/** What Prisma raises for a raw query against a table that does not exist. */
const MISSING_TABLE = Object.assign(new Error('relation "player_follows" does not exist'), {
  code: 'P2010',
  meta: { code: '42P01' },
})

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?')
const valuesOf = (call: unknown[]) => call.slice(1)

const GIBBS = { sport: 'nfl', externalId: 'ri:771', sleeperId: '9221', name: ' Jahmyr Gibbs ', position: 'RB', team: 'DET' }

beforeEach(() => {
  $queryRaw.mockReset()
  $executeRaw.mockReset()
})

describe('followKeyFor', () => {
  it('🛑 prefers the Sleeper id, falls back to the externalId', () => {
    expect(followKeyFor({ sleeperId: '9221', externalId: 'ri:771' })).toBe('9221')
    expect(followKeyFor({ sleeperId: null, externalId: 'ri:771' })).toBe('ri:771')
    expect(followKeyFor({ sleeperId: '  ', externalId: null })).toBeNull()
  })
})

describe('missing table', () => {
  it('🛑 reads say UNAVAILABLE (null), not "follows nobody"', async () => {
    $queryRaw.mockRejectedValue(MISSING_TABLE)
    expect(await listPlayerFollows('u1')).toBeNull()
    expect(await isFollowingPlayer('u1', 'NFL', '9221')).toBeNull()
  })

  it('🛑 writes report unavailable instead of pretending to save', async () => {
    $queryRaw.mockRejectedValue(MISSING_TABLE)
    expect(await followPlayer('u1', GIBBS)).toBe('unavailable')
    $executeRaw.mockRejectedValue(MISSING_TABLE)
    expect(await unfollowPlayer('u1', 'NFL', '9221')).toBe('unavailable')
  })

  it('any OTHER database error still propagates', async () => {
    $queryRaw.mockRejectedValue(Object.assign(new Error('connection reset'), { code: 'P1017' }))
    await expect(listPlayerFollows('u1')).rejects.toThrow('connection reset')
  })
})

describe('followPlayer', () => {
  it('upserts under the Sleeper key, sport upper-cased, name trimmed, scoped to the user', async () => {
    $queryRaw.mockResolvedValue([{ n: 3, mine: false }])
    $executeRaw.mockResolvedValue(1)
    expect(await followPlayer('u1', GIBBS)).toBe('followed')

    const call = $executeRaw.mock.calls[0]
    expect(sqlOf(call)).toMatch(/INSERT INTO "player_follows"/)
    expect(sqlOf(call)).toMatch(/ON CONFLICT \("user_id", "sport", "player_key"\) DO UPDATE/)
    const values = valuesOf(call)
    expect(values.slice(1)).toEqual(['u1', 'NFL', '9221', 'ri:771', '9221', 'Jahmyr Gibbs', 'RB', 'DET'])
  })

  it(`🛑 refuses a NEW follow at ${MAX_PLAYER_FOLLOWS}`, async () => {
    $queryRaw.mockResolvedValue([{ n: MAX_PLAYER_FOLLOWS, mine: false }])
    expect(await followPlayer('u1', GIBBS)).toBe('limit')
    expect($executeRaw).not.toHaveBeenCalled()
  })

  it('re-following a player you already follow is never blocked by the limit', async () => {
    $queryRaw.mockResolvedValue([{ n: MAX_PLAYER_FOLLOWS, mine: true }])
    $executeRaw.mockResolvedValue(1)
    expect(await followPlayer('u1', GIBBS)).toBe('followed')
  })

  it('a player with no key or no name is invalid and touches nothing', async () => {
    expect(await followPlayer('u1', { ...GIBBS, sleeperId: null, externalId: null })).toBe('invalid')
    expect(await followPlayer('u1', { ...GIBBS, name: '  ' })).toBe('invalid')
    expect($queryRaw).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('lists newest first for this user only, mapped to camelCase', async () => {
    const at = new Date('2026-09-14T12:00:00Z')
    $queryRaw.mockResolvedValue([
      { sport: 'NFL', player_key: '9221', external_id: 'ri:771', sleeper_id: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', created_at: at },
    ])
    const out = await listPlayerFollows('u1')
    expect(out).toEqual([
      { sport: 'NFL', playerKey: '9221', externalId: 'ri:771', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', createdAt: at },
    ])
    const call = $queryRaw.mock.calls[0]
    expect(sqlOf(call)).toMatch(/WHERE "user_id" = \?/)
    expect(sqlOf(call)).toMatch(/ORDER BY "created_at" DESC/)
    expect(valuesOf(call)[0]).toBe('u1')
  })

  it('isFollowingPlayer is true only when a row comes back', async () => {
    $queryRaw.mockResolvedValueOnce([{ one: 1 }]).mockResolvedValueOnce([])
    expect(await isFollowingPlayer('u1', 'nfl', '9221')).toBe(true)
    expect(await isFollowingPlayer('u1', 'nfl', '9221')).toBe(false)
    expect(valuesOf($queryRaw.mock.calls[0])).toEqual(['u1', 'NFL', '9221'])
  })

  it('unfollow deletes by user + sport + key', async () => {
    $executeRaw.mockResolvedValue(1)
    expect(await unfollowPlayer('u1', 'nfl', '9221')).toBe('unfollowed')
    const call = $executeRaw.mock.calls[0]
    expect(sqlOf(call)).toMatch(/DELETE FROM "player_follows"/)
    expect(valuesOf(call)).toEqual(['u1', 'NFL', '9221'])
  })
})
