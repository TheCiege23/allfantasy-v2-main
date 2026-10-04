/**
 * lib/ncaaf-scoring/NcaafScoringCategories.ts
 * Complete NCAAF scoring category definitions for the commissioner panel.
 *
 * Mirrors the NFL scoring system structure with NCAAF-specific additions.
 * 10 tabs: Passing | Rushing | Receiving | Kicking | Team Defense |
 *          Special Teams | Misc | Bonus | IDP | Advanced (premium)
 *
 * ONE config per league — applies to ALL NCAAF league types:
 * Redraft, Dynasty, Keeper, Best Ball, Auction, Guillotine, Survivor,
 * Zombie, Tournament, Big Brother, Devy, C2C Football, IDP, Superflex, TE Premium.
 */

export interface NcaafScoringRow {
  key: string
  label: string
  helper?: string
  premium?: boolean
  defaultValue: number
}

export interface NcaafScoringCategory {
  id: string
  label: string
  rows: NcaafScoringRow[]
}

// ============================================================
// 1. PASSING
// ============================================================

const PASSING: NcaafScoringCategory = {
  id: 'passing',
  label: 'Passing',
  rows: [
    { key: 'passing_yards',              label: 'Passing Yards',              helper: '0.04 pts/yd (1 pt per 25 yds)',  defaultValue: 0.04 },
    { key: 'passing_td',                 label: 'Passing TD',                                                           defaultValue: 4 },
    { key: 'passing_first_down',         label: 'Passing 1st Down',                                                     defaultValue: 0 },
    { key: 'passing_2pt',               label: '2-Pt Conversion',                                                       defaultValue: 2 },
    { key: 'interception_thrown',        label: 'Pass Intercepted',                                                     defaultValue: -1 },
    { key: 'pick_6_thrown',             label: 'Pick 6 Thrown',                                                        defaultValue: 0 },
    { key: 'completion',                 label: 'Pass Completed',                                                       defaultValue: 0 },
    { key: 'incomplete_pass',           label: 'Incomplete Pass',                                                      defaultValue: 0 },
    { key: 'passing_attempt',           label: 'Pass Attempts',                                                        defaultValue: 0 },
    { key: 'qb_sacked',                 label: 'QB Sacked',                                                            defaultValue: 0 },
    { key: 'forty_yd_completion_bonus', label: '40+ Yard Completion Bonus',                                            defaultValue: 0 },
    { key: 'forty_yd_pass_td_bonus',    label: '40+ Yard Pass TD Bonus',                                               defaultValue: 0 },
    { key: 'fifty_yd_pass_td_bonus',    label: '50+ Yard Pass TD Bonus',                                               defaultValue: 0 },
    { key: 'three_hundred_yd_pass_bonus', label: '300+ Passing Game Bonus',                                            defaultValue: 0 },
    { key: 'four_hundred_yd_pass_bonus',  label: '400+ Passing Game Bonus',                                            defaultValue: 0 },
    { key: 'five_hundred_yd_pass_bonus',  label: '500+ Passing Game Bonus',                                            defaultValue: 0 },
  ],
}

// ============================================================
// 2. RUSHING
// ============================================================

const RUSHING: NcaafScoringCategory = {
  id: 'rushing',
  label: 'Rushing',
  rows: [
    { key: 'rushing_yards',             label: 'Rushing Yards',           helper: '0.10 pts/yd (1 pt per 10 yds)',  defaultValue: 0.1 },
    { key: 'rushing_td',                label: 'Rushing TD',                                                        defaultValue: 6 },
    { key: 'rushing_first_down',        label: 'Rushing 1st Down',                                                  defaultValue: 0 },
    { key: 'rushing_2pt',               label: '2-Pt Conversion',                                                   defaultValue: 2 },
    { key: 'rush_attempt',              label: 'Rush Attempts',                                                     defaultValue: 0 },
    { key: 'forty_yd_rush_bonus',       label: '40+ Yard Rush Bonus',                                               defaultValue: 0 },
    { key: 'forty_yd_rush_td_bonus',    label: '40+ Yard Rush TD Bonus',                                            defaultValue: 0 },
    { key: 'fifty_yd_rush_td_bonus',    label: '50+ Yard Rush TD Bonus',                                            defaultValue: 0 },
    { key: 'one_hundred_yd_rush_bonus', label: '100+ Rushing Game Bonus',                                           defaultValue: 0 },
    { key: 'two_hundred_yd_rush_bonus', label: '200+ Rushing Game Bonus',                                           defaultValue: 0 },
    { key: 'three_hundred_yd_rush_bonus', label: '300+ Rushing Game Bonus',                                         defaultValue: 0 },
  ],
}

