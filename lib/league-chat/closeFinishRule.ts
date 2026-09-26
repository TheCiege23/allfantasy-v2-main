/**
 * What "close" means when Chimmy calls a game. PURE, dependency-free.
 *
 * A matchup decided (not tied) by at most this many fantasy points is a close finish. The weekly
 * recap's "My call" line for the narrow escape and the close-finish moment
 * (lib/league-chat/weekMatchupMoments.ts) both read this one constant, so the two posts can never
 * disagree about which game was close. Points rather than a percentage because the recap has called
 * "3 or less" the narrow escape since it was written.
 */
export const CLOSE_FINISH_MAX_MARGIN = 3
