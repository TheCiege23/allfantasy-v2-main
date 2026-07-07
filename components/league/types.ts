export type LeagueTopTab = 'DRAFT' | 'TEAM' | 'PLAYERS' | 'LEAGUE'

export type LeaguePlayersSubtab = 'search' | 'trend' | 'available' | 'leaders' | 'trade'

export type LeagueVariantMode = 'standard' | 'devy' | 'c2c'

export type LeagueRecord = {
  wins: number
  losses: number
  ties: number
}

export type LeagueLifecycleSnapshot = {
  state: string
  locked: boolean
  emergencyPaused: boolean
  allowedActions: string[]
}

/** Authoritative role flags from GET `/api/leagues/:id/lifecycle` (preferred over SSR `leagueRole` when present). */
export type LeagueLifecyclePermissions = {
  isElevatedCommissioner: boolean
  isHeadCommissioner: boolean
}

export type LeagueHeaderInfo = {
  id: string
  name: string
  sport: string
  season: number | null
  leagueSize: number | null
  avatarUrl: string | null
  leagueVariant: string | null
  leagueType: string | null
  isDynasty: boolean
  /** Sleeper-style scoring week when present in league settings JSON (e.g. `settings.leg`). */
  currentWeek?: number | null
  /** Canonical lifecycle + permission hints for League Status Bar / commissioner UI. */
  lifecycle?: LeagueLifecycleSnapshot
}

export type LeagueTeamRow = {
  id: string
  externalId: string
  rank: number
  name: string
  handle: string | null
  avatarUrl: string | null
  faab: number | null
  waiverPriority: number | null
  draftPosition: number | null
  record: LeagueRecord
  pointsFor: number
  pointsAgainst: number
  isCurrentUser: boolean
}

export type LeagueScoringRow = {
  id: string
  label: string
  value: string
  numericValue: number
  isPositive: boolean
  isNegative: boolean
  isHighlighted: boolean
}

export type LeagueScoringSection = {
  id: string
  title: string
  rows: LeagueScoringRow[]
}

export type LeagueSettingsItem = {
  id: string
  label: string
  value: string
  badge?: string | null
}

export type ResolvedLeaguePlayer = {
  id: string
  name: string
  position: string
  team: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  injuryStatus: string | null
  rosterPercent: number | null
  startPercent: number | null
  score: number | null
  trendValue: number | null
  adp: number | null
  ownerLabel?: string | null
  source?: 'pro' | 'college'
  collegeSport?: string | null
  school?: string | null
  conference?: string | null
  classYearLabel?: string | null
  draftGrade?: string | null
  draftYear?: number | null
  projectedLandingSpot?: string | null
  nextGameLabel?: string | null
  badges?: string[]
  stats: Array<{ label: string; value: string }>
}

export type LeagueRosterSlot = {
  id: string
  slot: string
  slotLabel: string
  pill: string
  player: ResolvedLeaguePlayer
}

export type LeagueRosterSection = {
  id: string
  title: string
  emptyLabel: string
  items: LeagueRosterSlot[]
}

export type LeagueRosterCard = {
  rosterId: string
  sourceTeamId: string | null
  teamId: string | null
  teamName: string
  ownerName: string | null
  avatarUrl: string | null
  record: LeagueRecord
  faabRemaining: number | null
  waiverPriority: number | null
  overRosterLimitBy: number
  sections: LeagueRosterSection[]
  collegeSections?: LeagueRosterSection[]
  draftPicks: string[]
}

export type LeagueActivityLine = {
  type: 'add' | 'drop' | 'note'
  label: string
  playerName?: string | null
  playerMeta?: string | null
  headshotUrl?: string | null
}

export type LeagueActivityItem = {
  id: string
  type: 'waiver' | 'trade' | 'message'
  managerName: string
  badge: string
  badgeTone: 'neutral' | 'teal' | 'green'
  timestamp: string
  amountLabel?: string | null
  summary?: string | null
  lines: LeagueActivityLine[]
}

export type LeagueTradeAsset = {
  id: string
  label: string
  sublabel: string | null
  headshotUrl: string | null
  accent: 'teal' | 'blue' | 'orange' | 'slate'
}

export type LeagueTradeHistoryItem = {
  id: string
  direction: 'incoming' | 'outgoing' | 'complete'
  partnerName: string
  timestamp: string
  sent: LeagueTradeAsset[]
  received: LeagueTradeAsset[]
  /** Real `AfLeagueTrade.status` (e.g. 'pending', 'awaiting_commissioner', 'accepted').
   *  Optional so pre-existing Sleeper-sourced rows (which never set this) keep working. */
  status?: string
  /** True when the viewer is this league's commissioner and can approve/veto. */
  viewerIsCommissioner?: boolean
  /** True when the viewer is the receiving roster on this trade (can accept/reject). */
  viewerIsReceiver?: boolean
  /** True when the viewer is the proposing roster on this trade (can cancel). */
  viewerIsProposer?: boolean
}

