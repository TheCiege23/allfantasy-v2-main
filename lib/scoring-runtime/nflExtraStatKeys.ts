/**
 * NFL stats that are scored straight from the provider's own count — first downs, long-play and
 * long-TD bonuses, game-total bonuses, per-position catch and first-down bonuses, special-teams
 * plays, missed PATs.
 *
 * ONE LIST, THREE READERS: `normalizeNflWeeklyStats` / `normalizeNflTeamDefenseWeeklyStats` copy
 * these keys from the raw week payload (they were dropped before), `NFL_CONFIG.scoringCategories`
 * scores them (default 0, so a league that sets nothing scores exactly as before), and the
 * commissioner panel bridge maps its rows onto them. Keeping the list here is what stops the three
 * drifting apart.
 *
 * The key IS the provider's stat key. The week payload is Sleeper's
 * `/stats/nfl/{season}/{week}`, whose stat keys are the same names Sleeper leagues score — verified
 * against stored payloads in `player_game_stats.stat_payload` (production, 2026-10-25), e.g.
 * `rush_fd`, `rec_fd`, `pass_fd`, `pass_cmp_40p`, `rec_td_40p`, `bonus_rec_rb`, `bonus_fd_wr`,
 * `bonus_rush_rec_yd_100`, `st_td`, `st_ff`, `kr_yd`. A bonus key (`bonus_*`) carries the count
 * the provider already computed (1 when the game reached it), so no threshold is re-derived here.
 */

export type NflExtraStat = {
  key: string
  label: string
  group: 'passing' | 'rushing' | 'receiving' | 'kicking' | 'special' | 'team_def'
  /** `team`: read from the team-defence row. `player`: from every other row. */
  side: 'player' | 'team'
}

export const NFL_EXTRA_STATS: readonly NflExtraStat[] = [
  // Passing
  { key: 'pass_fd', label: 'Passing 1st Down', group: 'passing', side: 'player' },
  { key: 'pass_cmp', label: 'Pass Completed', group: 'passing', side: 'player' },
  { key: 'pass_inc', label: 'Incomplete Pass', group: 'passing', side: 'player' },
  { key: 'pass_att', label: 'Pass Attempt', group: 'passing', side: 'player' },
  { key: 'pass_sack', label: 'QB Sacked', group: 'passing', side: 'player' },
  { key: 'pass_int_td', label: 'Pick 6 Thrown', group: 'passing', side: 'player' },
  { key: 'pass_cmp_40p', label: '40+ Yd Completion', group: 'passing', side: 'player' },
  { key: 'pass_td_40p', label: '40+ Yd Pass TD Bonus', group: 'passing', side: 'player' },
  { key: 'pass_td_50p', label: '50+ Yd Pass TD Bonus', group: 'passing', side: 'player' },
  { key: 'bonus_pass_cmp_25', label: '25+ Completions Bonus', group: 'passing', side: 'player' },
  { key: 'bonus_fd_qb', label: '1st Down Bonus — QB', group: 'passing', side: 'player' },
  // Rushing
  { key: 'rush_fd', label: 'Rushing 1st Down', group: 'rushing', side: 'player' },
  { key: 'rush_att', label: 'Rush Attempt', group: 'rushing', side: 'player' },
  { key: 'rush_40p', label: '40+ Yd Rush', group: 'rushing', side: 'player' },
  { key: 'rush_td_40p', label: '40+ Yd Rush TD Bonus', group: 'rushing', side: 'player' },
  { key: 'rush_td_50p', label: '50+ Yd Rush TD Bonus', group: 'rushing', side: 'player' },
  { key: 'bonus_rush_yd_200', label: '200+ Yd Rushing Bonus', group: 'rushing', side: 'player' },
  { key: 'bonus_rush_att_20', label: '20+ Carries Bonus', group: 'rushing', side: 'player' },
  { key: 'bonus_rush_rec_yd_100', label: '100+ Rush + Rec Yards Bonus', group: 'rushing', side: 'player' },
  { key: 'bonus_rush_rec_yd_200', label: '200+ Rush + Rec Yards Bonus', group: 'rushing', side: 'player' },
  { key: 'bonus_fd_rb', label: '1st Down Bonus — RB', group: 'rushing', side: 'player' },
  // Receiving
  { key: 'rec_fd', label: 'Receiving 1st Down', group: 'receiving', side: 'player' },
  { key: 'rec_tgt', label: 'Target', group: 'receiving', side: 'player' },
  { key: 'rec_40p', label: '40+ Yd Reception', group: 'receiving', side: 'player' },
  { key: 'rec_td_40p', label: '40+ Yd Rec TD Bonus', group: 'receiving', side: 'player' },
  { key: 'rec_td_50p', label: '50+ Yd Rec TD Bonus', group: 'receiving', side: 'player' },
  { key: 'rec_0_4', label: '0–4 Yd Reception', group: 'receiving', side: 'player' },
  { key: 'rec_5_9', label: '5–9 Yd Reception', group: 'receiving', side: 'player' },
  { key: 'rec_10_19', label: '10–19 Yd Reception', group: 'receiving', side: 'player' },
  { key: 'rec_20_29', label: '20–29 Yd Reception', group: 'receiving', side: 'player' },
  { key: 'rec_30_39', label: '30–39 Yd Reception', group: 'receiving', side: 'player' },
  { key: 'bonus_rec_yd_200', label: '200+ Yd Receiving Bonus', group: 'receiving', side: 'player' },
  { key: 'bonus_rec_rb', label: 'Reception Bonus — RB', group: 'receiving', side: 'player' },
  { key: 'bonus_rec_wr', label: 'Reception Bonus — WR', group: 'receiving', side: 'player' },
  { key: 'bonus_fd_wr', label: '1st Down Bonus — WR', group: 'receiving', side: 'player' },
  { key: 'bonus_fd_te', label: '1st Down Bonus — TE', group: 'receiving', side: 'player' },
  // Misc / kicking / special teams
  { key: 'fum', label: 'Fumble', group: 'special', side: 'player' },
  { key: 'xpmiss', label: 'PAT Missed', group: 'kicking', side: 'player' },
  { key: 'st_td', label: 'Special Teams Player TD', group: 'special', side: 'player' },
  { key: 'st_ff', label: 'Special Teams Player Forced Fumble', group: 'special', side: 'player' },
  { key: 'st_fum_rec', label: 'Special Teams Player Fumble Recovery', group: 'special', side: 'player' },
  { key: 'kr_yd', label: 'Player Kick Return Yards', group: 'special', side: 'player' },
  { key: 'pr_yd', label: 'Player Punt Return Yards', group: 'special', side: 'player' },
  // Team defence / special teams
  { key: 'def_st_ff', label: 'DST Special Teams Forced Fumble', group: 'team_def', side: 'team' },
  { key: 'def_st_fum_rec', label: 'DST Special Teams Fumble Recovery', group: 'team_def', side: 'team' },
]

export const NFL_EXTRA_PLAYER_STAT_KEYS: readonly string[] = NFL_EXTRA_STATS.filter((s) => s.side === 'player').map((s) => s.key)
export const NFL_EXTRA_TEAM_STAT_KEYS: readonly string[] = NFL_EXTRA_STATS.filter((s) => s.side === 'team').map((s) => s.key)
