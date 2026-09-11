import type { ResourceFetchStatus } from '@/lib/league-import/resourceStatus'
export interface YahooImportLeague {
  leagueKey: string
  leagueId: string
  name: string
  sport: string
  season: number | null
  numTeams: number
  draftStatus: string | null
  currentWeek: number | null
  startWeek: number | null
  endWeek: number | null
  isFinished: boolean
  url?: string | null
}

export interface YahooImportSettings {
  draftType: string | null
  scoringType: string | null
  usesPlayoff: boolean | null
  playoffStartWeek: number | null
  usesPlayoffReseeding: boolean | null
  usesLockEliminatedTeams: boolean | null
  usesFaab: boolean | null
  tradeEndDate: string | null
  tradeRatifyType: string | null
  rosterPositions: Array<{ position: string; count: number }>
  statCategories: Array<{
    statId: string
    name: string | null
    displayName: string | null
    enabled: boolean | null
    positionType: string | null
  }>
  statModifiers: Array<{ statId: string; value: number }>
  raw: Record<string, unknown>
}

export interface YahooImportTeam {
  teamKey: string
  teamId: string
  managerId: string
  managerGuid?: string | null
  managerName: string
  teamName: string
  logoUrl: string | null
  wins: number
  losses: number
  ties: number
  rank: number | null
  pointsFor: number
  pointsAgainst: number | null
  faabBalance: number | null
  waiverPriority: number | null
  clinchedPlayoffs: boolean
  rosterPlayerIds: string[]
  starterPlayerIds: string[]
  reservePlayerIds: string[]
  playerMap: Record<string, { name: string; position: string; team: string }>
  /*
   * 🛑 IMP-04 — WHY THIS TEAM'S ROSTER ARRAYS LOOK THE WAY THEY DO.
   *
   * Yahoo fetches every team's roster with `Promise.allSettled`, and a REJECTED fetch
   * used to be substituted with empty player/starter/reserve arrays. Downstream that is
   * indistinguishable from a genuinely empty roster, so the shared bootstrap wrote the
   * empty arrays to `Roster` and a transient timeout on one of twelve teams silently
   * cleared a good roster.
   *
   * `fetched` means the arrays are authoritative and may replace stored data.
   * `failed` means they are a PLACEHOLDER — the team's last-good roster must be kept.
   */
  rosterFetchStatus: ResourceFetchStatus
}

export interface YahooImportScheduleWeek {
  week: number
  season: number
  matchups: Array<{
    teamKey1: string
    teamKey2: string
    points1?: number
    points2?: number
  }>
}

export interface YahooImportTransaction {
  transactionId: string
  type: string
  status: string
  createdAt: string | null
  teamKeys: string[]
  adds: Record<string, string>
  drops: Record<string, string>
}

export interface YahooImportDraftPick {
  round: number
  pickNumber: number
  teamKey: string
  playerId: string
  playerName?: string | null
  position?: string | null
  team?: string | null
}

export interface YahooImportPayload {
  sourceInput: string
  resolvedFromLeagueList: boolean
  league: YahooImportLeague
  settings: YahooImportSettings | null
  teams: YahooImportTeam[]
  schedule: YahooImportScheduleWeek[]
  scheduleWeeksExpected: number | null
  scheduleWeeksCovered: number
  transactions: YahooImportTransaction[]
  draftPicks: YahooImportDraftPick[]
  previousSeasons: Array<{
    season: string
    sourceLeagueId: string
  }>
  /** Yahoo team_key for the OAuth user when `managerGuid` matches logged-in guid. */
  viewerTeamKey?: string | null
  /** Team keys flagged as commissioner/co-commissioner in Yahoo manager metadata. */
  commissionerTeamKeys?: string[]
  /**
   * Teams whose roster request REJECTED — IMP-04. Their `rosterPlayerIds` etc. are an
   * empty placeholder, not an observation, and must never replace stored roster rows.
   * Empty array means every team's roster was fetched successfully.
   */
  failedRosterTeamKeys?: string[]
}
