import {
  RANK_XP_LEAGUE_SIZE_MULTIPLIER,
  RANK_XP_PER_CHAMPIONSHIP,
  RANK_XP_PER_DISTINCT_SEASON,
  RANK_XP_PER_IMPORT_WIN,
  RANK_XP_PER_PLAYOFF_APPEARANCE,
} from '@/lib/rank/rank-xp-constants'

/**
 * The published XP formula over ledger rows — the one implementation.
 *
 * `calculateAndSaveRank` persists this total and `/core/rankings` explains it,
 * so both call this. Before it existed the screen could only see the stored
 * total and four counters, and had to back-solve the league-size bonus as
 * "whatever is left over" — which is how a stale total from an older formula
 * would have surfaced as a six-figure bonus row.
 *
 * Pure: no prisma, so it is tested directly.
 */

export type XpLedgerRow = {
  season: number
  wins: number
  losses: number
  madePlayoffs: boolean
  wonChampionship: boolean
  leagueSize: number
}

export type CareerXp = {
  wins: number
  losses: number
  championships: number
  playoffAppearances: number
  /** Distinct years — the `× RANK_XP_PER_DISTINCT_SEASON` multiplicand. */
  distinctSeasons: number
  /** Rows — one per league-season. */
  leagueSeasons: number
  leagueSizeBonus: number
  total: number
}

export function careerXp(rows: XpLedgerRow[]): CareerXp {
  let wins = 0
  let losses = 0
  let championships = 0
  let playoffAppearances = 0
  let leagueSizeBonus = 0
  const years = new Set<number>()
  for (const r of rows) {
    wins += r.wins
    losses += r.losses
    if (r.wonChampionship) championships += 1
    if (r.madePlayoffs) playoffAppearances += 1
    leagueSizeBonus += Math.max(0, r.leagueSize - 10) * RANK_XP_LEAGUE_SIZE_MULTIPLIER
    years.add(r.season)
  }
  const distinctSeasons = years.size
  const total =
    wins * RANK_XP_PER_IMPORT_WIN +
    playoffAppearances * RANK_XP_PER_PLAYOFF_APPEARANCE +
    championships * RANK_XP_PER_CHAMPIONSHIP +
    distinctSeasons * RANK_XP_PER_DISTINCT_SEASON +
    leagueSizeBonus
  return {
    wins,
    losses,
    championships,
    playoffAppearances,
    distinctSeasons,
    leagueSeasons: rows.length,
    leagueSizeBonus,
    total,
  }
}
