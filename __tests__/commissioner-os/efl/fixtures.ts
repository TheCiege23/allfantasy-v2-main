/**
 * A complete, deliberately awkward EFL season.
 *
 * 🛑 THE FROZEN VALUES ARE NOT IN RANK ORDER, ON PURPOSE. If the reverse-Max-PF slots were seeded
 * with values that happened to descend with tier rank, a resolver that sorted on RANK instead of on
 * the frozen value would produce an identical draft order and every test would pass. The values
 * below scramble that relationship inside each tier, so slots 1-5, 12-13 and 20-21 can only come
 * out right if the resolver really reads the freeze.
 */

import type { EflPlayoffOutcome, EflTierPlacement, EflTierStanding } from '@/lib/commissioner-os/efl/types'
import type { MaxPfFreezeSnapshot } from '@/lib/commissioner-os/efl/maxPfFreeze'

export const TIER_LABELS: Record<number, string> = {
  1: 'Premier League',
  2: 'Championship',
  3: 'League 1',
  4: 'League 2',
}

/** `t<tier>-<rank>` — the id encodes where the team finished, so an assertion reads as a sentence. */
export const teamId = (tier: number, rank: number) => `t${tier}-${rank}`

export function tier(tierLevel: number): EflTierStanding {
  return {
    tierLevel,
    divisionId: `div-${tierLevel}`,
    label: TIER_LABELS[tierLevel]!,
    teams: Array.from({ length: 8 }, (_, i) => ({
      teamId: teamId(tierLevel, i + 1),
      teamName: `${TIER_LABELS[tierLevel]} #${i + 1}`,
      rank: i + 1,
    })),
  }
}

export const ALL_TIERS: EflTierStanding[] = [tier(1), tier(2), tier(3), tier(4)]

/**
 * Frozen regular-season values.
 *
 * Only the UNCLAIMED teams in each tier matter for the draft order, and those are the ones
 * scrambled. Ranks that hold a structural role get an arbitrary value so the snapshot is complete.
 *
 *   Tier 4 unclaimed = ranks 4-8, values 500/100/300/200/400
 *          -> ascending: rank5, rank7, rank6, rank8, rank4  (slots 1-5)
 *   Tier 3 unclaimed = ranks 4-5, values 900/800  -> ascending: rank5, rank4  (slots 12-13)
 *   Tier 2 unclaimed = ranks 4-5, values 700/750  -> ascending: rank4, rank5  (slots 20-21)
 */
const FROZEN_BY_TEAM: Record<string, number> = {
  [teamId(4, 4)]: 500,
  [teamId(4, 5)]: 100,
  [teamId(4, 6)]: 300,
  [teamId(4, 7)]: 200,
  [teamId(4, 8)]: 400,
  [teamId(3, 4)]: 900,
  [teamId(3, 5)]: 800,
  [teamId(2, 4)]: 700,
  [teamId(2, 5)]: 750,
}

export function freeze(overrides: Record<string, number> = {}): MaxPfFreezeSnapshot {
  const rows = ALL_TIERS.flatMap((t) =>
    t.teams.map((team) => ({
      teamId: team.teamId,
      value: overrides[team.teamId] ?? FROZEN_BY_TEAM[team.teamId] ?? 1000 + team.rank,
      weeksCounted: 14,
      source: 'weekly_rows' as const,
    })),
  ).sort((a, b) => (a.teamId < b.teamId ? -1 : 1))

  return {
    leagueId: 'efl-1',
    season: 2026,
    regularSeasonFinalWeek: 14,
    metric: 'optimal_lineup_max_pf',
    computationVersion: 'test-fixture-v1',
    rows,
    fingerprint: 'test-fixture',
  }
}

/**
 * Every playoff decided.
 *
 * ⚠ THE WINNERS ARE NOT ALWAYS THE HIGHER SEED. Tier 3's relegation playoff is won by rank 6 and
 * lost by rank 7, but tier 2's relegation playoff is set up the same way deliberately so a resolver
 * that assumed "the better seed always survives" would still pass — which is why the promotion
 * playoffs below invert it: rank 2 wins in every tier, and a resolver reading the LOSER where it
 * should read the winner lands on rank 3 and fails slot 9 immediately.
 */
export const ALL_OUTCOMES: EflPlayoffOutcome[] = [
  { kind: 'promotion', tierLevel: 4, winnerTeamId: teamId(4, 2), loserTeamId: teamId(4, 3) },
  { kind: 'promotion', tierLevel: 3, winnerTeamId: teamId(3, 2), loserTeamId: teamId(3, 3) },
  { kind: 'promotion', tierLevel: 2, winnerTeamId: teamId(2, 2), loserTeamId: teamId(2, 3) },
  { kind: 'relegation', tierLevel: 3, winnerTeamId: teamId(3, 6), loserTeamId: teamId(3, 7) },
  { kind: 'relegation', tierLevel: 2, winnerTeamId: teamId(2, 6), loserTeamId: teamId(2, 7) },
  { kind: 'relegation', tierLevel: 1, winnerTeamId: teamId(1, 6), loserTeamId: teamId(1, 7) },
]

/** Premier League championship playoff placings 1-5, filling rookie slots 32 down to 28. */
export const PREMIER_PLACEMENT: EflTierPlacement = {
  tierLevel: 1,
  placements: [teamId(1, 1), teamId(1, 2), teamId(1, 3), teamId(1, 4), teamId(1, 5)],
}

/** The full 32-slot answer, written out so a regression is a diff rather than an argument. */
export const EXPECTED_ORDER: string[] = [
  teamId(4, 5), // 1  League 2 reverse Max PF (100)
  teamId(4, 7), // 2  (200)
  teamId(4, 6), // 3  (300)
  teamId(4, 8), // 4  (400)
  teamId(4, 4), // 5  (500)
  teamId(4, 3), // 6  League 2 promotion playoff loser
  teamId(3, 8), // 7  League 1 auto-relegated
  teamId(3, 7), // 8  League 1 relegation playoff loser
  teamId(4, 2), // 9  League 2 promotion playoff winner
  teamId(4, 1), // 10 League 2 auto-promoted
  teamId(3, 6), // 11 League 1 relegation playoff winner
  teamId(3, 5), // 12 League 1 reverse Max PF (800)
  teamId(3, 4), // 13 (900)
  teamId(3, 3), // 14 League 1 promotion playoff loser
  teamId(2, 8), // 15 Championship auto-relegated
  teamId(2, 7), // 16 Championship relegation playoff loser
  teamId(3, 2), // 17 League 1 promotion playoff winner
  teamId(3, 1), // 18 League 1 auto-promoted
  teamId(2, 6), // 19 Championship relegation playoff winner
  teamId(2, 4), // 20 Championship reverse Max PF (700)
  teamId(2, 5), // 21 (750)
  teamId(2, 3), // 22 Championship promotion playoff loser
  teamId(1, 8), // 23 Premier auto-relegated
  teamId(1, 7), // 24 Premier relegation playoff loser
  teamId(2, 2), // 25 Championship promotion playoff winner
  teamId(2, 1), // 26 Championship auto-promoted
  teamId(1, 6), // 27 Premier relegation playoff winner
  teamId(1, 5), // 28 Premier 5th
  teamId(1, 4), // 29 Premier 4th
  teamId(1, 3), // 30 Premier 3rd
  teamId(1, 2), // 31 Premier runner-up
  teamId(1, 1), // 32 Premier champion
]
