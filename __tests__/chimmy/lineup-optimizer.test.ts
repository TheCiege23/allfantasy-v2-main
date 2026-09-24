import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildLineupOptimization,
  buildLineupOptimizerContext,
  isOutDesignation,
  renderLineupOptimizationBlock,
  singleSwapCall,
  type LineupOptimizerDeps,
} from '@/lib/chimmy/lineupOptimizerGrounding'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'

/**
 * "Set my lineup" — the whole roster priced this week under the league's OWN rules, compared with
 * the lineup the platform has set. The data seams are injected; `computeLeagueProjectedPoints` and
 * `fillLineup` are the real engines, so every number is a component line through a real rulebook.
 */

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN']
const RULES = { rec: 1, rec_yd: 0.1, rush_yd: 0.1 }
const WEEK = { season: '2026', week: 3 }

const team = (teamId: string, managerUserId: string) =>
  ({ teamId, managerUserId, displayName: teamId, ownerName: teamId }) as unknown as CanonicalWorld['teams'][number]

const MINE = ['qb1', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'wr3', 'te1', 'wr-bye', 'rb-ir']

let starterIds: string[]
const world = (over: { slots?: string[] | null; sport?: string; scoring?: unknown } = {}) =>
  ({
    league: {
      sport: over.sport ?? 'NFL',
      season: 2026,
      scoringSettings: 'scoring' in over ? over.scoring : { scoring_settings: RULES },
      rosterSettings: { starterSlots: over.slots === undefined ? SLOTS : over.slots },
    },
    teams: [team('t1', 'viewer-1'), team('t2', 'rival-2')],
    rosters: [
      { rosterId: 'r1', teamId: 't1', playerIds: MINE, starterIds, reserveIds: ['rb-ir'], taxiIds: [] },
      { rosterId: 'r2', teamId: 't2', playerIds: ['wr9'], starterIds: [], reserveIds: [], taxiIds: [] },
    ],
  }) as unknown as CanonicalWorld

