import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A ZOMBIE LEAGUE'S HOUSEKEEPING NEVER RAN. Bashing decisions past their window never defaulted,
 * scheduled announcements were never marked posted, animations were never marked delivered, and a
 * weekly update with a set day and hour never posted — their only caller, `/api/zombie/automation`,
 * is on no schedule. And the weekly update could not have posted anyway: it looked for a complete
 * resolution of `currentWeek`, which resolution now advances to the week it OPENS.
 */

/** Prisma double: every delegate method resolves to a harmless default unless overridden. */
const overrides = vi.hoisted(() => new Map<string, (...a: unknown[]) => unknown>())
const calls = vi.hoisted(() => [] as Array<{ key: string; args: unknown }>)
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async (args: unknown) => {
          const key = `${name}.${method}`
          calls.push({ key, args })
          const o = overrides.get(key)
          if (o) return o(args)
          if (method === 'findMany') return []
          if (method === 'count') return 0
          if (method === 'aggregate') return { _sum: {} }
          if (method.startsWith('update') || method.startsWith('create') || method === 'upsert') return { id: 'row', count: 1 }
          return null
        },
      },
    )
  return { prisma: new Proxy({}, { get: (_t, prop: string) => model(prop) }) }
})
vi.mock('@/lib/zombie/commissionerNotificationService', () => ({
  notifyCommissioner: vi.fn(async () => undefined),
  notifyZombiePlayer: vi.fn(async () => undefined),
}))

import { scheduleWeeklyUpdate } from '@/lib/zombie/weeklyUpdateEngine'
import { runZombieHousekeeping } from '@/lib/zombie/zombieAutomation'

// Thursday 2026-10-08 18:00 UTC — the league posts its update on Thursdays at 18:00.
const NOW = new Date('2026-10-08T18:05:00.000Z')
const zombie = {
  id: 'z1',
  leagueId: 'L1',
  universeId: null,
  commissionerId: 'commish',
  bannerUrl: null,
  // Resolution moved the league on to week 4; week 3 is the last one played.
  currentWeek: 4,
  weeklyUpdateDay: NOW.getUTCDay(),
  weeklyUpdateHour: NOW.getUTCHours(),
  weeklyUpdateAutoPost: true,
  weeklyUpdateApproval: false,
  // `buildWeeklyUpdate` reads the league with its teams included.
  teams: [],
}

const created = (key: string) => calls.filter((c) => c.key === key).map((c) => (c.args as { data: Record<string, unknown> }).data)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  overrides.clear()
  calls.length = 0
  overrides.set('zombieLeague.findUnique', async () => zombie)
  overrides.set('zombieWeeklyResolution.findFirst', async () => ({ week: 3 }))
  overrides.set('league.findUnique', async () => ({ userId: 'owner', name: 'Horde League' }))
})
afterEach(() => vi.useRealTimers())

describe('scheduleWeeklyUpdate', () => {
  it('posts the latest PLAYED week in its hour, not the week the league has moved on to', async () => {
    await scheduleWeeklyUpdate('L1')
    expect(created('zombieAnnouncement.create')).toEqual([expect.objectContaining({ type: 'weekly_update', week: 3 })])
    expect(created('leagueChatMessage.create')).toHaveLength(1)
  })

  it('posts once: an update already posted for that week stops the next tick', async () => {
    overrides.set('zombieAnnouncement.findFirst', async () => ({ id: 'already' }))
    await scheduleWeeklyUpdate('L1')
    expect(created('zombieAnnouncement.create')).toEqual([])
  })

  it('waits for its hour', async () => {
    vi.setSystemTime(new Date('2026-10-08T19:05:00.000Z'))
    await scheduleWeeklyUpdate('L1')
    expect(created('zombieAnnouncement.create')).toEqual([])
  })

  it('posts nothing before any week has been resolved', async () => {
    overrides.set('zombieWeeklyResolution.findFirst', async () => null)
    await scheduleWeeklyUpdate('L1')
    expect(created('zombieAnnouncement.create')).toEqual([])
  })
})

describe('runZombieHousekeeping', () => {
  beforeEach(() => {
    overrides.set('zombieLeague.findMany', async () => [{ id: 'z1', leagueId: 'L1' }])
  })

  it('defaults an expired bashing decision, posts the weekly update, and delivers old animations', async () => {
    // Only the expiry sweep's query (open decisions); the weekly update reads bashings too.
    overrides.set('zombieBashingEvent.findMany', async (args) =>
      (args as { where?: { requiresDecision?: boolean } })?.where?.requiresDecision ? [{ id: 'bash-1', winnerUserId: 'u1' }] : [],
    )
    const r = await runZombieHousekeeping()
    expect(r).toMatchObject({ leaguesChecked: 1, errors: [] })
    expect(created('zombieBashingEvent.update')).toEqual([expect.objectContaining({ decisionMade: 'spare', defaultedToRule: true })])
    expect(created('zombieAnnouncement.create')).toEqual([expect.objectContaining({ week: 3 })])
    expect(calls.some((c) => c.key === 'zombieEventAnimation.updateMany')).toBe(true)
  })

  it('one failing step is reported and costs nothing else', async () => {
    overrides.set('zombieAnnouncement.findMany', async () => {
      throw new Error('db blip')
    })
    const r = await runZombieHousekeeping()
    expect(r.errors).toEqual(['announcements: db blip'])
    // The weekly update still posted.
    expect(created('zombieAnnouncement.create')).toEqual([expect.objectContaining({ week: 3 })])
  })
})
