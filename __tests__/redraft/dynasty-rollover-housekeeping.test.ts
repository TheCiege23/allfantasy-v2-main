import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Carried rosters are re-checked when year two starts: last year's rookie is no longer a rookie,
 * a healed player is no longer IR-eligible, and the rookie draft can take a team over its roster
 * size. Ineligible players go to the BENCH — never dropped — and over-limit teams are FLAGGED,
 * never cut.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueUpdate: vi.fn(),
  seasonFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  playerUpdateMany: vi.fn(),
  playerDelete: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: m.leagueFindUnique, update: m.leagueUpdate },
    redraftSeason: { findUnique: m.seasonFindUnique, findFirst: m.seasonFindFirst },
    redraftRoster: { findMany: m.rosterFindMany },
    redraftRosterPlayer: { updateMany: m.playerUpdateMany, delete: m.playerDelete, deleteMany: m.playerDelete },
    sportsPlayer: { findMany: m.sportsPlayerFindMany },
  },
}))

import {
  planRolloverHousekeeping,
  runDynastyRolloverHousekeeping,
  afterDynastyNewSeasonActivated,
  type HousekeepingPlayer,
} from '@/lib/redraft/offseason/dynastyRolloverHousekeeping'

const LEAGUE = {
  id: 'L',
  sport: 'NFL',
  leagueVariant: null,
  settings: {},
  lifecycleState: 'post_draft',
  lifecycleMetadata: {},
  lockAllMoves: false,
  irAllowOut: true,
  irAllowCovid: false,
  irAllowSuspended: false,
  irAllowNA: false,
  irAllowDNR: false,
  irAllowDoubtful: false,
  taxiSlots: 3,
  taxiAllowNonRookies: false,
  taxiYearsLimit: 2,
  guillotineMode: false,
  bestBallMode: false,
}

const p = (playerId: string, slotType: string, injuryStatus: string | null = null): HousekeepingPlayer => ({
  id: `row-${playerId}`,
  playerId,
  playerName: `Player ${playerId}`,
  slotType,
  injuryStatus,
})

const plan = (players: HousekeepingPlayer[], years: Record<string, number>, league = LEAGUE, max = 30) =>
  planRolloverHousekeeping({
    league: league as never,
    rosters: [{ rosterId: 'R1', ownerId: 'u1', teamName: 'Aces', players }],
    yearsExpByPlayerId: new Map(Object.entries(years)),
    maxRosterSize: max,
  })

describe('planRolloverHousekeeping — taxi', () => {
  it('moves a second-year player off a rookie-only taxi squad, and keeps a rookie there', () => {
    const out = plan([p('soph', 'taxi'), p('rook', 'TAXI')], { soph: 1, rook: 0 })
    expect(out.moves).toEqual([
      expect.objectContaining({ playerId: 'soph', from: 'taxi', to: 'bench', reason: 'taxi_non_rookie_disallowed' }),
    ])
  })

  it('applies the years limit when non-rookies are allowed', () => {
    const out = plan([p('y2', 'taxi'), p('y3', 'taxi')], { y2: 2, y3: 3 }, { ...LEAGUE, taxiAllowNonRookies: true, taxiYearsLimit: 2 })
    expect(out.moves.map((x) => [x.playerId, x.reason])).toEqual([['y3', 'taxi_too_experienced']])
  })

  it('leaves a player whose experience is unknown where he is, and counts him', () => {
    const out = plan([p('mystery', 'taxi')], {})
    expect(out.moves).toEqual([])
    expect(out.taxiUnverified).toBe(1)
  })

  it('moves every taxi player when the league has no taxi squad', () => {
    const out = plan([p('a', 'taxi')], { a: 0 }, { ...LEAGUE, taxiSlots: 0 })
    expect(out.moves).toEqual([expect.objectContaining({ playerId: 'a', reason: 'taxi_disabled' })])
  })
})

describe('planRolloverHousekeeping — IR', () => {
  it('moves a healthy player off IR and keeps an injured one', () => {
    const out = plan([p('healed', 'IR', null), p('hurt', 'ir', 'IR'), p('out', 'IR', 'Out')], {})
    expect(out.moves.map((x) => x.playerId)).toEqual(['healed'])
  })

  it('honours the league IR rules — OUT is ineligible when the league disallows it', () => {
    const out = plan([p('out', 'IR', 'OUT')], {}, { ...LEAGUE, irAllowOut: false })
    expect(out.moves.map((x) => x.playerId)).toEqual(['out'])
  })

  it('reads the MLB/NBA injured list slot too, but not the MLB minors (NA) slot', () => {
    const out = plan([p('il', 'IL', null), p('minors', 'NA', null)], {})
    expect(out.moves.map((x) => x.playerId)).toEqual(['il'])
  })
})

