import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Moment capture reads only what the league was already shown. The out card waits for the public
 * reveal, carries the ceremony's counts but no voter, and idol cards exist only for idols played at
 * a revealed council.
 */
const h = vi.hoisted(() => ({
  council: null as Record<string, unknown> | null,
  created: [] as Array<Record<string, unknown>>,
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
    },
    survivorTribe: { findUnique: vi.fn(async () => ({ name: 'Vela', logoUrl: null, isMerged: false })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => [{ finalScore: 50 }, { finalScore: 46.2 }]), count: vi.fn(async () => 6) },
    survivorIdol: { findUnique: vi.fn(async () => ({ powerType: 'vote_shield' })) },
    survivorShareMoment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { h.created.push(data); return { id: `id-${h.created.length}` } }),
      count: vi.fn(async () => 0),
    },
  },
}))

import { captureCouncilShareMoments, countedTallyFromScrolls, publicTally } from '@/lib/survivor/shareCards/momentCapture'

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