// ============================================================
// 3. RECEIVING
// ============================================================

const RECEIVING: NcaafScoringCategory = {
  id: 'receiving',
  label: 'Receiving',
  rows: [
    { key: 'reception',                   label: 'Reception',                                                          defaultValue: 0.5 },
    { key: 'receiving_yards',             label: 'Receiving Yards',         helper: '0.10 pts/yd (1 pt per 10 yds)',  defaultValue: 0.1 },
    { key: 'receiving_td',                label: 'Receiving TD',                                                       defaultValue: 6 },
    { key: 'receiving_first_down',        label: 'Receiving 1st Down',                                                 defaultValue: 0 },
    { key: 'receiving_2pt',              label: '2-Pt Conversion',                                                    defaultValue: 2 },
    { key: 'rec_0_4_bonus',             label: '0-4 Yard Reception Bonus',                                           defaultValue: 0 },
    { key: 'rec_5_9_bonus',             label: '5-9 Yard Reception Bonus',                                           defaultValue: 0 },
    { key: 'rec_10_19_bonus',           label: '10-19 Yard Reception Bonus',                                         defaultValue: 0 },
    { key: 'rec_20_29_bonus',           label: '20-29 Yard Reception Bonus',                                         defaultValue: 0 },
    { key: 'rec_30_39_bonus',           label: '30-39 Yard Reception Bonus',                                         defaultValue: 0 },
    { key: 'forty_yd_reception_bonus',  label: '40+ Yard Reception Bonus',                                           defaultValue: 0 },
    { key: 'forty_yd_rec_td_bonus',     label: '40+ Yard Reception TD Bonus',                                        defaultValue: 0 },
    { key: 'fifty_yd_rec_td_bonus',     label: '50+ Yard Reception TD Bonus',                                        defaultValue: 0 },
    { key: 'rec_bonus_rb',              label: 'Reception Bonus - RB',                                               defaultValue: 0 },
    { key: 'rec_bonus_wr',              label: 'Reception Bonus - WR',                                               defaultValue: 0 },
    { key: 'rec_bonus_te',              label: 'Reception Bonus - TE',                                               defaultValue: 0 },
    { key: 'one_hundred_yd_rec_bonus',  label: '100+ Receiving Game Bonus',                                          defaultValue: 0 },
    { key: 'two_hundred_yd_rec_bonus',  label: '200+ Receiving Game Bonus',                                          defaultValue: 0 },
    { key: 'three_hundred_yd_rec_bonus', label: '300+ Receiving Game Bonus',                                         defaultValue: 0 },
  ],
}

// ============================================================
// 4. KICKING
// ============================================================

const KICKING: NcaafScoringCategory = {
  id: 'kicking',
  label: 'Kicking',
  rows: [
    { key: 'fg_made',              label: 'FG Made', helper: 'CFBD supplies total makes and attempts. Distance scoring is unavailable from this feed.', defaultValue: 3 },
    { key: 'fg_0_19',             label: 'FG Made (0-19 yards)',       defaultValue: 3 },
    { key: 'fg_20_29',            label: 'FG Made (20-29 yards)',      defaultValue: 3 },
    { key: 'fg_30_39',            label: 'FG Made (30-39 yards)',      defaultValue: 3 },
    { key: 'fg_40_49',            label: 'FG Made (40-49 yards)',      defaultValue: 4 },
    { key: 'fg_50_59',            label: 'FG Made (50-59 yards)',      defaultValue: 5 },
    { key: 'fg_50_plus',          label: 'FG Made (50+ yards)',        defaultValue: 5 },
    { key: 'fg_60_plus',          label: 'FG Made (60+ yards)',        defaultValue: 0 },
    { key: 'fg_per_yard',         label: 'Points per FG yard',         defaultValue: 0 },
    { key: 'fg_per_yard_over_30', label: 'Points per FG yard over 30', defaultValue: 0 },
    { key: 'pat_made',            label: 'PAT Made',                   defaultValue: 1 },
    { key: 'fg_missed',           label: 'FG Missed',                  defaultValue: 0 },
    { key: 'fg_missed_0_19',      label: 'FG Missed (0-19 yards)',     defaultValue: -1 },
    { key: 'fg_missed_20_29',     label: 'FG Missed (20-29 yards)',    defaultValue: -1 },
    { key: 'fg_missed_30_39',     label: 'FG Missed (30-39 yards)',    defaultValue: -1 },
    { key: 'fg_missed_40_49',     label: 'FG Missed (40-49 yards)',    defaultValue: 0 },
    { key: 'fg_missed_50_59',     label: 'FG Missed (50-59 yards)',    defaultValue: 0 },
    { key: 'fg_missed_50_plus',   label: 'FG Missed (50+ yards)',      defaultValue: 0 },
    { key: 'fg_missed_60_plus',   label: 'FG Missed (60+ yards)',      defaultValue: 0 },
    { key: 'pat_missed',          label: 'PAT Missed',                 defaultValue: -1 },
  ],
}

