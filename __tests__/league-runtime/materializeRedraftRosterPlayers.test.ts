/**
 * Projecting `Roster.playerData` into `RedraftRosterPlayer`.
 *
 * 🛑 THE GAP THIS CLOSES. `canonicalSeasonMaterialization` created a `RedraftRoster` per team and
 * stopped. Every writer of `RedraftRosterPlayer` is a transaction path — draft finalisation,
 * waivers, keeper carryover, the devy merge, the IDP bridge — and none of those runs on an imported
 * league. So an imported roster was materialised empty and stayed empty. Measured on production
 * 2026-09-04:
 *
 *     redraft rosters with NO players    3,039 of 3,130  (97%)
 *     guillotine / zombie / survivor     100% of them
 *
 * `captureSnapshot` builds its team profile from `roster.players` and reads their positions to
 * judge depth, so an empty roster produced no profile and the trade verdict fell back to "we could
 * not price enough of this deal". The valuation was fine. There was nothing to value.
 *
 * 🛑 AND THE FIRST FIX FOR THAT WAS WORSE THAN THE GAP, WHICH IS WHAT MOST OF THIS FILE NOW PINS.
 * It enriched through `getNormalizedPlayerData(...)` inside a bare `try {} catch {}`. Measured
 * against a real league that call returned ZERO rows, the catch said nothing, and the fallback
 * `playerName: dto?.name ?? playerId` wrote the Sleeper id as the player's NAME — 58,596 rows,
 * 96.2% of the table, each counted as "created" and reported as a successful backfill. Downstream
 * values are looked up BY NAME, so nothing on those rosters could be priced: the verdict went on
 * saying it had too little to judge, from a table that now looked full.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  leagueFindUnique: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  rrpFindMany: vi.fn(),
  rrpCreate: vi.fn(),
  rrpUpdateMany: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: h.rosterFindMany },
    league: { findUnique: h.leagueFindUnique },
    sportsPlayer: { findMany: h.sportsPlayerFindMany },
    redraftRosterPlayer: {
      findMany: h.rrpFindMany,
      create: h.rrpCreate,
      updateMany: h.rrpUpdateMany,
    },
  },
}))
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  reconcileRosterRedraftLinks: h.reconcile,
}))
/*
 * `externalIdNamespace` is deliberately NOT mocked. It is pure, and it is the thing whose contract
 * this module got wrong — mocking it would let the impostor lookup back in under a green test.
 */

import { materializeRedraftRosterPlayersForLeague } from '@/lib/league-runtime/materializeRedraftRosterPlayers'

beforeEach(() => {
  vi.resetAllMocks()
  h.reconcile.mockResolvedValue({ linked: 0, unlinked: 0, alreadyLinked: 0 })
  h.rrpFindMany.mockResolvedValue([])
  h.rrpCreate.mockResolvedValue({})
  h.rrpUpdateMany.mockResolvedValue({ count: 0 })
  h.leagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper' })
  h.sportsPlayerFindMany.mockResolvedValue([])
})

const roster = (over: Record<string, unknown> = {}) => ({
  id: 'roster-a',
  platformUserId: 'user-a',
  redraftRosterId: 'rr-a',
  playerData: { players: ['p1', 'p2'], starters: ['p1'], lineup_sections: { starters: ['p1'], bench: ['p2'] } },
  ...over,
})

const sp = (over: Record<string, unknown> = {}) => ({
  sleeperId: 'p1',
  name: 'Perry Vance',
  position: 'WR',
  team: 'GB',
  sport: 'NFL',
  source: 'sleeper',
  injuryStatus: null,
  ...over,
})

