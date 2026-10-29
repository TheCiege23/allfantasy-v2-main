// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cross-feature (exile-scroll x weekly-loop x share-cards): while the Tribal Council scroll is still
 * being read, neither weekly-loop's torch-out moment nor share-cards' out/idol capture (including its
 * lazy backstop) may name the voted-out manager. eliminatedUserId is written at tally, BEFORE the read.
 */
const h = vi.hoisted(() => ({
  council: null as Record<string, unknown> | null,
  league: { name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: {}, survivorPhase: 'pre_merge', survivorRevealMode: 'dramatic_sequential' } as Record<string, unknown>,
  created: [] as Array<Record<string, unknown>>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => h.league) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => h.council) },
    survivorPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => ({ userId: where.leagueId_userId.userId, displayName: 'Out Manager', tribeId: 't1', redraftRosterId: 'r-out', exileWeeksServed: 0 })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    survivorTribe: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    survivorWeeklyScore: { findMany: vi.fn(async () => []), count: vi.fn(async () => 6) },
    survivorIdol: { findUnique: vi.fn(async () => ({ powerType: 'vote_shield' })) },
    survivorTribeImmunity: { findMany: vi.fn(async () => []) },
    survivorMomentSeen: { findMany: vi.fn(async () => []), upsert: vi.fn() },
    survivorShareMoment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: `id-${h.created.length}` } }),
      count: vi.fn(async () => 0),
    },
  },
}))
import { captureCouncilShareMoments } from '@/lib/survivor/shareCards/momentCapture'
import { buildWeeklyMoments } from '@/lib/survivor/survivorWeeklyMoments'

const ballots = [
  { order: 1, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
  { order: 2, targetUserId: 'u-idol', targetName: 'Idol Manager', status: 'blocked_by_idol', isExtraVote: false },
  { order: 3, targetUserId: 'u-out', targetName: 'Out Manager', status: 'counts', isExtraVote: false },
]
const access = { leagueId: 'l1', userId: 'viewer', settings: { exileIslandEnabled: true } } as never

beforeEach(() => {
  h.created = []
  h.league = { ...h.league, survivorRevealMode: 'dramatic_sequential' }
  h.council = {
    id: 'c1', leagueId: 'l1', week: 6, councilNumber: 1, phase: 'pre_merge', attendingTribeId: 't1', isRevealed: true, isTie: false,
    revealStartsAt: new Date(), revealStep: 0, revealSequence: ballots,
    eliminatedUserId: 'u-out', eliminatedRosterId: 'r-out', eliminatedName: 'Out Manager',
    idolsPlayed: [{ idolId: 'idol-1', powerType: 'vote_shield', playerUserId: 'u-idol', playerRosterId: 'r-idol' }],
  }
})

describe('mid-read', () => {
  it('share-cards captures no out or idol moment', async () => {
    expect(await captureCouncilShareMoments('l1', 'c1')).toBe(0)
    expect(h.created).toHaveLength(0)
  })

  it('weekly-loop shows no torch-out', async () => {
    expect((await buildWeeklyMoments(access)).torchOut).toBeNull()
  })

  it('commissioner pacing stays hidden on the clock until the host releases every ballot', async () => {
    h.league = { ...h.league, survivorRevealMode: 'commissioner' }
    h.council = { ...h.council!, revealStartsAt: new Date(Date.now() - 86_400_000), revealStep: 2 }
    expect(await captureCouncilShareMoments('l1', 'c1')).toBe(0)
    expect((await buildWeeklyMoments(access)).torchOut).toBeNull()
  })
})

describe('after the last ballot', () => {
  beforeEach(() => { h.council = { ...h.council!, revealStartsAt: new Date(Date.now() - 60_000) } })

  it('share-cards captures the out and idol moments', async () => {
    expect(await captureCouncilShareMoments('l1', 'c1')).toBe(2)
    expect(h.created.map(row => row.type).sort()).toEqual(['idol', 'out'])
  })

  it('weekly-loop shows the torch-out', async () => {
    expect((await buildWeeklyMoments(access)).torchOut).toMatchObject({ councilId: 'c1', userId: 'u-out', name: 'Out Manager' })
  })
})
