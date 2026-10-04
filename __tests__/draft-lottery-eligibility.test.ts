import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 THE LOTTERY POOL KEPT THE BEST NON-PLAYOFF TEAMS AND DROPPED THE WORST ONES.
 *
 * The rows reaching `selectEligibleTeams` are BEST-first: `getStandingsForLottery` carries
 * `LeagueTeam.currentRank` as `rank` (1 = best — every standings read in the repo orders it
 * `currentRank asc`, beside `pointsFor desc`), and `applyTiebreak` sorts rank ascending. The
 * Standings screen's preview builds the same shape from the table's seeds. `non_playoff` then took
 * `eligible.slice(0, lotteryTeamCount)` and `all_teams` took `rows.slice(0, N)`: the TOP of the
 * list. With more teams outside the playoff line than lottery places — 12 teams, 4 make the
 * playoffs, 6 in the lottery — the two worst records in the league got no lottery ticket at all.
 *
 * The fixtures pin the order rather than assume it: rank 1 has the best record, the team ids are
 * deliberately NOT in rank order, and the first test asserts what order the engine actually sees.
 */

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique } } }))

import {
  applyTiebreak,
  getStandingsForLottery,
  selectEligibleTeams,
  type StandingsRow,
} from '@/lib/draft-lottery/standingsForLottery'
import { previewLotteryOdds, runWeightedLottery } from '@/lib/draft-lottery/WeightedDraftLotteryEngine'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG, type WeightedLotteryConfig } from '@/lib/draft-lottery/types'
import { buildDraftOrderPreview } from '@/lib/core-app/standingsDraftOrder'
import type { StandingsBoard } from '@/lib/core-app/standingsModel'

/** Team ids in an order that disagrees with rank, so id order can never pass for standings order. */
const ID_ORDER = [5, 11, 2, 8, 12, 1, 7, 3, 10, 6, 9, 4]

/** A 12-team league: rank r is 13-r wins, r-1 losses — rank 1 is the best record, rank 12 the worst. */
const leagueTeam = (rank: number) => ({
  id: `t${String(ID_ORDER.indexOf(rank)).padStart(2, '0')}`,
  externalId: `r${rank}`,
  claimedByUserId: null,
  platformUserId: null,
  ownerName: `Owner ${rank}`,
  teamName: `Rank ${rank}`,
  wins: 13 - rank,
  losses: rank - 1,
  ties: 0,
  pointsFor: 2000 - 40 * rank,
  currentRank: rank,
})

const LEAGUE = {
  leagueSize: 12,
  settings: { playoff_team_count: 4 },
  rosters: Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, platformUserId: null })).sort((a, b) =>
    a.id.localeCompare(b.id),
  ),
  teams: ID_ORDER.map(leagueTeam).sort((a, b) => a.id.localeCompare(b.id)),
}

const CONFIG: WeightedLotteryConfig = { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true }

const rankOf = (rosterId: string) => Number(rosterId.slice(1))
const WORST_SIX = [7, 8, 9, 10, 11, 12]

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(LEAGUE)
})

describe('the order selectEligibleTeams is handed', () => {
  it('is best-first: after the tiebreak, rank 1 (the best record) leads and rank 12 trails', async () => {
    const rows = await getStandingsForLottery('L1')
    // Straight off the query the rows follow team-id order, which is not standings order.
    expect(rows.map((r) => r.rank)).not.toEqual([...rows.map((r) => r.rank)].sort((a, b) => a - b))

    applyTiebreak(rows, CONFIG.tiebreakMode, 'seed')
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(rows[0].wins).toBe(12)
    expect(rows[11].wins).toBe(1)
  })
})

