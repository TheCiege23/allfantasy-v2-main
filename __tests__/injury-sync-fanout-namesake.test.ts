import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Injury fan-out bound roster rows by name alone. "DeVonta Smith Out" (WR, PHI) would have posted to
 * every league rostering CB DeVonta Smith (CAR), and the `contains` fallback to any longer name.
 * Roster `team` is stored as the full club name; the ESPN writer passes an abbreviation.
 */

vi.mock('server-only', () => ({}))

const rosterFindMany = vi.fn()
const emit = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { redraftRosterPlayer: { findMany: (...a: unknown[]) => rosterFindMany(...a) } },
}))
vi.mock('@/lib/realtime-events/realtimeEventService', () => ({
  emitPlayerInjuryOrNewsFanout: (...a: unknown[]) => emit(...a),
}))

const ROSTER = [
  { playerName: 'DeVonta Smith', team: 'Philadelphia Eagles', roster: { leagueId: 'league-wr' } },
  { playerName: 'DeVonta Smith', team: 'Carolina Panthers', roster: { leagueId: 'league-cb' } },
]

async function fanout() {
  return (await import('@/lib/realtime-events/injurySyncFanout')).fanoutInjurySyncBatch
}

beforeEach(() => {
  rosterFindMany.mockReset()
  emit.mockReset().mockResolvedValue(undefined)
})

describe('fanoutInjurySyncBatch — the injured player’s club, not his name, picks the leagues', () => {
  it('posts the receiver’s Out only to the league rostering the receiver', async () => {
    rosterFindMany.mockResolvedValue(ROSTER)
    await (await fanout())({ sport: 'NFL', injuries: [{ playerName: 'DeVonta Smith', team: 'PHI', status: 'Out' }] })
    expect(emit.mock.calls.map((c) => (c[0] as { leagueId: string }).leagueId)).toEqual(['league-wr'])
  })

  it('keeps two namesakes on one report as two players', async () => {
    rosterFindMany.mockResolvedValue(ROSTER)
    await (await fanout())({
      sport: 'NFL',
      injuries: [
        { playerName: 'DeVonta Smith', team: 'PHI', status: 'Out' },
        { playerName: 'DeVonta Smith', team: 'Carolina Panthers', status: 'Questionable' },
      ],
    })
    expect(emit.mock.calls.map((c) => (c[0] as { leagueId: string }).leagueId).sort()).toEqual(['league-cb', 'league-wr'])
  })

  it('an injury with no team posts nowhere', async () => {
    rosterFindMany.mockResolvedValue(ROSTER)
    await (await fanout())({ sport: 'NFL', injuries: [{ playerName: 'DeVonta Smith', team: null, status: 'Out' }] })
    expect(emit).not.toHaveBeenCalled()
  })

  it('the contains fallback no longer binds a longer name on the same club', async () => {
    rosterFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ playerName: 'Michael Carterson', team: 'Tennessee Titans', roster: { leagueId: 'league-x' } }])
    await (await fanout())({ sport: 'NFL', injuries: [{ playerName: 'Michael Carter', team: 'TEN', status: 'Out' }] })
    expect(emit).not.toHaveBeenCalled()
  })
})