export type LeagueTradeBlockItem = {
  id: string
  name: string
  sublabel: string
  headshotUrl: string | null
  accent: 'teal' | 'blue' | 'orange' | 'slate'
}

/** Trade block row for league Trades tab (DB + owner display). */
export type LeagueTradeBlockPanelItem = {
  id: string
  playerId: string
  name: string
  position: string
  team: string | null
  ownerName: string
}

export type LeagueTradesData = {
  tradeBlock: LeagueTradeBlockItem[]
  activeTrades: LeagueTradeHistoryItem[]
  history: LeagueTradeHistoryItem[]
}

export type LeagueSearchDefenseItem = {
  id: string
  name: string
  teamCode: string | null
  logoUrl: string | null
  watchLabel: string
}

export type LeaguePlayersData = {
  search: LeagueSearchDefenseItem[]
  trend: ResolvedLeaguePlayer[]
  available: ResolvedLeaguePlayer[]
  leaders: ResolvedLeaguePlayer[]
  college: {
    trend: ResolvedLeaguePlayer[]
    available: ResolvedLeaguePlayer[]
    leaders: ResolvedLeaguePlayer[]
    availablePositions: string[]
    availableSports: string[]
  } | null
}

export type LeagueVariantSummary = {
  mode: LeagueVariantMode
  collegeSports: string[]
  devy: {
    slotCount: number
    irSlots: number
    taxiSlots: number
    scoringEnabled: boolean
  } | null
  c2c: {
    rosterSize: number
    scoringSystem: string
    standingsModel: string
    mixProPlayers: boolean
  } | null
}

export type LeagueDraftSummaryCard = {
  id: string
  title: string
  description: string
  values: Array<{ label: string; value: string }>
}

export type LeagueIntroVideoData = {
  title: string
  subtitle: string
  introVideo: string
  thumbnail: string
  fallbackCopy: string
  shouldAutoOpen: boolean
}

export type LeagueStorylineCardData = {
  title: string
  summary: string
  body?: string | null
  createdAtLabel: string
}

export type LeagueMatchupPreviewCardData = {
  headline: string
  summary: string
  confidenceLabel: string | null
}

export type LeagueKeeperDeclarationItem = {
  id: string
  playerName: string
  status: string
  costLabel: string
}

export type LeaguePowerRankingItem = {
  id: string
  rank: number
  name: string
  record: string
  pointsFor: string
}

export type LeagueBracketMatchupTeam = {
  seed: number | null
  name: string
  avatarUrl: string | null
  score: number | null
  isCurrentUser: boolean
}

export type LeagueBracketMatchup = {
  id: string
  label: string
  teamA: LeagueBracketMatchupTeam | null
  teamB: LeagueBracketMatchupTeam | null
}

export type LeagueBracketRound = {
  id: string
  title: string
  subtitle: string
  matchups: LeagueBracketMatchup[]
}

export type LeaguePlayoffBracketData = {
  rounds: LeagueBracketRound[]
}

export type LeagueChatPreview = {
  href: string
  preview: string
  senderName: string | null
}

export type LeagueHomeData = {
  league: LeagueHeaderInfo
  variant: LeagueVariantSummary
  introVideo: LeagueIntroVideoData | null
  currentUserId: string
  isCommissioner: boolean
  /** Resolved role for permission gating in the shell. */
  leagueRole: 'commissioner' | 'co_commissioner' | 'member' | 'viewer' | null
  activeTab: LeagueTopTab
  teamsInDraftOrder: LeagueTeamRow[]
  standings: LeagueTeamRow[]
  settingsItems: LeagueSettingsItem[]
  scoringSections: LeagueScoringSection[]
  roster: LeagueRosterCard
  activity: LeagueActivityItem[]
  trades: LeagueTradesData
  players: LeaguePlayersData
  draftSummaryCards: LeagueDraftSummaryCard[]
  storyline: LeagueStorylineCardData | null
  matchupPreview: LeagueMatchupPreviewCardData | null
  draftRecap: LeagueStorylineCardData | null
  constitution: LeagueStorylineCardData | null
  keeperDeclarations: LeagueKeeperDeclarationItem[]
  powerRankings: LeaguePowerRankingItem[]
  bracket: LeaguePlayoffBracketData
  chat: LeagueChatPreview
}