describe('weighted lottery eligibility — 12 teams, 4 make the playoffs, 6 in the lottery', () => {
  it('previewLotteryOdds: the six WORST records are eligible, not ranks 5–10', async () => {
    const preview = await previewLotteryOdds('L1', CONFIG)
    expect(preview?.playoffTeamCount).toBe(4)
    expect(preview!.eligible.map((t) => t.rank).sort((a, b) => a - b)).toEqual(WORST_SIX)
    // The two best non-playoff teams are the ones left out.
    expect(preview!.eligible.map((t) => t.rank)).not.toContain(5)
    expect(preview!.eligible.map((t) => t.rank)).not.toContain(6)
  })

  it('inverse_standings still gives the worst eligible team the best odds, and odds rise with rank', async () => {
    const preview = await previewLotteryOdds('L1', CONFIG)
    const byRank = [...preview!.eligible].sort((a, b) => a.rank - b.rank)
    expect(byRank.map((t) => t.weight)).toEqual([1, 2, 3, 4, 5, 6])
    for (let i = 1; i < byRank.length; i++) expect(byRank[i].oddsPercent).toBeGreaterThan(byRank[i - 1].oddsPercent)
    const best = byRank.reduce((a, b) => (b.oddsPercent > a.oddsPercent ? b : a))
    expect(best.rank).toBe(12)
    expect(best.oddsPercent).toBeCloseTo((6 / 21) * 100, 6)
    expect(byRank.reduce((s, t) => s + t.oddsPercent, 0)).toBeCloseTo(100, 6)
  })

  it('runWeightedLottery: every lottery pick goes to one of the six worst, and the rest fall worst-first', async () => {
    for (const seed of ['a', 'b', 'c', 'audit-2026', 'L1-1730000000000-u1']) {
      const result = await runWeightedLottery('L1', { ...CONFIG, randomSeed: seed }, seed)
      expect(result).not.toBeNull()
      expect(result!.lotteryDraws).toHaveLength(6)
      expect(result!.lotteryDraws.map((d) => rankOf(d.rosterId)).sort((a, b) => a - b)).toEqual(WORST_SIX)
      expect(result!.oddsSnapshot.map((o) => rankOf(o.rosterId)).sort((a, b) => a - b)).toEqual(WORST_SIX)
      // Every roster is seated exactly once, and the non-lottery picks run in reverse order of finish.
      expect(new Set(result!.slotOrder.map((s) => s.rosterId)).size).toBe(12)
      expect(result!.slotOrder.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
      expect(result!.fallbackOrder.map((s) => rankOf(s.rosterId))).toEqual([6, 5, 4, 3, 2, 1])
    }
  })
})

describe('selectEligibleTeams', () => {
  const row = (rank: number, pointsFor = 2000 - 40 * rank): StandingsRow => ({
    rosterId: `r${rank}`,
    displayName: `Rank ${rank}`,
    teamIndex: rank - 1,
    rank,
    wins: 13 - rank,
    losses: rank - 1,
    ties: 0,
    pointsFor,
    maxPf: pointsFor,
  })
  /** Best-first, as both callers hand it over. */
  const TWELVE = Array.from({ length: 12 }, (_, i) => row(i + 1))
  const ranks = (rows: StandingsRow[]) => rows.map((r) => r.rank)

  it('non_playoff takes the WORST lotteryTeamCount teams outside the playoff line', () => {
    expect(ranks(selectEligibleTeams(TWELVE, 'non_playoff', 6, 4))).toEqual(WORST_SIX)
    expect(ranks(selectEligibleTeams(TWELVE, 'non_playoff', 2, 4))).toEqual([11, 12])
  })

  it('all_teams (and custom, which reads as all_teams) takes the worst N of the whole league', () => {
    expect(ranks(selectEligibleTeams(TWELVE, 'all_teams', 6, 4))).toEqual(WORST_SIX)
    expect(ranks(selectEligibleTeams(TWELVE, 'custom', 6, 4))).toEqual(WORST_SIX)
    expect(ranks(selectEligibleTeams(TWELVE, 'all_teams', 12, 4))).toEqual(ranks(TWELVE))
  })

  it('bottom_n is unchanged: the worst N', () => {
    expect(ranks(selectEligibleTeams(TWELVE, 'bottom_n', 6, 4))).toEqual(WORST_SIX)
    expect(ranks(selectEligibleTeams(TWELVE, 'bottom_n', 3, 4))).toEqual([10, 11, 12])
  })

  it('a pool that already fits is returned whole, in the order it came — the default 12-team, 6-playoff case', () => {
    expect(ranks(selectEligibleTeams(TWELVE, 'non_playoff', 6, 6))).toEqual(WORST_SIX)
    expect(ranks(selectEligibleTeams(TWELVE, 'non_playoff', 8, 4))).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('keeps the input order in its output, so the draw and the Draft HQ list read as before', () => {
    const shuffled = [row(9), row(12), row(7), row(5), row(11)]
    expect(ranks(selectEligibleTeams(shuffled, 'all_teams', 3, 0))).toEqual([9, 12, 11])
  })

  it('empty when nobody is outside the playoff line, or the count is 0', () => {
    expect(selectEligibleTeams(TWELVE, 'non_playoff', 6, 12)).toEqual([])
    expect(selectEligibleTeams(TWELVE, 'non_playoff', 0, 4)).toEqual([])
    expect(selectEligibleTeams(TWELVE, 'all_teams', 0, 4)).toEqual([])
    expect(selectEligibleTeams(TWELVE, 'bottom_n', 0, 4)).toEqual([])
  })

  it('a tie on the lottery line goes to the team the tiebreak puts lower (lower points for)', () => {
    // Ranks 8 and 8 tie; lower_points_for orders the 1,500-PF team before the 1,700-PF one within
    // the tie, the same order the fallback seats them in — so it is the one counted as the worse finish.
    const rows = [row(1), row(2), row(3), row(4), row(5), row(6), row(7), { ...row(8), rosterId: 'hi', pointsFor: 1700, maxPf: 1700 }, { ...row(8), rosterId: 'lo', pointsFor: 1500, maxPf: 1500 }, row(10)]
    applyTiebreak(rows, 'lower_points_for', 's')
    expect(selectEligibleTeams(rows, 'non_playoff', 2, 4).map((r) => r.rosterId)).toEqual(['lo', 'r10'])
  })
})

describe('the Standings screen preview (buildDraftOrderPreview) feeds the same selection', () => {
  it('attaches first-pick odds to the six worst teams outside the line, none to ranks 5 and 6', () => {
    const board = {
      hasHeadToHead: true,
      rules: { playoffTeams: 4 },
      teams: Array.from({ length: 12 }, (_, i) => ({
        rosterId: `r${i + 1}`,
        name: `Rank ${i + 1}`,
        isYou: false,
        seed: i + 1,
        record: { wins: 12 - i, losses: i, ties: 0 },
        pointsFor: 2000 - 40 * (i + 1),
      })),
    } as unknown as StandingsBoard
    const p = buildDraftOrderPreview(board, { kind: 'lottery', config: CONFIG })!
    expect(p.lotteryPicks).toBe(6)
    const withOdds = p.picks.filter((x) => x.firstPickOdds != null).map((x) => rankOf(x.rosterId))
    expect(withOdds.sort((a, b) => a - b)).toEqual(WORST_SIX)
    // The preview lists worst first, so its top row carries the best odds.
    expect(rankOf(p.picks[0].rosterId)).toBe(12)
    expect(p.picks[0].firstPickOdds).toBeCloseTo((6 / 21) * 100, 6)
  })
})
