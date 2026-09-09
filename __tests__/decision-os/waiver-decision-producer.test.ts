import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R2.6 — `waiverDecision` gets a producer.
 *
 * ── WHAT THESE TESTS ARE FOR ────────────────────────────────────────────────────────────────
 * The slice's whole history is a sequence of things that looked done and were not: declared on the
 * packet type but assigned nowhere, then assigned but reporting `no_producer`, and now producing.
 * So the assertions below are aimed at the SEAMS that failed before, not at the engine (which was
 * never the problem and has its own suites):
 *
 *   1. the wire actually reaches the engine input          — the missing input was the whole bug
 *   2. roster slots survive the trip                        — `slot` drives replacement gain + drop
 *   3. an unresolvable roster id is DROPPED, not defaulted  — a phantom player corrupts depth maths
 *   4. an empty wire is a stated gap, never a thrown error  — the packet's contract is gaps
 *   5. `poolIncomplete` is true when the roster is unreadable — the DCO's honesty depends on it
 *
 * ⚠ EVERY ASSERTION BELOW WAS WATCHED TO FAIL. See the mutation notes on each `it`.
 */

const findMany = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
    sportsPlayer: { findMany: (...a: unknown[]) => findMany(...a) },
    sportsPlayerRecord: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}))

const loadLeaguePlayerPool = vi.fn()
vi.mock('@/lib/waiver-wire/league-player-pool', () => ({
  loadLeaguePlayerPool: (...a: unknown[]) => loadLeaguePlayerPool(...a),
}))

const { buildWaiverPacketInput } = await import('@/lib/decision-os/waiver/packetInput')

/** The loader's output, minus everything this seam does not read. */
function facts(over: Record<string, unknown> = {}) {
  return {
    sport: 'NFL',
    leagueId: 'lg1',
    rosterId: 'roster-1',
    settings: {
      waiverType: 'faab',
      normalizedWaiverType: 'faab',
      faabBudget: 100,
      claimLimitPerPeriod: null,
      claimLimitPerWeek: null,
      maxDropsPerWeek: null,
      lockType: null,
    },
    settingsKnown: true,
    faabRemaining: 42,
    waiverPriority: null,
    rosterSize: 2,
    ...over,
  } as never
}

