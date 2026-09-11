import type { ResourceFetchStatus } from '@/lib/league-import/resourceStatus'
export interface EspnImportLeague {
  leagueId: string
  name: string
  sport: string
  season: number | null
  size: number
  currentWeek: number | null
  isFinished: boolean
  playoffTeamCount: number | null
  regularSeasonLength: number | null
}

export interface EspnImportSettings {
  scoringType: string | null
  draftType: string | null
  lineupSlotCounts: Array<{ slotId: number; slot: string; count: number }>
  scoringItems: Array<{ statId: number; points: number }>
  usesFaab: boolean
  acquisitionBudget: number | null
  waiverProcessDay: number | null
  playoffTeamCount: number | null
  matchupPeriodCount: number | null
  regularSeasonMatchupCount: number | null
  raw: Record<string, unknown>
}

export interface EspnImportTeam {
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
  /**
   * Whether this team's roster lists were OBSERVED — IMP-04.
   *
   * 🛑 ESPN SERVES EVERY ROSTER FROM ONE `mRoster` VIEW, AND `team.roster?.entries` QUIETLY
   * YIELDS EMPTY LISTS WHEN THAT VIEW IS ABSENT FROM AN OTHERWISE-SUCCESSFUL RESPONSE. So the
   * failure is not per-team like Yahoo's — it is the whole league at once, presenting as a
   * pre-draft league with twelve empty rosters. `not_fetched` says the view never arrived.
   */
  rosterFetchStatus: ResourceFetchStatus
}

export interface EspnImportScheduleWeek {
  week: number
  season: number
  matchups: Array<{
    teamId1: string
    teamId2: string
    points1?: number
    points2?: number
  }>
}

export interface EspnImportTransaction {
  transactionId: string
  type: string
  typeDescription: string | null
  status: string
  createdAt: string | null
  teamIds: string[]
  adds: Record<string, string>
  drops: Record<string, string>
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  bidAmount?: number | null
  tradePartnerTeamId?: string | null
  messageTypeId?: number | null
}

export interface EspnImportDraftPick {
  round: number
  pickNumber: number
  overallPickNumber: number
  teamId: string
  playerId: string
  playerName?: string | null
  position?: string | null
  team?: string | null
  sourceDraftId?: string | null
  bidAmount?: number | null
  isKeeper?: boolean | null
}

export interface EspnImportPayload {
  sourceInput: string
  league: EspnImportLeague
  settings: EspnImportSettings | null
  teams: EspnImportTeam[]
  schedule: EspnImportScheduleWeek[]
  transactions: EspnImportTransaction[]
  draftPicks: EspnImportDraftPick[]
  transactionsFetched: boolean
  draftFetched: boolean
  previousSeasons: Array<{
    season: string
    sourceLeagueId: string
  }>
  /** Logged-in user's team id when ESPN cookies identify the member in `raw` members/teams. */
  viewerTeamId?: string | null
  /** Team ids owned by members flagged as league manager/commissioner in ESPN member data. */
  commissionerTeamIds?: string[]
}