describe('the projection', () => {
  it('creates a row per player the redraft roster is missing', async () => {
    h.rosterFindMany.mockResolvedValue([roster()])
    h.sportsPlayerFindMany.mockResolvedValue([
      sp(),
      sp({ sleeperId: 'p2', name: 'Dana Okoye', position: 'LB', team: 'CHI', injuryStatus: 'Q' }),
    ])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersCreated).toBe(2)
    expect(out.rostersLinked).toBe(1)
    expect(h.rrpCreate).toHaveBeenCalledTimes(2)
    expect(h.rrpCreate.mock.calls[0][0].data).toMatchObject({
      rosterId: 'rr-a', playerId: 'p1', playerName: 'Perry Vance', team: 'GB',
      acquisitionType: 'imported',
    })
  })

  it("🛑 a starter's slot is their POSITION, matching what is already in the column", async () => {
    /*
     * Confirmed against production, where WR/RB/QB/TE/DEF/K all appear as slotType values beside
     * bench/taxi/ir. `normalizeSlotType` in the draft path does the same. Writing the literal
     * "starter" here would split one column between two vocabularies.
     */
    h.rosterFindMany.mockResolvedValue([roster()])
    h.sportsPlayerFindMany.mockResolvedValue([
      sp(),
      sp({ sleeperId: 'p2', name: 'Dana Okoye', position: 'LB', team: 'CHI' }),
    ])

    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.rrpCreate.mock.calls.map((c) => c[0].data.slotType)).toEqual(['WR', 'bench'])
  })

  it('maps ir and taxi from the top-level arrays when no section names them', async () => {
    h.rosterFindMany.mockResolvedValue([
      roster({ playerData: { players: ['p1', 'p2'], reserve: ['p1'], taxi: ['p2'] } }),
    ])
    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.rrpCreate.mock.calls.map((c) => c[0].data.slotType)).toEqual(['ir', 'taxi'])
  })

  it('🛑 writes the player even when enrichment finds nothing', async () => {
    /*
     * A provider gap must not keep a roster empty. An unknown position is a worse profile than a
     * known one and a far better one than a missing player.
     *
     * ⚠ THE ROW STILL CARRIES THE ID AS ITS NAME HERE, AND THAT IS THE HONEST RESIDUE, NOT THE BUG.
     * The bug was that this was the case for 96.2% of the table because the lookup itself was
     * broken. With the lookup fixed it is the rare genuinely-unknown player — and `position: 'UNK'`
     * is what marks him as such.
     */
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.sportsPlayerFindMany.mockResolvedValue([])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersCreated).toBe(1)
    expect(h.rrpCreate.mock.calls[0][0].data).toMatchObject({
      playerId: 'p1', playerName: 'p1', position: 'UNK', slotType: 'bench',
    })
  })

  it('survives the enrichment query throwing', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.sportsPlayerFindMany.mockRejectedValue(new Error('db down'))

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersCreated).toBe(1)
  })
})

describe('🛑 the lookup is by sleeperId, and that is the whole point', () => {
  it('never puts a bare roster id against externalId', async () => {
    /*
     * `lib/player-identity/externalIdNamespace.ts` measured 42,032 numeric ids that exist in BOTH
     * the Sleeper space and a provider space, of which 42,031 are a DIFFERENT PERSON. Probed on a
     * real league's own 241 ids: `sleeperIdWhere` matched 241/241; a bare `externalId` lookup
     * matched 121 and NONE of them was the same human — Justin Herbert came back as "Damone Clark",
     * Geno Smith as an NBA player. This repo has already shipped that mistake twice, once serving
     * 211 players another player's photograph.
     */
    h.rosterFindMany.mockResolvedValue([roster()])

    await materializeRedraftRosterPlayersForLeague('L1')

    const where = h.sportsPlayerFindMany.mock.calls[0][0].where
    const json = JSON.stringify(where)
    expect(json).toContain('sleeperId')
    // Any externalId branch must carry the namespaced spelling, never the bare id.
    const bare = /"externalId":\{"in":\[([^\]]*)\]/.exec(json)
    if (bare) {
      expect(bare[1]).not.toMatch(/"p1"/)
      expect(bare[1]).toContain('sleeper:')
    }
  })

  it('scopes the lookup to the sport', async () => {
    // externalId is unique only within a sport, and Geno Smith's id collided with an NBA player's.
    h.rosterFindMany.mockResolvedValue([roster()])
    h.leagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper' })

    await materializeRedraftRosterPlayersForLeague('L1')

    expect(JSON.stringify(h.sportsPlayerFindMany.mock.calls[0][0].where)).toContain('NFL')
  })

  it('🛑 does not run the Sleeper lookup for a non-Sleeper league', async () => {
    /*
     * An ESPN or Fantrax roster holds that platform's ids. Feeding them to a Sleeper-keyed lookup
     * is the same class of error as the externalId collision — a match would be a coincidence, and
     * a coincidence here writes the wrong player's name onto someone's roster.
     */
    h.rosterFindMany.mockResolvedValue([roster()])
    h.leagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'espn' })

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(h.sportsPlayerFindMany).not.toHaveBeenCalled()
    expect(out.playersCreated).toBe(2) // still materialised, just unenriched
  })

  it('prefers the sleeper-sourced row when several sources hold the same player', async () => {
    /*
     * 241 ids returned 570 rows on the measured league — one per source, the same person, but
     * disagreeing about SHAPE. Only `sleeper` writes a team ABBREVIATION (232/241), and the team
     * logo is looked up by abbreviation; rolling_insights wrote "Washington Commanders" in 0/174
     * abbreviated form, thesportsdb wrote "Running Back" for a position.
     */
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.sportsPlayerFindMany.mockResolvedValue([
      sp({ source: 'thesportsdb', position: 'Wide Receiver', team: 'Green Bay Packers' }),
      sp({ source: 'rolling_insights', position: 'WR', team: 'Green Bay Packers' }),
      sp({ source: 'sleeper', position: 'WR', team: 'GB' }),
    ])

    await materializeRedraftRosterPlayersForLeague('L1')

    expect(h.rrpCreate.mock.calls[0][0].data).toMatchObject({ position: 'WR', team: 'GB' })
  })

  it('does one lookup for the whole league, not one per roster', async () => {
    h.rosterFindMany.mockResolvedValue([roster(), roster({ id: 'roster-b', redraftRosterId: 'rr-b' })])
    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.sportsPlayerFindMany).toHaveBeenCalledTimes(1)
  })
})

