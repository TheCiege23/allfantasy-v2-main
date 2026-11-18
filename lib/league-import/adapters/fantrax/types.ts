export interface FantraxImportLeague {
  leagueId: string
  /** Real Fantrax league ID for live imports; CSV snapshots only have leagueId. */
  sourceLeagueId?: string | null
  name: string
  sport: string
  season: number | null
  size: number
  currentWeek: number | null
  isFinished: boolean
  url: string | null
  isDevy: boolean
}

export interface FantraxImportSettings {
  scoringType: string | null
  rosterPositions: Array<{ position: string; count: number }>
  /** Real per-team roster size, measured from the rosters. Null when unknown. */
  rosterSize: number | null
  scoringRules: Array<{ statKey: string; points: number }>
  raw: Record<string, unknown>
}

export interface FantraxImportTeam {
  teamId: string
  managerId: string
  managerName: string
  teamName: string
  logoUrl: string | null
  wins: number
  losses: number
  ties: number
  rank: number | null
  pointsFor: number
  pointsAgainst: number | null
  faabRemaining: number | null
  waiverPriority: number | null
  rosterPlayerIds: string[]
  starterPlayerIds: string[]
  reservePlayerIds: string[]
  playerMap: Record<string, { name: string; position: string; team: string }>
}

export interface FantraxImportScheduleWeek {
  week: number
  season: number
  matchups: Array<{
    teamId1: string
    teamId2: string
    points1?: number
    points2?: number
    isPlayoff?: boolean
  }>
}

export interface FantraxImportTransaction {
  transactionId: string
  type: string
  status: string
  createdAt: string | null
  teamIds: string[]
  adds: Record<string, string>
  drops: Record<string, string>
  isDraftPick?: boolean
  pickRound?: number | null
  pickNumber?: number | null
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
}

export interface FantraxImportDraftPick {
  round: number
  pickNumber: number
  teamId: string
  playerId: string
  playerName?: string | null
  position?: string | null
  team?: string | null
}

export interface FantraxImportPayload {
  sourceInput: string
  /** Selected team's numeric source_team_id, independent of manager display name. */
  viewerTeamId?: string | null
  league: FantraxImportLeague
  settings: FantraxImportSettings | null
  teams: FantraxImportTeam[]
  schedule: FantraxImportScheduleWeek[]
  transactions: FantraxImportTransaction[]
  draftPicks: FantraxImportDraftPick[]
  /**
   * Set when `draftPicks` came from the league's stored draft board rather than
   * from traded-pick rows in an uploaded CSV. Lets coverage say how much of the
   * draft is on file instead of guessing from the pick count.
   */
  draftBoard?: {
    slots: number
    made: number
    outstanding: number
    state: string | null
  } | null
  /**
   * Future draft picks that have changed hands, in this payload's own team ids.
   *
   * Absent (undefined) = no pick inventory is on file for this league, so nothing
   * is known. Empty array = the inventory is on file and no pick is traded.
   * Untraded picks are not listed — the downstream table records ownership
   * CHANGES, and a row there is marked traded.
   */
  tradedPicks?: Array<{
    season: number
    round: number
    originalTeamId: string
    currentOwnerTeamId: string
  }>
  /** How the future-pick inventory broke down, for coverage. */
  futurePicks?: { total: number; traded: number; unmapped: number } | null
  playerMap: Record<string, { name: string; position: string; team: string }>
  previousSeasons: Array<{
    season: string
    sourceLeagueId: string
  }>
}