const META = new Map<string, { name: string; position: string; team: string; injury: string | null }>([
  ['qb1', { name: 'Josh Allen', position: 'QB', team: 'BUF', injury: null }],
  ['rb1', { name: 'Bijan Robinson', position: 'RB', team: 'ATL', injury: null }],
  ['rb2', { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', injury: 'Questionable' }],
  ['rb3', { name: 'Tank Bigsby', position: 'RB', team: 'JAX', injury: null }],
  ['wr1', { name: 'CeeDee Lamb', position: 'WR', team: 'DAL', injury: null }],
  ['wr2', { name: 'Garrett Wilson', position: 'WR', team: 'NYJ', injury: null }],
  ['wr3', { name: 'Jayden Reed', position: 'WR', team: 'GB', injury: null }],
  ['te1', { name: 'Sam LaPorta', position: 'TE', team: 'DET', injury: null }],
  ['wr-bye', { name: 'Puka Nacua', position: 'WR', team: 'LAR', injury: null }],
  ['rb-ir', { name: 'Nick Chubb', position: 'RB', team: 'CLE', injury: 'IR' }],
])

/** A line worth `points` under the rules above: rushing yards at 0.1 a yard. */
const yards = (points: number) => ({ rush_yd: points * 10 })

/*
 * Best active lineup: QB Allen 22 · RB Bijan 18, Gibbs 16 · WR Lamb 17, Reed 12 · TE LaPorta 10 ·
 * FLEX Wilson 11 = 106. Nacua has NO line (bye). Chubb (IR) projects 30 and must never start.
 */
const LINES: Record<string, Record<string, unknown>> = {
  qb1: yards(22), rb1: yards(18), rb2: yards(16), rb3: yards(7), wr1: yards(17), wr2: yards(11),
  wr3: yards(12), te1: yards(10), 'rb-ir': yards(30),
}

const resolveWorld = vi.fn()
const loadPlayers = vi.fn()
const latestWeek = vi.fn()
const loadWeekLines = vi.fn()
let deps: LineupOptimizerDeps

beforeEach(() => {
  vi.clearAllMocks()
  // The platform lineup: Nacua (bye) starts at WR, Bigsby (7) at FLEX, Reed (12) on the bench.
  starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr-bye', 'te1', 'rb3']
  resolveWorld.mockImplementation(async () => world())
  loadPlayers.mockResolvedValue(META)
  latestWeek.mockResolvedValue(WEEK)
  loadWeekLines.mockImplementation(async (args: { playerIds: string[]; positions: ReadonlyMap<string, string | null> }) =>
    new Map(
      args.playerIds
        .filter((id) => LINES[id])
        .map((id) => [id, { position: args.positions.get(id) ?? null, componentStats: LINES[id]! }]),
    ),
  )
  deps = { resolveWorld, loadPlayers, latestWeek, loadWeekLines }
})

const run = (userId = 'viewer-1') => buildLineupOptimization({ leagueId: 'L1', userId }, deps)

describe('buildLineupOptimization', () => {
  it('builds the best lineup by slot, in the league\'s declared slot order', async () => {
    const r = await run()
    expect(r.status).toBe('ready')
    if (r.status !== 'ready') return
    expect(r.best.points).toBe(106)
    expect(r.best.slots.map((s) => `${s.slot}:${s.player.name}`)).toEqual([
      'QB:Josh Allen',
      'RB:Bijan Robinson',
      'RB:Jahmyr Gibbs',
      'WR:CeeDee Lamb',
      'WR:Jayden Reed',
      'TE:Sam LaPorta',
      'FLEX:Garrett Wilson',
    ])
  })

  /* 🛑 Injured reserve cannot start. Chubb projects 30 — counting him would move every total. */
  it('never starts a player on injured reserve, however high he projects', async () => {
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.best.slots.some((s) => s.player.playerId === 'rb-ir')).toBe(false)
  })

  it('names the swaps against the platform lineup', async () => {
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.startInstead.map((p) => p.name).sort()).toEqual(['Garrett Wilson', 'Jayden Reed'])
    expect(r.benchInstead.map((p) => p.name).sort()).toEqual(['Puka Nacua', 'Tank Bigsby'])
  })

  /*
   * 🛑 THE MOST EXPENSIVE MISTAKE ON A SUNDAY: a starter with no projection. His points are UNKNOWN,
   * not zero, so the current total is not computed and no "gain" is claimed — but he is flagged.
   */
  it('flags a starter with no projection and refuses to invent the current total', async () => {
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.unpricedStarters.map((p) => p.name)).toEqual(['Puka Nacua'])
    expect(r.current.points).toBeNull()
    expect(r.gain).toBeNull()
    const block = renderLineupOptimizationBlock(r)
    expect(block).toMatch(/Puka Nacua.*NO week 3 projection/)
    expect(block).not.toMatch(/gains \d/)
  })

  it('computes the gain when every current starter is priced', async () => {
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'rb3'] // Bigsby 7 at FLEX, Reed 12 benched
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.current.points).toBe(101)
    expect(r.gain).toBe(5)
    expect(renderLineupOptimizationBlock(r)).toMatch(/gains 5\.0 projected pts/)
  })

  it('says so when the current lineup is already the best one', async () => {
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr3', 'te1', 'wr2']
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.startInstead).toEqual([])
    expect(r.benchInstead).toEqual([])
    expect(r.gain).toBe(0)
    expect(renderLineupOptimizationBlock(r)).toMatch(/already IS the best lineup/)
  })

  it('flags an injured starter and an empty starting slot', async () => {
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr3', 'te1', '0'] // Sleeper's "0" is an empty slot
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.current.emptySlots).toBe(1)
    expect(r.injuredStarters.map((p) => p.name)).toEqual(['Jahmyr Gibbs'])
    const block = renderLineupOptimizationBlock(r)
    expect(block).toMatch(/1 starting slot\(s\) are EMPTY/)
    expect(block).toMatch(/Jahmyr Gibbs.*"Questionable"/)
  })

  /* With no platform lineup there is nothing to swap against — not nine "changes". */
  it('lists no swaps when the platform sent no lineup', async () => {
    starterIds = []
    const r = await run()
    if (r.status !== 'ready') throw new Error('not ready')
    expect(r.current.known).toBe(false)
    expect(r.startInstead).toEqual([])
    expect(renderLineupOptimizationBlock(r)).toMatch(/sent no current lineup/)
  })

  it('refuses for a caller with no team in the league', async () => {
    const r = await run('stranger')
    expect(r).toMatchObject({ status: 'unresolved', reason: 'no_viewer_roster' })
  })

  /* The standing decision: a league this cannot price is refused by name, never priced generically. */
  it('refuses a non-NFL league and a league with no scoring rules, by name', async () => {
    resolveWorld.mockResolvedValueOnce(world({ sport: 'NBA' }))
    expect(await run()).toMatchObject({ status: 'unresolved', reason: 'sport_not_supported' })
    resolveWorld.mockResolvedValueOnce(world({ scoring: null }))
    expect(await run()).toMatchObject({ status: 'unresolved', reason: 'no_scoring_rules' })
  })

  it('refuses when the league stores no lineup slots', async () => {
    resolveWorld.mockResolvedValueOnce(world({ slots: null }))
    expect(await run()).toMatchObject({ status: 'unresolved', reason: 'unknown_slots' })
  })

  it('never throws — a failed read comes back as a sentence', async () => {
    resolveWorld.mockRejectedValueOnce(new Error('db down'))
    const out = await buildLineupOptimizerContext({ leagueId: 'L1', userId: 'viewer-1' }, deps)
    expect(out).toMatch(/NOT COMPUTED/)
    expect(out).toMatch(/Do not present projected points/)
  })
})

