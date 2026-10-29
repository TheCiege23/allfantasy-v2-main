export type LeagueTeamBrief = {
  id: string
  externalId?: string
  teamName: string
  ownerName: string
  avatarUrl?: string | null
  claimedByUserId?: string | null
  wins?: number
  losses?: number
  pointsFor?: number
  isCommissioner?: boolean
  isCoCommissioner?: boolean
}

export type LeagueSettingsApi = {
  userRole?: 'commissioner' | 'co_commissioner' | 'member' | null
  hasAfCommissionerSub?: boolean
  canEdit?: boolean
  league: {
    id: string
    name: string | null
    sport: string
    season: number
    timezone: string
    teamCount: number
    isDynasty: boolean
    leagueType?: string | null
    leagueVariant?: string | null
    platform?: string | null
    survivorMode?: boolean | null
    guillotineMode?: boolean | null
    bestBallMode?: boolean | null
    autoCoachEnabled?: boolean | null
    rosterSize: number | null
    totalRosterSlots: number
    teams: LeagueTeamBrief[]
  }
  settings: RawSettings | null
}

export type RawSettings = Record<string, unknown> & {
  id?: string
  draftDateUtc?: string | null
  timezone?: string | null
  draftType?: string
  pickTimerPreset?: string
  pickTimerCustomValue?: number | null
  rounds?: number
  draftOrderMethod?: string
  draftOrderSlots?: unknown
  draftOrderLocked?: boolean
  randomizeHistory?: unknown
  autostart?: boolean
  slowDraftPause?: boolean
  slowPauseFrom?: string | null
  slowPauseUntil?: string | null
  cpuAutoPick?: boolean
  aiAutoPick?: boolean
  keeperCount?: number
  keeperRoundCost?: boolean
  dynastyCarryover?: boolean
  playerPool?: string
  alphabeticalSort?: boolean
  aiQueueSuggestions?: boolean
  aiBestAvailable?: boolean
  aiRosterGuidance?: boolean
  aiScarcityAlerts?: boolean
  aiDraftGrade?: boolean
  aiSleeperAlerts?: boolean
  aiByeAwareness?: boolean
  aiStackSuggestions?: boolean
  aiRiskUpsideNotes?: boolean
  aiScope?: string
}