describe('planRolloverHousekeeping — roster size', () => {
  it('flags an over-limit team and drops nobody', () => {
    const players = Array.from({ length: 5 }, (_, i) => p(`b${i}`, 'bench'))
    const out = plan(players, {}, LEAGUE, 3)
    expect(out.needsCutDown).toEqual([
      { rosterId: 'R1', ownerId: 'u1', teamName: 'Aces', rosterCount: 5, maxRosterSize: 3, over: 2 },
    ])
    expect(out.moves).toEqual([])
  })

  it('does not flag a team at the limit', () => {
    expect(plan([p('a', 'bench'), p('b', 'bench')], {}, LEAGUE, 2).needsCutDown).toEqual([])
  })
})

describe('runDynastyRolloverHousekeeping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.leagueFindUnique.mockResolvedValue(LEAGUE)
    m.seasonFindUnique.mockResolvedValue({ sport: 'NFL' })
    m.sportsPlayerFindMany.mockResolvedValue([{ id: 'sp1', externalId: 'soph', sleeperId: null, yearsExp: 1 }])
    m.playerUpdateMany.mockResolvedValue({ count: 1 })
    m.rosterFindMany.mockResolvedValue([
      { id: 'R1', ownerId: 'u1', teamName: 'Aces', players: [p('soph', 'taxi'), p('healed', 'IR')] },
    ])
  })

  it('moves to the bench guarded on the slot it read, never deletes, and records the outcome', async () => {
    const out = await runDynastyRolloverHousekeeping('L', 'y2', new Date('2026-09-01T00:00:00Z'))
    expect(m.playerUpdateMany).toHaveBeenCalledWith({
      where: { id: 'row-soph', droppedAt: null, slotType: 'taxi' },
      data: { slotType: 'bench' },
    })
    expect(m.playerUpdateMany).toHaveBeenCalledWith({
      where: { id: 'row-healed', droppedAt: null, slotType: 'IR' },
      data: { slotType: 'bench' },
    })
    expect(m.playerDelete).not.toHaveBeenCalled()
    expect(out?.movedToBench).toHaveLength(2)
    const written = m.leagueUpdate.mock.calls[0][0].data.lifecycleMetadata.dynastyRollover
    expect(written).toMatchObject({ seasonId: 'y2', needsCutDown: [] })
    expect(written.movedToBench).toHaveLength(2)
  })

  it('reports a move a manager beat it to as not applied', async () => {
    m.playerUpdateMany.mockResolvedValue({ count: 0 })
    const out = await runDynastyRolloverHousekeeping('L', 'y2')
    expect(out?.movedToBench).toEqual([])
  })

  it('treats two sources that disagree about experience as unknown', async () => {
    m.sportsPlayerFindMany.mockResolvedValue([
      { id: 'a', externalId: 'soph', sleeperId: null, yearsExp: 1 },
      { id: 'b', externalId: 'soph', sleeperId: null, yearsExp: 0 },
    ])
    m.rosterFindMany.mockResolvedValue([{ id: 'R1', ownerId: 'u1', teamName: 'Aces', players: [p('soph', 'taxi')] }])
    const out = await runDynastyRolloverHousekeeping('L', 'y2')
    expect(out?.movedToBench).toEqual([])
    expect(out?.taxiUnverified).toBe(1)
  })
})

describe('afterDynastyNewSeasonActivated', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.seasonFindUnique.mockResolvedValue({ createdAt: new Date('2026-02-01T00:00:00Z'), sport: 'NFL' })
    m.rosterFindMany.mockResolvedValue([])
  })

  it('is a no-op for a redraft or keeper league', async () => {
    // A prior completed season exists, so only the format check can stop it.
    m.seasonFindFirst.mockResolvedValue({ id: 'y1' })
    for (const league of [{ leagueType: 'redraft', isDynasty: false }, { leagueType: 'keeper', isDynasty: false }]) {
      m.leagueFindUnique.mockResolvedValueOnce(league)
      expect(await afterDynastyNewSeasonActivated('L', 'y2')).toBeNull()
    }
    expect(m.leagueUpdate).not.toHaveBeenCalled()
    expect(m.rosterFindMany).not.toHaveBeenCalled()
  })

  it('is a no-op for a dynasty league in its first season', async () => {
    m.leagueFindUnique.mockResolvedValueOnce({ leagueType: 'dynasty', isDynasty: true })
    m.seasonFindFirst.mockResolvedValueOnce(null)
    expect(await afterDynastyNewSeasonActivated('L', 'y1')).toBeNull()
    expect(m.leagueUpdate).not.toHaveBeenCalled()
  })

  it('runs for a dynasty season that follows a completed one, and ends the offseason phase', async () => {
    m.leagueFindUnique.mockResolvedValueOnce({ leagueType: 'devy', isDynasty: false }).mockResolvedValue(LEAGUE)
    m.seasonFindFirst.mockResolvedValueOnce({ id: 'y1' })
    const out = await afterDynastyNewSeasonActivated('L', 'y2')
    expect(out).not.toBeNull()
    expect(m.leagueUpdate).toHaveBeenCalledWith({ where: { id: 'L' }, data: { dynastySeasonPhase: 'regular' } })
  })
})
