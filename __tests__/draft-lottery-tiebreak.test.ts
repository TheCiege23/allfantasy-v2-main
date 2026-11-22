import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 THE LOTTERY TIEBREAK READ IN TWO DIRECTIONS (fixed 2026-10-29).
 *
 * `applyTiebreak` sorted a tied rank by the tiebreak value ASCENDING, so with `lower_points_for` the
 * lower-PF team came FIRST in the best-first list. The pool (`worstOf`) and the fallback order read
 * "first within a tie" as the WORSE finish; the playoff split (`slice(playoffTeamCount)`) read it as
 * the BETTER one and put that team inside the playoff line. One tiebreak, two meanings.
 *
 * Now the meaning comes from the setting names: the team that scored less is the worse finish. It
 * sorts LAST within its tie, misses the playoff line, is counted into the pool on the lottery line,
 * picks first in the fallback order, and is the later row in the draw's input order.
 *
 * Every case below asks all of those readers about the SAME tied pair and asserts they agree.
 *
 * When ranks really tie: `getStandingsForLottery` carries `LeagueTeam.currentRank`, and every writer
 * of it stamps a unique `index + 1` (standingsEngine seeds, sleeper-sync, the Sleeper bootstrap). A
 * tie appears when that column is PARTLY null — `renewNativeRedraft` nulls it, the standings mirror
 * writes only the teams whose roster resolves — because a null falls back to the team's position in
 * id order (`i + 1`), which can equal another team's stored rank. The Standings-table preview and the
 * scenario explainer feed table seeds, which never tie.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique } } }))

import {
  applyTiebreak,
  buildEligibleTeamsWithOdds,
  getStandingsForLottery,
  selectEligibleTeams,
  type StandingsRow,
} from '@/lib/draft-lottery/standingsForLottery'
import { buildFullSlotOrder, runWeightedDraw } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import type { LotteryTiebreakMode } from '@/lib/draft-lottery/types'

const row = (rosterId: string, rank: number, pointsFor: number, maxPf = pointsFor): StandingsRow => ({
  rosterId, displayName: rosterId, teamIndex: 0, rank, wins: 0, losses: 0, ties: 0, pointsFor, maxPf,
})

/**
 * Eight teams, two tied at rank 4 — straddling a 4-team playoff line and a 4-team lottery line.
 * `lowPf` scored fewer points but has the HIGHER max PF, so `lower_points_for` and `lower_max_pf`
 * disagree about which of the two is worse.
 */
function league(): StandingsRow[] {
  return [
    row('r8', 8, 1100),
    row('lowPf', 4, 1500, 1800),
    row('r1', 1, 1900),
    row('r6', 6, 1300),
    row('highPf', 4, 1600, 1700),
    row('r3', 3, 1700),
    row('r7', 7, 1200),
    row('r2', 2, 1800),
  ]
}

const TIED = new Set(['lowPf', 'highPf'])

/** Which of the tied pair each reader treats as the WORSE finish. */
function worseByEveryReader(rows: StandingsRow[]) {
  const pick = (ids: string[]) => {
    const hit = ids.filter((id) => TIED.has(id))
    expect(hit, `exactly one of the tied pair: ${ids.join(',')}`).toHaveLength(1)
    return hit[0]
  }
  const ids = (rs: { rosterId: string }[]) => rs.map((r) => r.rosterId)
  // The best-first order itself: the worse team of the tie is the LATER row.
  const order = ids(rows).filter((id) => TIED.has(id))
  const sortOrder = order[1]
  // The playoff split: the team left OUTSIDE a 4-team line (the pool takes everyone outside it).
  const nonPlayoff = pick(ids(selectEligibleTeams(rows, 'non_playoff', 8, 4)))
  // The lottery line: the worst 4 of the league.
  const bottomN = pick(ids(selectEligibleTeams(rows, 'bottom_n', 4, 4)))
  const allTeams = pick(ids(selectEligibleTeams(rows, 'all_teams', 4, 4)))
  // The fallback order: of the tied pair, the one seated FIRST (nobody drawn, no playoff line).
  const fallback = ids(buildFullSlotOrder([], rows, new Set(), 'reverse_standings', 0)).filter((id) => TIED.has(id))[0]
  // The draw's input order (originalOrder): the worse team is the later entry, as in the best-first list.
  const eligible = buildEligibleTeamsWithOdds(selectEligibleTeams(rows, 'all_teams', 8, 0), 'inverse_standings')
  const draws = runWeightedDraw(eligible, eligible.length, 'any-seed')
  const original = draws.filter((d) => TIED.has(d.rosterId)).sort((a, b) => a.originalOrder - b.originalOrder)
  const drawInput = original[1].rosterId
  return { sortOrder, nonPlayoff, bottomN, allTeams, fallback, drawInput }
}

const sorted = (mode: LotteryTiebreakMode, seed = 'seed', rows = league()) => {
  applyTiebreak(rows, mode, seed)
  return rows
}

beforeEach(() => vi.clearAllMocks())

