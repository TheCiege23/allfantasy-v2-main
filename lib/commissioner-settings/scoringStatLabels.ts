/**
 * Human labels for the provider stat keys worth naming — pure, so client UI (the league
 * settings hub) and server reads (`leagueSettingsReads.ts`) share ONE list.
 *
 * ⚠ DELIBERATELY PARTIAL, AND AN UNKNOWN KEY FALLS BACK TO THE RAW KEY RATHER THAN BEING DROPPED.
 * There are 80+ keys on a full IDP league and this list will always trail the provider's vocabulary;
 * hiding a rule because nobody has labelled it yet would make the scoring list quietly incomplete,
 * which is the one thing a commissioner checking their import cannot afford.
 */
export const SCORING_STAT_LABELS: Record<string, string> = {
  pass_yd: 'Passing yards', pass_td: 'Passing TD', pass_int: 'Interception thrown',
  pass_2pt: 'Passing 2-pt', pass_sack: 'Sack taken', pass_cmp: 'Pass completed', pass_inc: 'Incomplete pass', pass_att: 'Pass attempt',
  rush_yd: 'Rushing yards', rush_td: 'Rushing TD', rush_att: 'Rush attempt', rush_2pt: 'Rushing 2-pt',
  rec: 'Reception', rec_yd: 'Receiving yards', rec_td: 'Receiving TD', rec_2pt: 'Receiving 2-pt',
  bonus_rec_te: 'TE reception bonus',
  fum: 'Fumble', fum_lost: 'Fumble lost', fum_rec: 'Fumble recovered', fum_rec_td: 'Fumble recovery TD',
  xpm: 'Extra point made', xpmiss: 'Extra point missed', fgmiss: 'Field goal missed',
  fgm_0_19: 'FG 0-19', fgm_20_29: 'FG 20-29', fgm_30_39: 'FG 30-39', fgm_40_49: 'FG 40-49', fgm_50p: 'FG 50+',
  sack: 'Sack', int: 'Interception', safe: 'Safety', ff: 'Forced fumble', def_td: 'Defensive TD',
  blk_kick: 'Blocked kick', tkl_loss: 'Tackle for loss',
  idp_tkl: 'IDP tackle', idp_tkl_solo: 'IDP solo tackle', idp_tkl_ast: 'IDP assisted tackle',
  idp_tkl_loss: 'IDP tackle for loss', idp_sack: 'IDP sack', idp_int: 'IDP interception',
  idp_ff: 'IDP forced fumble', idp_fum_rec: 'IDP fumble recovery', idp_pass_def: 'IDP pass defended',
  idp_qb_hit: 'IDP QB hit', idp_safe: 'IDP safety', idp_def_td: 'IDP defensive TD',
  idp_blk_kick: 'IDP blocked kick',
  pts_allow_0: 'Shutout', pts_allow_1_6: 'Points allowed 1-6', pts_allow_7_13: 'Points allowed 7-13',
  pts_allow_14_20: 'Points allowed 14-20', pts_allow_21_27: 'Points allowed 21-27',
  pts_allow_28_34: 'Points allowed 28-34', pts_allow_35p: 'Points allowed 35+',
  st_td: 'Special-teams TD', st_ff: 'Special-teams forced fumble', st_tkl_solo: 'Special-teams tackle',
  kr_yd: 'Kick return yards', pr_yd: 'Punt return yards',
}
