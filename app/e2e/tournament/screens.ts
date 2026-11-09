/** Plain module (not 'use client') so the server page can read the list as a value. */
export const TOURNAMENT_HARNESS_SCREENS = ['home', 'standings', 'league', 'progress', 'drafts', 'forum', 'history'] as const
export type TournamentHarnessScreen = (typeof TOURNAMENT_HARNESS_SCREENS)[number]
