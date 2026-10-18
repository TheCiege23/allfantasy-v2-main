/**
 * survivor-core §5 triggers: "Your torch is out" only once the read is complete, to the voted-out
 * manager only, once per council; the lazy backstop never notifies late; jurors hear the jury vote
 * open once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  council: null as Record<string, unknown> | null,
  existing: null as { id: string } | null,
  enqueue: vi.fn(async () => 'n1'),
  jurySession: null as { status: string } | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueSurvivorCoreNotification: h.enqueue }))
vi.mock('@/lib/survivor/hostEngine', () => ({ postHostMessage: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ name: 'Blah Survivor', sport: 'NFL', season: 2026, settings: { survivorFoundationSettings: { eliminationOutcome: 'exile_island' } }, survivorPhase: 'pre_merge', survivorRevealMode: 'all_at_once' })), update: vi.fn(async () => ({})) },
    survivorLeagueConfig: { findUnique: vi.fn(async () => null) },
    survivorTribalCouncil: { findFirst: vi.fn(async () => h.council), findMany: vi.fn(async () => (h.council ? [h.council] : [])) },
    survivorPlayer: {
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) => ({ userId: where.leagueId_userId.userId, displayName: `${where.leagueId_userId.userId} team`, tribeId: 'tribe-1', redraftRosterId: `roster-${where.leagueId_userId.userId}`, exileWeeksServed: 0 })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({})),
    },
    survivorGameState: { findUnique: vi.fn(async () => ({ weekScoringFinalAt: null, currentWeek: 6 })) },
    survivorTribe: { findUnique: vi.fn(async () => ({ name: 'Vela', logoUrl: null, isMerged: false })) },
    survivorWeeklyScore: { findMany: vi.fn(async () => [{ finalScore: 50 }]), count: vi.fn(async () => 6) },
    survivorIdol: { findUnique: vi.fn(async () => null) },
    survivorAuditEntry: { findMany: vi.fn(async () => []) },
    jurySession: { findUnique: vi.fn(async () => h.jurySession), upsert: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
    survivorShareMoment: {
      findUnique: vi.fn(async () => h.existing),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 'm1' })),
      count: vi.fn(async () => 0),
    },
  },
}))

import { captureCouncilShareMoments, syncLeagueShareMoments } from '@/lib/survivor/shareCards/momentCapture'
import { openFinale, openJuryVoting } from '@/lib/survivor/juryEngine'

beforeEach(() => {
  h.enqueue.mockClear()
  h.existing = null
  h.jurySession = null
  h.council = {
    id: 'c-1', leagueId: 'L1', week: 6, phase: 'pre_merge', attendingTribeId: 'tribe-1', isRevealed: true, isTie: false, revealStartsAt: null, revealStep: 0,
    eliminatedUserId: 'out-user', eliminatedRosterId: 'roster-out', eliminatedName: 'out-user team', idolsPlayed: [],
    revealSequence: [{ order: 1, targetUserId: 'out-user', targetName: 'out-user team', status: 'counts' }],
  }
})

describe('torch out', () => {
  it('queues "Your torch is out" for the voted-out manager when the read is complete', async () => {
    await captureCouncilShareMoments('L1', 'c-1')
    expect(h.enqueue).toHaveBeenCalledWith('L1', { kind: 'torch_out', week: 6, next: 'exile' }, { userId: 'out-user' })
  })

  it('stays silent before the reveal', async () => {
    h.council = { ...h.council!, isRevealed: false }
    await captureCouncilShareMoments('L1', 'c-1')
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('does not notify twice for the same council', async () => {
    h.existing = { id: 'm-existing' }
    await captureCouncilShareMoments('L1', 'c-1')
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('never notifies from the late backstop', async () => {
    await syncLeagueShareMoments('L1')
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})

describe('jury vote open', () => {
  it('notifies jurors once when the finale opens, not again when voting opens', async () => {
    await openFinale('L1', ['a', 'b'])
    expect(h.enqueue).toHaveBeenCalledWith('L1', { kind: 'jury_vote_open' }, { role: 'jury' })
    h.enqueue.mockClear()
    h.jurySession = { status: 'questions_open' }
    await openJuryVoting('L1', new Date())
    await openFinale('L1', ['a', 'b'])
    expect(h.enqueue).not.toHaveBeenCalled()
  })
})
