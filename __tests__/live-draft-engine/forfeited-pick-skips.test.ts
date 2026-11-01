/** A pick forfeited as a penalty is skipped when the draft reaches it — and only that pick. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  state: { picks: [] as Array<{ overall: number; playerName: string; position: string; pickMetadata: unknown }>, status: 'in_progress', draftType: 'snake' },
  forfeited: [] as Array<{ round: number; originalRosterId: string }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findFirst: vi.fn(async () => ({ id: 'ds', status: m.state.status })),
      findUnique: vi.fn(async () => ({
        status: m.state.status,
        rounds: 2,
        teamCount: 3,
        draftType: m.state.draftType,
        thirdRoundReversal: false,
        slotOrder: [
          { slot: 1, rosterId: 'A', displayName: 'A' },
          { slot: 2, rosterId: 'B', displayName: 'B' },
          { slot: 3, rosterId: 'C', displayName: 'C' },
        ],
        picks: m.state.picks,
      })),
    },
    futureDraftPick: { findMany: vi.fn(async () => m.forfeited) },
  },
}))

import { FORFEITED_PICK_NAME, skipForfeitedPicksOnClock } from '@/lib/live-draft-engine/forfeitedPickSkips'

/** A fake submitPick that writes the next overall, as the real one does. */
const submit = vi.fn(async (input: { playerName: string; position: string; expectedOverall: number; pickMetadata: unknown }) => {
  m.state.picks.push({ overall: input.expectedOverall, playerName: input.playerName, position: input.position, pickMetadata: input.pickMetadata })
  return { success: true }
})
const pickBy = (overall: number) => ({ overall, playerName: `Player ${overall}`, position: 'RB', pickMetadata: null })

beforeEach(() => {
  vi.clearAllMocks()
  m.state = { picks: [], status: 'in_progress', draftType: 'snake' }
  m.forfeited = []
})

describe('skipForfeitedPicksOnClock', () => {
  it('skips the forfeited pick on the clock, and stops at the next team that may pick', async () => {
    m.forfeited = [{ round: 1, originalRosterId: 'B' }]
    m.state.picks = [pickBy(1)] // A has picked; B (forfeited) is on the clock
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ playerName: FORFEITED_PICK_NAME, position: 'SKIP', expectedOverall: 2, source: 'commissioner' }))
    expect(m.state.picks.map((p) => p.overall)).toEqual([1, 2])
  })

  it('skips back-to-back forfeits (snake turn: C at 3, C again at 4)', async () => {
    m.forfeited = [{ round: 1, originalRosterId: 'C' }, { round: 2, originalRosterId: 'C' }]
    m.state.picks = [pickBy(1), pickBy(2)]
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(2)
    expect(m.state.picks.map((p) => p.overall)).toEqual([1, 2, 3, 4])
  })

  it('does nothing when the team on the clock still owns its pick', async () => {
    m.forfeited = [{ round: 2, originalRosterId: 'A' }]
    m.state.picks = [pickBy(1)]
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(0)
    expect(submit).not.toHaveBeenCalled()
  })

  it('does nothing before the draft starts, in an auction, or with no forfeits', async () => {
    m.forfeited = [{ round: 1, originalRosterId: 'A' }]
    m.state.status = 'pre_draft'
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(0)
    m.state.status = 'in_progress'
    m.state.draftType = 'auction'
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(0)
    m.state.draftType = 'snake'
    m.forfeited = []
    expect(await skipForfeitedPicksOnClock('L', submit)).toBe(0)
    expect(submit).not.toHaveBeenCalled()
  })

  it('a failed skip stops the loop — the clock simply stays on the pick', async () => {
    m.forfeited = [{ round: 1, originalRosterId: 'A' }]
    const failing = vi.fn(async () => ({ success: false }))
    expect(await skipForfeitedPicksOnClock('L', failing)).toBe(0)
    expect(failing).toHaveBeenCalledTimes(1)
  })
})
