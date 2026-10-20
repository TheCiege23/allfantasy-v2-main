/**
 * NHL panel rows wired into the scoring engine AFTER leagues already existed, and the rule that keeps
 * those leagues' scores where they were.
 *
 * Each row here maps a panel key to an engine category in `lib/sportConfig/configs/nhl.ts`, counted
 * from fields the Rolling Insights box carries (fixtures/live.NHL.json): `power_play_goals`,
 * `faceoffs_won`, `takeaways`, `shootout_goals`, the goalie `loss` / `overtime_loss` /
 * `shots_against`, and per-game thresholds derived in `normalizeNhlGameStats`.
 *
 * ⚠ GATED ON A PERSON'S SAVE. Existing stores already hold values for some of these keys (the AF
 * default seeded faceoffs at 0.1 and a hat trick at 2) that never scored. Bridging them on deploy
 * would change live scores mid-season with nobody having chosen it, so they score only once a
 * commissioner saves the panel after this change — which stamps `engineVersion`. Until then the
 * panel shows them at 0 (`NhlScoringConfigService`), which is what they score.
 *
 * Client-safe: no prisma, so the panel and the bridge can share it.
 */

export const NHL_SCORING_ENGINE_VERSION = 2

export const NHL_GATED_ENGINE_KEY_MAP: Readonly<Record<string, string>> = {
  points: 'pts',
  power_play_goals: 'ppg',
  power_play_assists: 'ppa',
  short_handed_goals: 'shg',
  short_handed_assists: 'sha',
  faceoff_wins: 'fow',
  faceoff_losses: 'fol',
  takeaways: 'tk',
  giveaways: 'gv',
  shootout_goal: 'so_g',
  hat_trick_bonus: 'hat_trick',
  three_assist_game: 'three_ast_game',
  five_point_game: 'five_pt_game',
  multi_goal_game: 'multi_g_game',
  multi_assist_game: 'multi_a_game',
  ten_shot_game: 'ten_sog_game',
  five_hit_game: 'five_hit_game',
  five_block_game: 'five_blk_game',
  goalie_losses: 'g_loss',
  overtime_losses: 'g_otl',
  shots_against: 'g_sa',
  forty_save_game: 'g_40sv_game',
  fifty_save_game: 'g_50sv_game',
  // Goalie time on ice. Added at the same contract version: until now the row was locked at 0 and
  // the panel saved what it showed, so a v2-saved store holds 0 here and no score moves.
  goalie_minutes_played: 'g_toi',
}

/** Whether a stored `nhl_scoring_config` opted into the gated rows (a person saved it on v2+). */
export function nhlStoreScoresGatedKeys(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const store = raw as Record<string, unknown>
  const by = store.lastUpdatedBy
  const savedByPerson = typeof by === 'string' && by.trim().length > 0
  return savedByPerson && Number(store.engineVersion) >= NHL_SCORING_ENGINE_VERSION
}