// ============================================================
// 5. TEAM DEFENSE
// ============================================================

const TEAM_DEFENSE: NcaafScoringCategory = {
  id: 'team_defense',
  label: 'Team Defense',
  rows: [
    { key: 'dst_td',                        label: 'Defense TD',                        defaultValue: 6 },
    { key: 'dst_pa_0',                      label: 'Points Allowed 0',                  defaultValue: 10 },
    { key: 'dst_pa_1_6',                    label: 'Points Allowed 1-6',                defaultValue: 7 },
    { key: 'dst_pa_7_13',                   label: 'Points Allowed 7-13',               defaultValue: 4 },
    { key: 'dst_pa_14_20',                  label: 'Points Allowed 14-20',              defaultValue: 1 },
    { key: 'dst_pa_21_27',                  label: 'Points Allowed 21-27',              defaultValue: 0 },
    { key: 'dst_pa_28_34',                  label: 'Points Allowed 28-34',              defaultValue: -1 },
    { key: 'dst_pa_35_plus',                label: 'Points Allowed 35+',                defaultValue: -4 },
    { key: 'dst_pts_per_pa',                label: 'Points Per Point Allowed',          defaultValue: 0 },
    { key: 'dst_ya_0_99',                   label: 'Less Than 100 Total Yards Allowed', defaultValue: 0 },
    { key: 'dst_ya_100_199',                label: '100-199 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_200_299',                label: '200-299 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_300_349',                label: '300-349 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_350_399',                label: '350-399 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_400_449',                label: '400-449 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_450_499',                label: '450-499 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_500_549',                label: '500-549 Total Yards Allowed',       defaultValue: 0 },
    { key: 'dst_ya_550_plus',               label: '550+ Total Yards Allowed',          defaultValue: 0 },
    { key: 'dst_pts_per_ya',                label: 'Points Per Yard Allowed',           defaultValue: 0 },
    { key: 'dst_three_and_out',             label: '3 and Out',                         defaultValue: 0 },
    { key: 'dst_fourth_down_stop',          label: '4th Down Stop',                     defaultValue: 0 },
    { key: 'dst_qb_hit',                    label: 'Hit on QB',                         defaultValue: 0 },
    { key: 'dst_sack',                      label: 'Sacks',                             defaultValue: 1 },
    { key: 'dst_sack_yards',                label: 'Sack Yards',                        defaultValue: 0 },
    { key: 'dst_interception',              label: 'Interceptions',                     defaultValue: 2 },
    { key: 'dst_int_return_yards',          label: 'INT Return Yards',                  defaultValue: 0 },
    { key: 'dst_fumble_recovery',           label: 'Fumble Recovery',                   defaultValue: 2 },
    { key: 'dst_fumble_return_yards',       label: 'Fumble Return Yards',               defaultValue: 0 },
    { key: 'dst_tackle_for_loss',           label: 'Tackle For Loss',                   defaultValue: 0 },
    { key: 'dst_solo_tackle',               label: 'Solo Tackle',                       defaultValue: 0 },
    { key: 'dst_tackle',                    label: 'Tackle',                            defaultValue: 0 },
    { key: 'dst_safety',                    label: 'Safety',                            defaultValue: 2 },
    { key: 'dst_forced_fumble',             label: 'Forced Fumble',                     defaultValue: 0 },
    { key: 'dst_blocked_kick',              label: 'Blocked Kick',                      defaultValue: 2 },
    { key: 'dst_forced_punt',              label: 'Forced Punt',                       defaultValue: 0 },
    { key: 'dst_pass_defended',             label: 'Pass Defended',                     defaultValue: 0 },
    { key: 'dst_2pt_return',                label: '2-Pt Conversion Returns',           defaultValue: 2 },
    { key: 'dst_return_td',                 label: 'Kick/Punt Return TD',               defaultValue: 6 },
    { key: 'dst_missed_fg_return_yards',    label: 'Missed FG Return Yards',            defaultValue: 0 },
    { key: 'dst_blocked_kick_return_yards', label: 'Blocked Kick Return Yards',         defaultValue: 0 },
  ],
}

