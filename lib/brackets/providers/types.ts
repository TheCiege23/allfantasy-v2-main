type ProviderCapability =
  | "bracket_seeding"
  | "schedule"
  | "live_scores"
  | "play_by_play"
  | "team_stats"
  | "injuries"
  | "odds"

export type CapabilityScore = Record<ProviderCapability, boolean>

export type NcaabTeamSeed = {
  teamName: string
  seed: number
  region: string
}

export type NcaabGame = {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeSeed?: number | null
  awaySeed?: number | null
  homeScore: number | null
  awayScore: number | null
  status: "scheduled" | "in_progress" | "final" | "unknown"
  startTime: Date | null
  round?: number | null
  region?: string | null
  venue?: string | null
}

export type PlayByPlayEvent = {
  gameId: string
  timestamp: Date
  clock: string
  period: number
  eventType: "score" | "foul" | "timeout" | "turnover" | "other"
  description: string
  homeScore: number
  awayScore: number
  team?: string | null
  player?: string | null
}

export type TournamentField = {
  season: number
  teams: NcaabTeamSeed[]
  isFieldSet: boolean
  lockTime: Date | null
}

export interface BracketDataProvider {
  readonly name: string
  readonly id: string

  capabilities(): Promise<CapabilityScore>
  capabilityScore(): Promise<number>

  checkHealth(): Promise<boolean>

  getTournamentField(season: number): Promise<TournamentField | null>
  getSchedule(season: number): Promise<NcaabGame[]>
  getLiveScores(gameIds?: string[]): Promise<NcaabGame[]>
  getPlayByPlay?(gameId: string): Promise<PlayByPlayEvent[]>
}
