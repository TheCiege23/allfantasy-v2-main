import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Moment capture reads only what the league was already shown. The out card waits for the public
 * reveal, carries the ceremony's counts but no voter, and idol cards exist only for idols played at
 * a revealed council.
 */
const h = vi.hoisted(() => ({
  council: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
  game: { weekScoringFinalAt: new Date(), mergeTriggeredAt: null as Date | null, phase: 'pre_merge' },
  weekScores: [] as Array<Record<string, unknown>>,
  players: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: { survivorFoundationSettings: { eliminationOutcome: 'exile_island' } }, survivorPhase: 'pre_merge' })) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => h.council) },
    survivorPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => ({
        userId: where.leagueId_userId.userId, displayName: `${where.leagueId_userId.userId} team`, tribeId: 'tribe-1', redraftRosterId: `roster-${where.leagueId_userId.userId}`, exileWeeksServed: 0,
      })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => h.players),
    },
    survivorGameState: { findUnique: vi.fn(async () => h.game) },
    survivorTribe: { findUnique: vi.fn(async () => ({ name: 'Vela', logoUrl: null, isMerged: false })) },
    survivorWeeklyScore: {
      findMany: vi.fn(async ({ where }: { where: { userId?: string } }) => (where.userId ? [{ finalScore: 50 }, { finalScore: 46.2 }] : h.weekScores)),
      count: vi.fn(async () => 6),
    },
    survivorIdol: { findUnique: vi.fn(async () => ({ powerType: 'vote_shield' })) },
    survivorShareMoment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: `id-${h.created.length}` } }),
      count: vi.fn(async () => 0),
    },
  },
}))

import { captureCouncilShareMoments, captureImmunityShareMoment, countedTallyFromScrolls, necklaceWinners, publicTally } from '@/lib/survivor/shareCards/momentCapture'

const scrolls = [
  { order: 1, targetUserId: 'out-user', targetName: 'out-user team', status: 'counts', isExtraVote: false },
  { order: 2, targetUserId: 'idol-user', targetName: 'idol-user team', status: 'blocked_by_idol', isExtraVote: false },
  { order: 3, targetUserId: 'out-user', targetName: 'out-user team', status: 'counts', isExtraVote: false },
  { order: 4, targetUserId: 'third', targetName: 'third team', status: 'counts', isExtraVote: false },
]

beforeEach(() => {
  h.created = []
  h.council = {
    id: 'c-1', leagueId: 'league-1', week: 6, phase: 'pre_merge', attendingTribeId: 'tribe-1', isRevealed: true, isTie: false,
    eliminatedUserId: 'out-user', eliminatedRosterId: 'roster-out', eliminatedName: 'out-user team', revealSequence: scrolls,
    idolsPlayed: [{ idolId: 'idol-1', powerType: 'vote_shield', playerUserId: 'idol-user', playerRosterId: 'roster-idol' }],
  }
})

describe('captureCouncilShareMoments', () => {
  it('creates nothing before the ceremony is public', async () => {
    h.council = { ...h.council!, isRevealed: false }
    expect(await captureCouncilShareMoments('league-1', 'c-1')).toBe(0)
    expect(h.created).toHaveLength(0)
  })

  it('creates the out card from the public counts, with no voter data', async () => {
    await captureCouncilShareMoments('league-1', 'c-1')
    const out = h.created.find(row => row.type === 'out')!
    expect(out.subjectUserId).toBe('out-user')
    expect(out.dedupeKey).toBe('out:c-1')
    const payload = out.payload as Record<string, unknown>
    expect(payload.tally).toBe('2–1')
    expect(payload.next).toBe('exile')
    expect(payload.points).toBe(96.2)
    expect(JSON.stringify(payload)).not.toMatch(/voter|ballot|targetUserId|third team/i)
  })

  it('creates an idol card only for the idol that was played, with its own art', async () => {
    await captureCouncilShareMoments('league-1', 'c-1')
    const idols = h.created.filter(row => row.type === 'idol')
    expect(idols).toHaveLength(1)
    expect(idols[0].subjectUserId).toBe('idol-user')
    const payload = idols[0].payload as Record<string, unknown>
    expect(payload.idolId).toBe('immunity')
    expect(payload.votesCancelled).toBe(1)
    expect(payload.votesCounted).toBe(0)
  })

  it('creates no out card for a tied council', async () => {
    h.council = { ...h.council!, isTie: true, idolsPlayed: [] }
    await captureCouncilShareMoments('league-1', 'c-1')
    expect(h.created).toHaveLength(0)
  })
})

describe('public tally', () => {
  it('reads counted scrolls only, highest first, without names', () => {
    expect(countedTallyFromScrolls(scrolls)).toBe('2–1')
    expect(publicTally([1, 3, 1])).toBe('3–1–1')
    expect(publicTally([4])).toBe('4–0')
    expect(publicTally([])).toBeNull()
  })
})

describe('immunity necklaces (per tribe pre-merge, league top post-merge)', () => {
  const score = (userId: string, tribeId: string | null, finalScore: number) => ({ userId, tribeId, finalScore, countedTowardTribeTotal: true })

  beforeEach(() => {
    h.game = { weekScoringFinalAt: new Date(), mergeTriggeredAt: null, phase: 'pre_merge' }
    h.weekScores = [score('a1', 'tribe-a', 120), score('a2', 'tribe-a', 140), score('b1', 'tribe-b', 99), score('b2', 'tribe-b', 98), score('exiled', 'tribe-b', 200)]
    h.players = [
      ...['a1', 'a2', 'b1', 'b2'].map(userId => ({ userId, playerState: 'active', eliminatedWeek: null })),
      { userId: 'exiled', playerState: 'exile', eliminatedWeek: 3 },
    ]
  })

  it('pre-merge: one moment for each tribe’s top scorer, offered only to that winner', async () => {
    expect(await captureImmunityShareMoment('league-1', 6)).toBe(2)
    const winners = h.created.filter(row => row.type === 'immunity').map(row => row.subjectUserId).sort()
    expect(winners).toEqual(['a2', 'b1'])
    expect(h.created.map(row => row.dedupeKey).sort()).toEqual(['immunity:6:a2', 'immunity:6:b1'])
    expect((h.created[0].payload as Record<string, unknown>).rankScope).toBe('tribe')
  })

  it('never gives a necklace to an Exile score row', async () => {
    await captureImmunityShareMoment('league-1', 6)
    expect(h.created.some(row => row.subjectUserId === 'exiled')).toBe(false)
  })

  it('post-merge: only the single top score in the league', async () => {
    h.game = { ...h.game, mergeTriggeredAt: new Date(), phase: 'post_merge' }
    expect(await captureImmunityShareMoment('league-1', 9)).toBe(1)
    expect(h.created[0].subjectUserId).toBe('a2')
    expect((h.created[0].payload as Record<string, unknown>).rankScope).toBe('island')
  })

  it('waits for final scores', async () => {
    h.game = { ...h.game, weekScoringFinalAt: null as unknown as Date }
    expect(await captureImmunityShareMoment('league-1', 6)).toBe(0)
  })

  it('breaks ties by user id', () => {
    expect(necklaceWinners([score('z', 't', 10), score('m', 't', 10)], false).map(w => w.userId)).toEqual(['m'])
  })
})