describe('isOutDesignation', () => {
  it.each(['Out', 'O', 'IR', 'PUP', 'Suspended'])('treats %s as not playing', (s) => expect(isOutDesignation(s)).toBe(true))
  it.each(['Questionable', 'Doubtful', '', null])('does not treat %s as ruled out', (s) => expect(isOutDesignation(s)).toBe(false))
})

/*
 * Chimmy's track record: a lineup answer is a gradeable "start X over Y" only when the optimizer made
 * exactly one change — with two in and two out, which starter replaces which was never decided.
 */
describe('singleSwapCall', () => {
  it('turns one priced swap past the noise band into a call, in the slot he takes', async () => {
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'rb3'] // Bigsby 7 at FLEX, Reed 12 benched
    const r = await run()
    expect(singleSwapCall(r, 'L1')).toEqual({
      leagueId: 'L1',
      season: 2026,
      week: 3,
      rec: { key: 'wr3', name: 'Jayden Reed' },
      alt: { key: 'rb3', name: 'Tank Bigsby' },
      slot: r.status === 'ready' ? r.best.slots.find((s) => s.player.playerId === 'wr3')?.slot : undefined,
    })
  })

  it('is no call with two changes each way, an unpriced starter, or no change at all', async () => {
    expect(singleSwapCall(await run(), 'L1')).toBeNull() // Nacua on bye: two in, two out, gain unknown
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr3', 'te1', 'wr2']
    expect(singleSwapCall(await run(), 'L1')).toBeNull() // already the best lineup
  })

  /* Two in, two out, every player priced: which starter replaces which was never decided. */
  it('is no call when two players come in and two go out, even with the gain known', async () => {
    LINES['wr-bye'] = yards(5) // Nacua priced this time
    try {
      starterIds = ['qb1', 'rb1', 'rb3', 'wr1', 'wr-bye', 'te1', 'wr2'] // Bigsby and Nacua start
      const r = await run()
      if (r.status !== 'ready') throw new Error('not ready')
      expect(r.startInstead.map((p) => p.name).sort()).toEqual(['Jahmyr Gibbs', 'Jayden Reed'])
      expect(r.benchInstead).toHaveLength(2)
      expect(r.gain).toBeGreaterThan(0.5)
      expect(singleSwapCall(r, 'L1')).toBeNull()
    } finally {
      delete LINES['wr-bye']
    }
  })

  it('is no call inside the noise band', async () => {
    LINES.wr3 = yards(7.3) // Reed barely ahead of Bigsby
    try {
      starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'rb3']
      const r = await run()
      if (r.status !== 'ready') throw new Error('not ready')
      expect(r.gain).toBeLessThan(0.5)
      expect(singleSwapCall(r, 'L1')).toBeNull()
    } finally {
      LINES.wr3 = yards(12)
    }
  })

  it('hands the tool loop the call, and only when asked', async () => {
    starterIds = ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'rb3']
    const onStartCall = vi.fn()
    const block = await buildLineupOptimizerContext({ leagueId: 'L1', userId: 'viewer-1', onStartCall }, deps)
    expect(block).toMatch(/LINEUP OPTIMIZER/)
    expect(onStartCall).toHaveBeenCalledTimes(1)
    expect(onStartCall.mock.calls[0][0]).toMatchObject({ rec: { name: 'Jayden Reed' }, alt: { name: 'Tank Bigsby' } })
    await expect(buildLineupOptimizerContext({ leagueId: 'L1', userId: 'viewer-1' }, deps)).resolves.toMatch(/LINEUP OPTIMIZER/)
  })
})
