/**
 * Viral Social Sharing System — types (Prompt 121).
 */

export const ACHIEVEMENT_SHARE_TYPES = [
  'winning_matchup',
  'winning_league',
  'high_scoring_team',
  'bracket_success',
  'rivalry_win',
  'playoff_qualification',
  'championship_win',
  'great_waiver_pickup',
  'great_trade',
  'major_upset',
  'top_rank_legacy',
] as const;

export type AchievementShareType = (typeof ACHIEVEMENT_SHARE_TYPES)[number];

export interface AchievementShareContext {
  leagueName?: string;
  leagueId?: string;
  score?: number;
  opponentName?: string;
  week?: number;
  teamName?: string;
  sport?: string;
  /** Bracket / playoff context */
  bracketName?: string;
  round?: string;
  /** Rivalry / opponent */
  rivalryName?: string;
  /** Waiver / trade */
  playerName?: string;
  /** Rank / tier */
  rank?: number;
  tier?: string;
  [key: string]: unknown;
}

export interface ShareContent {
  title: string;
  text: string;
  hashtags: string[];
}

