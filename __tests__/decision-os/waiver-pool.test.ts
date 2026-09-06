/**
 * R2.6 — the waiver wire pool, the input that made `waiverDecision` unproducible.
 *
 * The subtraction is the whole correctness question: a pool that removes only YOUR players
 * recommends people your opponents already roster, with a FAAB bid attached. That is worse than no
 * recommendation, because it looks actionable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const findMany = vi.fn()
const getPool = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findMany: (a: unknown) => findMany(a) } } }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: (s: string, o: unknown) => getPool(s, o),
}))
vi.mock('@/lib/waiver-wire/roster-utils', () => ({
  getRosterPlayerIds: (pd: unknown) => ((pd as { ids?: string[] })?.ids ?? []),
}))

const { loadWaiverPool } = await import('@/lib/decision-os/waiver/pool')

const player = (id: string, over: Record<string, unknown> = {}) => ({
  player_id: id,
  external_source_id: null,
  full_name: `Player ${id}`,
  position: 'WR',
  ...over,
})

beforeEach(() => {
  findMany.mockReset()
  getPool.mockReset()
})

describe('loadWaiverPool', () => {
  it('🛑 subtracts EVERY roster in the league, not just the asker’s', async () => {
    findMany.mockResolvedValue([{ playerData: { ids: ['p1'] } }, { playerData: { ids: ['p2'] } }])
    getPool.mockResolvedValue([player('p1'), player('p2'), player('p3')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.id)).toEqual(['p3'])
    expect(out.leagueRosterCount).toBe(2)
  })

  it('matches on external_source_id too, since the pool and rosters key differently', async () => {
    /*
     * A rostered player carried under a platform id would otherwise come back as "available" and be
     * recommended to the manager who already owns him.
     */
    findMany.mockResolvedValue([{ playerData: { ids: ['sleeper-99'] } }])
    getPool.mockResolvedValue([player('p9', { external_source_id: 'sleeper-99' }), player('p8')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.id)).toEqual(['p8'])
  })

  it('reports poolIncomplete when the resolver returned a full page', async () => {
    /*
     * ⚠ THE FLAG IS THE HONESTY, NOT A DETAIL. A recommendation drawn from a capped slice is a
     * recommendation from a SAMPLE, and `runWaiverClaimDecision` takes `poolIncomplete` precisely so
     * the decision can say "the best add we looked at" rather than "the best add".
     */
    findMany.mockResolvedValue([])
    getPool.mockResolvedValue(Array.from({ length: 300 }, (_, i) => player(`p${i}`)))

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.poolIncomplete).toBe(true)
  })

  it('is NOT incomplete when the wire is genuinely smaller than the cap', async () => {
    findMany.mockResolvedValue([])
    getPool.mockResolvedValue([player('p1'), player('p2')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.poolIncomplete).toBe(false)
  })

  it('surfaces an empty league as leagueRosterCount 0 rather than a silent full pool', async () => {
    /*
     * With no rosters the subtraction is vacuous, so every player looks available. The count is what
     * lets the caller tell "nobody is rostered" from "we could not read the rosters" — the producer
     * uses it to pick which gap to state.
     */
    findMany.mockResolvedValue([])
    getPool.mockResolvedValue([player('p1')])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.leagueRosterCount).toBe(0)
    expect(out.availablePlayers).toHaveLength(1)
  })

  it('defaults a missing position to FLEX and uppercases, matching the waiver assistant exactly', async () => {
    findMany.mockResolvedValue([])
    getPool.mockResolvedValue([player('p1', { position: null }), player('p2', { position: 'rb' })])

    const out = await loadWaiverPool('L1', 'NFL')
    expect(out.availablePlayers.map((p) => p.position)).toEqual(['FLEX', 'RB'])
  })

  it('reads rosters and the pool CONCURRENTLY, not one after the other', async () => {
    /*
     * This is the packet's most expensive slice; serialising two independent reads inside it would
     * double its contribution to a latency budget the whole packet shares.
     */
    let rostersStarted = 0
    let poolStarted = 0
    let order = 0
    findMany.mockImplementation(async () => {
      rostersStarted = ++order
      await new Promise((r) => setTimeout(r, 20))
      return []
    })
    getPool.mockImplementation(async () => {
      poolStarted = ++order
      return []
    })

    await loadWaiverPool('L1', 'NFL')
    // Both begin before either resolves; a sequential await would make pool start after rosters end.
    expect(Math.abs(rostersStarted - poolStarted)).toBe(1)
  })
})
