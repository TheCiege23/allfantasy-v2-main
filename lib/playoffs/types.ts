export type PlayoffSport = "nba" | "nhl"

export type PlayoffRoundKey = "round_1" | "conference_semifinals" | "conference_finals" | "finals"

export type PlayoffSeriesStatus = "scheduled" | "in_progress" | "final"

export type PlayoffSeriesSlot = "home" | "away"

export type PlayoffConference = "east" | "west" | "finals"

export type PlayoffChallengeView = {
  /** Present when authenticated; drives entry scoping vs requestedEntryId. */
  viewerUserId?: string | null
  challenge: {
    id: string
    name: string
    ownerUserId: string
    sport: PlayoffSport
    seasonYear: number
    status: string
    isTestMode: boolean
    visibility: "private" | "public"
    maxParticipants: number
    maxEntriesPerParticipant: number
    scoringStyle: string
    lockRule: string
    inviteCode: string
    inviteUrl: string
    createdAt: string
    updatedAt: string
  }
  participants: Array<{
    userId: string
    displayName: string
    entryCount: number
  }>
  activeEntry: {
    id: string
    name: string
    userId: string
    pickCount: number
    isComplete: boolean
    createdAt: string
  } | null
  entries: Array<{
    id: string
    name: string
    userId: string
    pickCount: number
    isComplete: boolean
    createdAt: string
  }>
  series: PlayoffSeriesView[]
  picks: PlayoffPickView[]
  rounds: PlayoffRoundKey[]
}

export type PlayoffSeriesView = {
  id: string
  round: PlayoffRoundKey
  roundIndex: number
  seriesNumber: number
  conference: PlayoffConference
  homeSeed: number
  awaySeed: number
  homeTeamName: string
  awayTeamName: string
  winnerTeamName: string | null
  bestOf: number
  status: PlayoffSeriesStatus
  startsAt: string | null
  nextSeriesNumber: number | null
  nextSeriesSlot: PlayoffSeriesSlot | null
  /** Prior series supplying the home participant (seriesNumber); null when round-1 matchup. */
  sourceSeriesHome: number | null
  /** Prior series supplying the away participant (seriesNumber); null when round-1 matchup. */
  sourceSeriesAway: number | null
}

export type PlayoffPickView = {
  id: string
  entryId: string
  seriesId: string
  pickTeamName: string
  createdAt: string
  updatedAt: string
}

export type BuildPlayoffTemplateInput = {
  sport: PlayoffSport
  seasonYear: number
  isTestMode?: boolean
}

export type PlayoffCreateResponse = {
  challengeId: string
  entryId: string | null
  sport: PlayoffSport
  name: string
  redirectUrl: string
}

export type PlayoffChallengeListItem = {
  challengeId: string
  sport: PlayoffSport
  name: string
  redirectUrl: string
  seasonYear: number
  participantCount: number
  entryCount: number
  inviteCode: string
}

export type PlayoffTemplateSeries = Omit<PlayoffSeriesView, "id">