// ============================================================
// 6. SPECIAL TEAMS
// ============================================================

const SPECIAL_TEAMS: NcaafScoringCategory = {
  id: 'special_teams',
  label: 'Special Teams',
  rows: [
    { key: 'st_td',                        label: 'Special Teams TD',                   defaultValue: 0 },
    { key: 'st_forced_fumble',             label: 'Special Teams Forced Fumble',        defaultValue: 0 },
    { key: 'st_fumble_recovery',           label: 'Special Teams Fumble Recovery',      defaultValue: 0 },
    { key: 'st_solo_tackle',               label: 'Special Teams Solo Tackle',          defaultValue: 0 },
    { key: 'st_punt_return_yards',         label: 'Punt Return Yards',                  defaultValue: 0 },
    { key: 'st_kick_return_yards',         label: 'Kick Return Yards',                  defaultValue: 0 },
    { key: 'st_player_td',                 label: 'Special Teams Player TD',            defaultValue: 0 },
    { key: 'st_player_forced_fumble',      label: 'Special Teams Player Forced Fumble', defaultValue: 0 },
    { key: 'st_player_fumble_recovery',    label: 'Special Teams Player Fumble Recovery', defaultValue: 0 },
    { key: 'st_player_solo_tackle',        label: 'Special Teams Player Solo Tackle',   defaultValue: 0 },
    { key: 'st_player_punt_return_yards',  label: 'Player Punt Return Yards',           defaultValue: 0 },
    { key: 'st_player_kick_return_yards',  label: 'Player Kick Return Yards',           defaultValue: 0 },
  ],
}

// ============================================================
// 7. MISC
// ============================================================

const MISC: NcaafScoringCategory = {
  id: 'misc',
  label: 'Misc',
  rows: [
    { key: 'fumble',                label: 'Fumble',              defaultValue: 0 },
    { key: 'fumble_lost',           label: 'Fumble Lost',         defaultValue: -2 },
    { key: 'off_fumble_recovery_td', label: 'Fumble Recovery TD', defaultValue: 6 },
  ],
}

// ============================================================
// 8. BONUS
// ============================================================

const BONUS: NcaafScoringCategory = {
  id: 'bonus',
  label: 'Bonus',
  rows: [
    { key: 'one_hundred_combined_rush_bonus',    label: '100-199 Combined Rush + Rec Yards',   defaultValue: 0 },
    { key: 'two_hundred_combined_rush_bonus',    label: '200+ Combined Rush + Rec Yards',      defaultValue: 0 },
    { key: 'twenty_five_completions_bonus',      label: '25+ Pass Completions',                defaultValue: 0 },
    { key: 'twenty_carries_bonus',               label: '20+ Carries',                         defaultValue: 0 },
    { key: 'first_down_bonus_rb',                label: '1st Down Bonus - RB',                 defaultValue: 0 },
    { key: 'first_down_bonus_wr',                label: '1st Down Bonus - WR',                 defaultValue: 0 },
    { key: 'first_down_bonus_te',                label: '1st Down Bonus - TE',                 defaultValue: 0 },
    { key: 'first_down_bonus_qb',                label: '1st Down Bonus - QB',                 defaultValue: 0 },
  ],
}

