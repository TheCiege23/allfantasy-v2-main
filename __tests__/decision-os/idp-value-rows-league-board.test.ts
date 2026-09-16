/**
 * @vitest-environment node
 *
 * The Decision OS trade path must price a traded defender against the WHOLE LEAGUE's board.
 *
 * 🛑 THE BUG THIS PINS. `resolveTradeEnrichment` hands `loadIdpValue` the TRADE's player ids, and
 * `loadIdpValueRows` used to pass exactly those to `loadLeagueIdpVorp` as the league's roster. A
 * board of two or three players has no replacement level — the replacement player is the first
 * NON-starter, and every traded defender is a starter on a board that small — so nobody was
 * priced. Measured on staging 2026-09-16: 0 IDP values across all 9 real trades with a priced
 * defender, on the evaluator path, the roster-impact variant and the capture path alike.
 *
 * `idpTradeValues.ts` (the trade evaluator) always built its board from the league's rosters; the
 * memory note for this stack names it an invariant. This drives the real `loadIdpValueRows`, the
 * real `priceIdpBoard` and the real `buildIdpValuations`; only the database and the projection
 * loader are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// A 2-team league starting one LB, one DL and one DB each. Positions and projected points:
const PLAYERS: Record<string, { position: string; points: number }> = {
  lb1: { position: 'LB', points: 20 }, lb2: { position: 'LB', points: 15 }, lb3: { position: 'LB', points: 10 },
  dl1: { position: 'DL', points: 12 }, dl2: { position: 'DL', points: 9 }, dl3: { position: 'DL', points: 4 },
  db1: { position: 'DB', points: 11 }, db2: { position: 'DB', points: 8 }, db3: { position: 'DB', points: 3 },
  wr1: { position: 'WR', points: 18 },
}
const ROSTERS = [
  { id: 'rA', playerData: { players: ['lb1', 'lb2', 'dl1', 'db1', 'db3', 'wr1'] } },
  { id: 'rB', playerData: { players: ['lb3', 'dl2', 'dl3', 'db2'] } },
]
const SCORING = { scoring_settings: { idp_tkl_solo: 1, idp_sack: 2 } }

const calls: { projectedFor: string[][] } = { projectedFor: [] }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'L1' ? { id: 'L1', settings: SCORING } : null),
      findFirst: vi.fn(async ({ where }: { where: { platformLeagueId: string } }) =>
        where.platformLeagueId === 'sleeper-L1' ? { id: 'L1', settings: SCORING } : null),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: { leagueId: string } }) =>
        where.leagueId === 'L1'
          ? ROSTERS.map((r) => ({ ...r, platformUserId: `u-${r.id}`, faabRemaining: null, waiverPriority: null, settings: null }))
          : []),
    },
    redraftRoster: { findMany: vi.fn(async () => []) },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.filter((id) => PLAYERS[id]).map((id) => ({ sleeperId: id, position: PLAYERS[id].position }))),
    },
    playerGameStat: {
      aggregate: vi.fn(async ({ _max }: { _max: Record<string, boolean> }) =>
        _max.season ? { _max: { season: 2025 } } : { _max: { weekOrRound: 4 } }),
    },
  },
}))

vi.mock('@/lib/idp-projections/loadIdpProjections', () => ({
  loadIdpProjections: vi.fn(async ({ players }: { players: Array<{ sleeperId: string }> }) => {
    calls.projectedFor.push(players.map((p) => p.sleeperId).sort())
    return {
      bySleeperId: new Map(
        players.map((p) => [p.sleeperId, { ok: true, statLine: { idp_tkl_solo: PLAYERS[p.sleeperId].points } }]),
      ),
    }
  }),
}))

import { prisma } from '@/lib/prisma'
import { loadIdpValueRows } from '@/lib/decision-os/world/port'
import { clearIdpBoardMemo } from '@/lib/idp-projections/idpBoardMemo'

const ARGS = { leagueId: 'L1', starterSlots: ['QB', 'WR', 'LB', 'DL', 'DB'], numTeams: 2, isDynasty: true }

beforeEach(() => {
  calls.projectedFor = []
  clearIdpBoardMemo()
  vi.mocked(prisma!.roster.findMany).mockClear()
})

describe('loadIdpValueRows prices traded defenders against the whole league', () => {
  it('prices a traded defender that a trade-only board could not', async () => {
    // lb1 and dl1 alone: each is the only player at his position, so no replacement level exists.
    const rows = await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb1', 'dl1'] })
    const byId = new Map(rows.map((r) => [r.sleeperId, r]))
    expect(byId.get('lb1')?.value).toBeGreaterThan(0)
    expect(byId.get('dl1')?.value).toBeGreaterThan(0)
    // Against the league: lb1 (20) over the LB replacement lb3 (10), dl1 (12) over dl3 (4).
    expect(byId.get('lb1')?.vorp).toBe(10)
    expect(byId.get('dl1')?.vorp).toBe(8)
  })

  it('projects every rostered defender in the league, not just the traded ones', async () => {
    await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb1'] })
    expect(calls.projectedFor.at(-1)).toEqual(['db1', 'db2', 'db3', 'dl1', 'dl2', 'dl3', 'lb1', 'lb2', 'lb3'])
  })

  it('returns rows for the requested ids only, even though the board is the league', async () => {
    const rows = await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb1', 'wr1'] })
    expect(rows.map((r) => r.sleeperId)).toEqual(['lb1'])
  })

  it('ranks against the league: the same defender gets the same value whatever else is traded', async () => {
    const alone = (await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb2'] }))[0]
    const withStar = (await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb2', 'lb1'] })).find((r) => r.sleeperId === 'lb2')
    expect(alone?.value).toBeGreaterThan(0)
    expect(withStar?.value).toBe(alone?.value)
  })

  it('accepts the platform id space too, as loadLeagueIdpVorp does', async () => {
    const rows = await loadIdpValueRows({ ...ARGS, leagueId: 'sleeper-L1', sleeperIds: ['lb1'] })
    expect(rows[0]?.vorp).toBe(10)
  })

  it('prices the league once for several trades in a row', async () => {
    // The trades panel grades every pending offer in a league; each would otherwise re-project it.
    await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb1'] })
    await loadIdpValueRows({ ...ARGS, sleeperIds: ['dl2', 'wr1'] })
    await Promise.all([
      loadIdpValueRows({ ...ARGS, sleeperIds: ['db1'] }),
      loadIdpValueRows({ ...ARGS, sleeperIds: ['lb3'] }),
    ])
    expect(calls.projectedFor).toHaveLength(1)
  })

  it('does not serve a dynasty board to a redraft question, or the reverse', async () => {
    const dynasty = (await loadIdpValueRows({ ...ARGS, isDynasty: true, sleeperIds: ['lb1'] }))[0]
    const redraft = (await loadIdpValueRows({ ...ARGS, isDynasty: false, sleeperIds: ['lb1'] }))[0]
    expect(dynasty?.value).toBeGreaterThan(0)
    expect(redraft?.value).toBeGreaterThan(0)
    expect(redraft?.value).not.toBe(dynasty?.value)
  })

  it('still prices a requested defender who is on no roster, on a board that includes him', async () => {
    PLAYERS.lb4 = { position: 'LB', points: 30 }
    try {
      // Warm the league's board first: a memo keyed without him would serve it back.
      await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb1'] })
      const rows = await loadIdpValueRows({ ...ARGS, sleeperIds: ['lb4'] })
      expect(calls.projectedFor.at(-1)).toContain('lb4')
      expect(rows[0]?.sleeperId).toBe('lb4')
      expect(rows[0]?.value).toBeGreaterThan(0)
    } finally {
      delete PLAYERS.lb4
    }
  })

  it('reads no roster and projects nobody for a league that does not score IDP', async () => {
    const rows = await loadIdpValueRows({ ...ARGS, leagueId: 'not-a-league', sleeperIds: ['lb1'] })
    expect(rows).toEqual([])
    expect(calls.projectedFor).toEqual([])
    expect(prisma.roster.findMany).not.toHaveBeenCalled()
  })
})