function wirePlayer(id: string, position: string) {
  return {
    id,
    name: `Player ${id}`,
    position,
    team: 'KC',
    sport: 'NFL',
    injuryStatus: null,
    fantasyPointsPerGame: 9,
    lowConfidence: false,
    profileSource: 'sleeper',
    statsSource: 'sleeper',
    product: { unified: {}, yearsExp: 2 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildWaiverPacketInput — the input the browser used to supply', () => {
  it('puts the league wire into availablePlayers', async () => {
    // MUTATION WATCHED: returning `availablePlayers: []` from the builder turns this red.
    loadLeaguePlayerPool.mockResolvedValue({
      players: [wirePlayer('p1', 'WR'), wirePlayer('p2', 'RB')],
      rosteredCount: 20,
    })
    findUnique.mockResolvedValue({ playerData: { players: [] } })

    const built = await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })

    expect(built).not.toBeNull()
    expect(built!.engineInput.availablePlayers.map((p) => p.playerId)).toEqual(['p1', 'p2'])
    // The value scale must be the shared one, or a server input and a browser input are not
    // comparable. WR's baseline with no demand signal is its table entry exactly.
    expect(built!.engineInput.availablePlayers[0].value).toBe(2900)
  })

  it('carries each rostered player at the slot the roster puts them in', async () => {
    /*
     * MUTATION WATCHED: defaulting every slot to 'bench' in `getRosterSlotsByPlayerId` turns this
     * red. That mutation is the exact bug the helper exists to prevent — the scorer reads
     * `slot === 'starter'` to find the worst starter a candidate would replace.
     */
    loadLeaguePlayerPool.mockResolvedValue({ players: [wirePlayer('p1', 'WR')], rosteredCount: 5 })
    findUnique.mockResolvedValue({
      playerData: { players: ['r1', 'r2', 'r3'], starters: ['r1'], taxi: ['r3'] },
    })
    findMany.mockResolvedValue([
      { id: 'r1', sleeperId: 'r1', externalId: null, name: 'Starter', position: 'WR', team: 'SF', age: 26 },
      { id: 'r2', sleeperId: 'r2', externalId: null, name: 'Bencher', position: 'RB', team: 'NYJ', age: 24 },
      { id: 'r3', sleeperId: 'r3', externalId: null, name: 'Taxi', position: 'TE', team: 'LAR', age: 22 },
    ])

    const built = await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })
    const bySlot = Object.fromEntries(built!.engineInput.roster!.map((p) => [p.id, p.slot]))

    expect(bySlot).toEqual({ r1: 'starter', r2: 'bench', r3: 'taxi' })
  })

  it('drops a roster id no player row resolves, rather than inventing a positionless player', async () => {
    /*
     * MUTATION WATCHED: replacing the `if (!row) continue` with a fabricated
     * `{ name: id, position: 'UTIL' }` turns this red.
     *
     * 🛑 WHY IT MATTERS MORE THAN IT LOOKS: a phantom counts toward positional depth and toward the
     * roster size the DCO reports, so a league with unresolvable ids would look deeper than it is
     * and the engine would recommend against a need the manager actually has.
     */
    loadLeaguePlayerPool.mockResolvedValue({ players: [wirePlayer('p1', 'WR')], rosteredCount: 5 })
    findUnique.mockResolvedValue({ playerData: { players: ['known', 'ghost'] } })
    findMany.mockResolvedValue([
      { id: 'known', sleeperId: 'known', externalId: null, name: 'Known', position: 'WR', team: 'SF', age: 26 },
    ])

    const built = await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })

    expect(built!.engineInput.roster!.map((p) => p.id)).toEqual(['known'])
  })

  it('reports poolIncomplete when the roster could not be read at all', async () => {
    /*
     * MUTATION WATCHED: hardcoding `poolIncomplete: false` turns this red.
     *
     * Without a roster the engine cannot compute a replacement gain or nominate a drop, so the
     * answer is "best on the wire" rather than "best for you". The DCO lowers `data_completeness`
     * on this flag; losing it would make the two answers indistinguishable to a reader.
     */
    loadLeaguePlayerPool.mockResolvedValue({ players: [wirePlayer('p1', 'WR')], rosteredCount: 0 })
    findUnique.mockResolvedValue(null)

    const built = await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })

    expect(built!.poolIncomplete).toBe(true)
    expect(built!.engineInput.roster).toEqual([])
  })

  it('returns null when the wire is empty, so the caller can state a gap instead of deciding', async () => {
    // MUTATION WATCHED: returning a built input on an empty pool turns this red.
    loadLeaguePlayerPool.mockResolvedValue({ players: [], rosteredCount: 180 })
    findUnique.mockResolvedValue({ playerData: { players: [] } })

    expect(await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })).toBeNull()
  })

  it('asks the pool for far more rows than it will use, because the wire is what is left over', async () => {
    /*
     * MUTATION WATCHED: passing the candidate cap (60) as the pool limit turns this red.
     *
     * ⚠ THIS IS NOT A STYLE ASSERTION. The pool is ADP-ordered, so its head is mostly rostered
     * players; asking for 60 rows in a 12-team league returns a wire of nearly nothing, and the
     * decision would be made over scraps while looking perfectly healthy.
     */
    loadLeaguePlayerPool.mockResolvedValue({ players: [wirePlayer('p1', 'WR')], rosteredCount: 5 })
    findUnique.mockResolvedValue({ playerData: { players: [] } })

    await buildWaiverPacketInput({ userId: 'u1', leagueId: 'lg1', facts: facts() })

    const [, , opts] = loadLeaguePlayerPool.mock.calls[0] as [string, string, { poolLimit: number }]
    expect(opts.poolLimit).toBeGreaterThanOrEqual(400)
  })
})