// ============================================================
// 9. IDP
// ============================================================

const IDP: NcaafScoringCategory = {
  id: 'idp',
  label: 'IDP',
  rows: [
    { key: 'idp_td',                         label: 'IDP TD',                         defaultValue: 6 },
    { key: 'idp_sack',                        label: 'Sack',                           defaultValue: 3 },
    { key: 'idp_sack_yards',                 label: 'Sack Yards',                    defaultValue: 0 },
    { key: 'idp_qb_hit',                     label: 'Hit on QB',                     defaultValue: 1 },
    { key: 'idp_tackle',                     label: 'Tackle',                        defaultValue: 0 },
    { key: 'idp_tackle_for_loss',            label: 'Tackle For Loss',               defaultValue: 1 },
    { key: 'idp_blocked_kick',               label: 'Blocked Punt, PAT or FG',       defaultValue: 3 },
    { key: 'idp_interception',               label: 'Interception',                  defaultValue: 4 },
    { key: 'idp_int_return_yards',           label: 'INT Return Yards',              defaultValue: 0 },
    { key: 'idp_fumble_return_yards',        label: 'Fumble Return Yards',           defaultValue: 0 },
    { key: 'idp_fumble_forced',              label: 'Forced Fumble',                 defaultValue: 3 },
    { key: 'idp_safety',                     label: 'Safety',                        defaultValue: 2 },
    { key: 'idp_assisted_tackle',            label: 'Assisted Tackle',               defaultValue: 0.5 },
    { key: 'idp_solo_tackle',                label: 'Solo Tackle',                   defaultValue: 1 },
    { key: 'idp_pass_defended',              label: 'Pass Defended',                 defaultValue: 1 },
    { key: 'idp_ten_tackle_bonus',           label: '10+ Tackle Bonus',              defaultValue: 0 },
    { key: 'idp_two_sack_bonus',             label: '2+ Sack Bonus',                 defaultValue: 0 },
    { key: 'idp_three_pass_defended_bonus',  label: '3+ Pass Defended Bonus',        defaultValue: 0 },
    { key: 'idp_fifty_yd_int_return_td_bonus', label: '50+ Yard INT Return TD Bonus', defaultValue: 0 },
  ],
}

// ============================================================
// 10. ADVANCED — premium gated
// ============================================================

export const NCAAF_PREMIUM_SCORING: NcaafScoringCategory = {
  id: 'advanced',
  label: 'Advanced',
  rows: [
    { key: 'air_yards',              label: 'Air Yards',              premium: true, defaultValue: 0 },
    { key: 'passing_air_yards',      label: 'Passing Air Yards',      premium: true, defaultValue: 0 },
    { key: 'receiving_air_yards',    label: 'Receiving Air Yards',    premium: true, defaultValue: 0 },
    { key: 'completed_air_yards',    label: 'Completed Air Yards',    premium: true, defaultValue: 0 },
    { key: 'explosive_play_bonus',   label: 'Explosive Play Bonus',   premium: true, defaultValue: 0, helper: '20+ yard play bonus' },
    { key: 'yards_after_contact',    label: 'Yards After Contact',    premium: true, defaultValue: 0 },
    { key: 'broken_tackles',         label: 'Broken Tackles',         premium: true, defaultValue: 0 },
  ],
}

// ============================================================
// EXPORTS
// ============================================================

export const NCAAF_SCORING_CATEGORIES: NcaafScoringCategory[] = [
  PASSING,
  RUSHING,
  RECEIVING,
  KICKING,
  TEAM_DEFENSE,
  SPECIAL_TEAMS,
  MISC,
  BONUS,
  IDP,
]

export const NCAAF_ALL_SCORING_CATEGORIES: NcaafScoringCategory[] = [
  ...NCAAF_SCORING_CATEGORIES,
  NCAAF_PREMIUM_SCORING,
]

/**
 * Build a full default scoring config from all NCAAF category rows.
 * Used as the merge baseline in the scoring panel before the fetched config loads.
 */
export function buildNcaafScoringDefaults(): Record<string, number> {
  const config: Record<string, number> = {}
  for (const cat of NCAAF_ALL_SCORING_CATEGORIES) {
    for (const row of cat.rows) {
      config[row.key] = row.defaultValue
    }
  }
  return config
}
