import type { Prisma } from "@prisma/client"

/** Sports game row used for bracket timing (game lock / start). */
export type BracketSportsGameTiming = Prisma.SportsGameGetPayload<{
  select: { id: true; startTime: true }
}>

/** Sports game row for live bracket + scoring helpers. */
export type BracketSportsGameLiveMeta = Prisma.SportsGameGetPayload<{
  select: {
    id: true
    homeTeam: true
    awayTeam: true
    homeScore: true
    awayScore: true
    status: true
    startTime: true
    venue: true
    fetchedAt: true
  }
}>

/** Sports game row for global rankings score lookups. */
export type BracketSportsGameScoresOnly = Prisma.SportsGameGetPayload<{
  select: {
    id: true
    homeTeam: true
    awayTeam: true
    homeScore: true
    awayScore: true
    status: true
  }
}>

/** Bracket entry + user + league for leaderboard API rows. */
export type BracketEntryLeaderboardInclude = Prisma.BracketEntryGetPayload<{
  include: {
    user: { select: { id: true; displayName: true; avatarUrl: true } }
    league: { select: { id: true; name: true; tournamentId: true } }
  }
}>

/** Bracket entry shape used by global rankings aggregation. */
export type BracketEntryGlobalRankingsInclude = Prisma.BracketEntryGetPayload<{
  include: {
    user: { select: { id: true; displayName: true; avatarUrl: true } }
    picks: { select: { nodeId: true; isCorrect: true; pickedTeamName: true } }
    league: { select: { name: true; id: true } }
  }
}>

/** Bracket entry + picks + user for live standings section. */
export type BracketEntryLiveStandingsInclude = Prisma.BracketEntryGetPayload<{
  include: {
    user: { select: { id: true; displayName: true; avatarUrl: true } }
    picks: true
  }
}>