describe('every reader agrees which team of a tie is worse', () => {
  it.each([
    ['lower_points_for', 'lowPf'],
    ['lower_max_pf', 'highPf'],
    // Points for first, so the draw never gets a say here.
    ['seeded_random', 'lowPf'],
  ] as const)('%s → %s is the worse finish everywhere', (mode, worse) => {
    const r = worseByEveryReader(sorted(mode))
    expect(r).toEqual({ sortOrder: worse, nonPlayoff: worse, bottomN: worse, allTeams: worse, fallback: worse, drawInput: worse })
  })

  it('🛑 at the playoff line the worse team is OUTSIDE it — the old code put the lower-PF team in the playoffs', () => {
    const rows = sorted('lower_points_for')
    const pool = selectEligibleTeams(rows, 'non_playoff', 8, 4).map((r) => r.rosterId)
    expect(pool).toEqual(['lowPf', 'r6', 'r7', 'r8'])
    expect(pool).not.toContain('highPf')
  })

  it('the playoff line is read off the order, not off the list position, so an unsorted caller gets the same pool', () => {
    // A caller that has not sorted (league() is shuffled): the best four by rank are still the playoff teams.
    const pool = selectEligibleTeams(league(), 'non_playoff', 8, 3).map((r) => r.rosterId)
    expect(pool.sort()).toEqual(['highPf', 'lowPf', 'r6', 'r7', 'r8'])
  })

  it('the best-first order the readers are handed', () => {
    expect(sorted('lower_points_for').map((r) => r.rosterId)).toEqual(['r1', 'r2', 'r3', 'highPf', 'lowPf', 'r6', 'r7', 'r8'])
    expect(sorted('lower_max_pf').map((r) => r.rosterId)).toEqual(['r1', 'r2', 'r3', 'lowPf', 'highPf', 'r6', 'r7', 'r8'])
  })

  it('reverse_max_pf fallback: a Max PF tie between two non-playoff teams goes to the worse finish', () => {
    // Same max PF, so only the tiebreak separates them; both sit outside a 2-team line.
    const rows = sorted('lower_points_for', 's', [row('r1', 1, 1900), row('r2', 2, 1800), row('hi', 3, 1600, 1500), row('lo', 3, 1400, 1500), row('r5', 5, 1300, 1600)])
    const order = buildFullSlotOrder([], rows, new Set(), 'reverse_max_pf', 2).map((s) => s.rosterId)
    expect(order).toEqual(['lo', 'hi', 'r5', 'r2', 'r1'])
  })

  it('tied ranks share a weight under inverse_standings: the tiebreak orders, it does not reweigh', () => {
    const eligible = buildEligibleTeamsWithOdds(selectEligibleTeams(sorted('lower_points_for'), 'all_teams', 8, 0), 'inverse_standings')
    const w = Object.fromEntries(eligible.map((e) => [e.rosterId, e.weight]))
    expect(w.lowPf).toBe(w.highPf)
  })
})

describe('seeded_random', () => {
  const evenPair = () => [row('r1', 1, 1900), row('a', 2, 1500), row('r3', 3, 1300), row('b', 2, 1500), row('r4', 4, 1200)]
  const worseOf = (seed: string, rows = evenPair()) => {
    applyTiebreak(rows, 'seeded_random', seed)
    return rows.map((r) => r.rosterId).filter((id) => id === 'a' || id === 'b')[1]
  }

  it('one seed, one answer — whatever order the rows arrive in', () => {
    for (const seed of ['s1', 's2', 'league:rookie-draft:2027']) {
      const reversed = evenPair().reverse()
      expect(worseOf(seed, reversed), seed).toBe(worseOf(seed))
    }
  })

  it('different seeds settle the same tie both ways', () => {
    const outcomes = new Set(Array.from({ length: 40 }, (_, i) => worseOf(`seed-${i}`)))
    expect(outcomes).toEqual(new Set(['a', 'b']))
  })

  it('and every reader agrees with the draw', () => {
    for (let i = 0; i < 20; i++) {
      const rows = evenPair()
      applyTiebreak(rows, 'seeded_random', `seed-${i}`)
      const worse = worseOf(`seed-${i}`)
      // The playoff line falls between the pair (r1 + one of them): the worse is the one outside it.
      expect(selectEligibleTeams(rows, 'non_playoff', 5, 2).map((r) => r.rosterId)).toContain(worse)
      expect(selectEligibleTeams(rows, 'bottom_n', 3, 0).map((r) => r.rosterId)).toContain(worse)
      const fallback = buildFullSlotOrder([], rows, new Set(), 'reverse_standings', 0).map((s) => s.rosterId)
      expect(fallback.indexOf(worse)).toBeLessThan(fallback.indexOf(worse === 'a' ? 'b' : 'a'))
    }
  })
})

describe('a tie as it actually arises: a partly-null currentRank', () => {
  it('a team with no stored rank falls back to its position, ties a ranked team, and the tiebreak settles it', async () => {
    // Teams by id: t1 has no rank (→ 1, its position), t3 is stored as rank 1. They tie at rank 1.
    const team = (id: string, currentRank: number | null, pointsFor: number) => ({
      id, externalId: `r-${id}`, claimedByUserId: null, platformUserId: null, ownerName: id, teamName: id,
      wins: 0, losses: 0, ties: 0, pointsFor, currentRank,
    })
    findUnique.mockResolvedValue({
      leagueSize: 4,
      settings: {},
      rosters: ['r-t1', 'r-t2', 'r-t3', 'r-t4'].map((id) => ({ id, platformUserId: null })),
      teams: [team('t1', null, 1400), team('t2', 2, 1500), team('t3', 1, 1600), team('t4', 4, 1000)],
    })
    const rows = await getStandingsForLottery('L')
    expect(rows.filter((r) => r.rank === 1).map((r) => r.rosterId).sort()).toEqual(['r-t1', 'r-t3'])
    applyTiebreak(rows, 'lower_points_for', 's')
    // t1 scored less, so it is the worse of the tie: second, behind t3, and outside a 1-team playoff line.
    expect(rows.map((r) => r.rosterId)).toEqual(['r-t3', 'r-t1', 'r-t2', 'r-t4'])
    expect(selectEligibleTeams(rows, 'non_playoff', 4, 1).map((r) => r.rosterId)).toEqual(['r-t1', 'r-t2', 'r-t4'])
  })
})