describe('🛑 repairing the rows the broken version wrote', () => {
  it('updates an existing row whose name is still the id', async () => {
    /*
     * The create-only version skipped every one of the 58,596 rows it had itself written wrong, so
     * re-running the backfill reported "already present" and changed nothing. Without this the bug
     * was permanent.
     */
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.rrpFindMany.mockResolvedValue([{ playerId: 'p1' }])
    h.sportsPlayerFindMany.mockResolvedValue([sp()])
    h.rrpUpdateMany.mockResolvedValue({ count: 1 })

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersRepaired).toBe(1)
    expect(out.playersCreated).toBe(0)
    const call = h.rrpUpdateMany.mock.calls[0][0]
    expect(call.where).toMatchObject({ rosterId: 'rr-a', playerId: 'p1', playerName: 'p1' })
    expect(call.data).toMatchObject({ playerName: 'Perry Vance', position: 'WR', team: 'GB' })
  })

  it('🛑 the update is scoped to rows still carrying the id-as-name signature', async () => {
    /*
     * A row a redraft engine enriched properly must not be overwritten from `Roster.playerData`,
     * which can be stale. `playerName: playerId` in the WHERE is what keeps this a repair of this
     * module's own damage rather than a second writer competing for the column.
     */
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.rrpFindMany.mockResolvedValue([{ playerId: 'p1' }])
    h.sportsPlayerFindMany.mockResolvedValue([sp()])
    h.rrpUpdateMany.mockResolvedValue({ count: 0 }) // nothing matched the signature

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(h.rrpUpdateMany.mock.calls[0][0].where.playerName).toBe('p1')
    expect(out.playersRepaired).toBe(0)
    expect(out.playersAlreadyPresent).toBe(1)
  })

  it('does not attempt a repair when it has nothing better to write', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: ['p1'] } })])
    h.rrpFindMany.mockResolvedValue([{ playerId: 'p1' }])
    h.sportsPlayerFindMany.mockResolvedValue([])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(h.rrpUpdateMany).not.toHaveBeenCalled()
    expect(out.playersAlreadyPresent).toBe(1)
  })
})

describe('🛑 what it refuses to do', () => {
  it('skips and REPORTS a roster with no link rather than writing nowhere', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ redraftRosterId: null })])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out).toMatchObject({ rostersSkippedNoLink: 1, rostersLinked: 0, playersCreated: 0 })
    expect(h.rrpCreate).not.toHaveBeenCalled()
  })

  it('skips and reports a genuinely empty roster', async () => {
    h.rosterFindMany.mockResolvedValue([roster({ playerData: { players: [] } })])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out).toMatchObject({ rostersSkippedNoPlayers: 1, playersCreated: 0 })
  })

  it('🛑 never re-creates a player the redraft engines already own', async () => {
    /*
     * Create-only for NEW rows, deliberately. `Roster.playerData` can be stale — a player traded or
     * waived through a redraft engine may still sit in it — and resurrecting him would make the
     * generic roster silently override the engine that owns the roster now.
     */
    h.rosterFindMany.mockResolvedValue([roster()])
    h.rrpFindMany.mockResolvedValue([{ playerId: 'p1' }])

    const out = await materializeRedraftRosterPlayersForLeague('L1')

    expect(out.playersAlreadyPresent).toBe(1)
    expect(out.playersCreated).toBe(1)
    expect(h.rrpCreate.mock.calls.map((c) => c[0].data.playerId)).toEqual(['p2'])
  })

  it('reconciles links first, since there is nowhere to write without them', async () => {
    h.rosterFindMany.mockResolvedValue([])
    await materializeRedraftRosterPlayersForLeague('L1')
    expect(h.reconcile).toHaveBeenCalledWith('L1')
  })

  it('does nothing on a league with no rosters', async () => {
    h.rosterFindMany.mockResolvedValue([])
    const out = await materializeRedraftRosterPlayersForLeague('L1')
    expect(out.rostersConsidered).toBe(0)
    expect(h.rrpCreate).not.toHaveBeenCalled()
  })
})
