export interface FantraxImportLeague {
  leagueId: string
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
  league: FantraxImportLeague
  settings: FantraxImportSettings | null
  teams: FantraxImportTeam[]
  schedule: FantraxImportScheduleWeek[]
  transactions: FantraxImportTransaction[]
  draftPicks: FantraxImportDraftPick[]
  playerMap: Record<string, { name: string; position: string; team: string }>
  previousSeasons: Array<{
    season: string
    sourceLeagueId: string
  }>
}
