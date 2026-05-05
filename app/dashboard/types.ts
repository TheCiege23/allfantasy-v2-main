/** Legacy pixel hints; desktop shells use ~35% / 35% / 30% for left/center/right — see `app/components/AppShell.tsx`. */
export const DASHBOARD_LEFT_PANEL_WIDTH = 280
export const DASHBOARD_RIGHT_PANEL_WIDTH = 200

export type LeagueListStatus = 'pre_draft' | 'drafting' | 'in_season' | 'complete' | string

export interface UserLeague {
  id: string
  name: string
  /** Source platform — always set by list/detail mappers */
  platform: 'sleeper' | 'yahoo' | 'espn' | 'cbs' | string
  /** Normalized sport — always set by list/detail mappers */
  sport: 'NFL' | 'NBA' | 'MLB' | 'NHL' | string
  format: string
  scoring?: string
  teamCount: number
  season?: number | string
  status?: LeagueListStatus
  /** Sleeper-style current week label when in season */
  currentWeek?: number | null
  isDynasty?: boolean
  settings?: Record<string, unknown>
  sleeperLeagueId?: string
  /** Sleeper avatar id — resolved to sleepercdn.com/avatars/{id} in UI */
  avatarUrl?: string | null
  /** ISO string from league detail / Sleeper draft when available */
  draftDate?: string | null
  /** Prisma `League.leagueVariant` when provided (e.g. big_brother, zombie). */
  leagueVariant?: string | null
  /** Prisma `League.leagueType` when provided (redraft, dynasty, keeper, …). */
  leagueType?: string | null
  /** Prisma `League.guillotineMode` when provided */
  guillotineMode?: boolean | null
  /** Prisma `League.keeperPhaseActive` when provided */
  keeperPhaseActive?: boolean | null
  /** Prisma `League.bestBallMode` when provided */
  bestBallMode?: boolean | null
  /** True if the current user is commissioner (Sleeper is_owner sync) or owns a native AllFantasy league */
  isCommissioner?: boolean
  /** User relationship to this league row */
  userRole?: 'commissioner' | 'member' | 'imported'
  /** Entry fee or buy-in detected in league settings */
  isPaid?: boolean
  /** Entry fee in USD when present */
  entryFee?: number | null
}

/** First tab to show in `LeftChatPanel` (from `?openChat=` on `/league/[id]`). */
export type LeftChatInitialTab = 'league' | 'chimmy' | 'af_huddle' | 'dms'

/** Props contract for `LeftChatPanel` (shared with /dashboard and /league/[id]) */
export type LeftChatPanelLayoutProps = {
  selectedLeague: UserLeague | null
  /** Active league from route / right panel — syncs Chimmy context when it changes */
  activeLeagueId?: string | null
  userId: string
  /** For chat bubbles (avatar + display name) */
  userDisplayName?: string
  userImage?: string | null
  rootId?: string | null
  /** Dashboard home: connected leagues for Chimmy context selector */
  leagues?: UserLeague[]
  /** Discord OAuth linked (UserProfile.discordUserId) — DMs tab CTA */
  discordConnected?: boolean
  /** `?zombieChimmy=` deep link → league chat composer */
  zombieChimmyPrefill?: string | null
  /**
   * Which left-rail tab is active on first paint (`?openChat=league|chimmy|dms|af_huddle`).
   * When omitted: league chat if `selectedLeague` is set, otherwise Chimmy.
   */
  initialOpenChat?: LeftChatInitialTab | null
  /** Leagues the user commissions — for @global broadcast modal */
  commissionerLeagues?: { id: string; name: string; teamCount: number }[]
}

/** Props contract for `RightControlPanel` */
export type RightControlPanelLayoutProps = {
  leagues: UserLeague[]
  leaguesLoading: boolean
  selectedId: string | null
  /** Optional alias for selectedId (same value from shell / route) */
  activeLeagueId?: string | null
  onSelectLeague: (league: UserLeague | null) => void
  userId: string
  /** Display name (session name / email / Manager) */
  userName: string
  /** Resolved avatar URL (optional); hash-only values resolved server-side */
  userImage?: string | null
  /** e.g. plan tier; when absent, footer shows "AllFantasy" as subtitle */
  userSubtitle?: string | null
  onImport: () => void
  onAfterLeagueNavigate?: () => void
  /** Called before navigating to Settings (e.g. close mobile leagues sheet). */
  onSettingsNavigate?: () => void
  /** Refetch league list (e.g. after Sleeper refresh) */
  onLeaguesRefresh?: () => void
  /** Optimistically drop a league from local state after successful remove-from-list */
  onLeagueRemoved?: (leagueId: string) => void
  /** Desktop: collapse the My Leagues rail so the center workspace widens */
  onRailCollapse?: () => void
  /** Dashboard cleanup — hide the MY LEAGUES list section while keeping the profile footer + gear menu. */
  hideLeagueList?: boolean
  /** Inline `?leagueId=` selection on primary click — keeps three-panel shell on `/dashboard`. */
  inlineDashboardSelect?: boolean
}

export interface DashboardConnectedLeague extends UserLeague {
  sourceLeagueId: string
  syncStatus?: string | null
  platformLeagueId?: string | null
}

export interface LeagueTeamSlot {
  id: string
  externalId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  /** Sleeper owner user_id when synced */
  platformUserId?: string | null
  role: string
  isOrphan: boolean
  claimedByUserId: string | null
  draftPosition: number | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  /** Platform standing / finish rank when synced (lower is better). */
  currentRank: number | null
  /** Remaining FAAB — from linked `Roster` when available. */
  faabRemaining: number | null
  waiverPriority: number | null
  /** AF `LeagueDivision.id` when assigned */
  divisionId: string | null
}

/** League team row for tab UIs (draft, league, trades) */
export type UserLeagueTeam = LeagueTeamSlot

export interface LeagueDetail {
  id: string
  name: string
  sport: string
  format: string
  scoring: string
  teamCount: number
  season: number | null
  platform: string
  isDynasty: boolean
  settings: Record<string, unknown> | null
  userRole: string
  inviteToken: string | null
  inviteUrl: string | null
  draftDate: string | null
  draftStatus: string | null
  teams: LeagueTeamSlot[]
}

export interface LeagueChatMessage {
  id: string
  author_display_name: string
  author_avatar: string | null
  /** Unix ms (Sleeper-style) */
  created: number
  text: string
  messageType: string
  relativeTime: string
  createdAt: string
}

export interface ChecklistStep {
  id: string
  label: string
  description: string
  done: boolean
  ctaHref?: string
  ctaLabel?: string
}

export type LeagueTab =
  | 'draft'
  | 'team'
  | 'league'
  | 'players'
  | 'trend'
  | 'trades'
  | 'scores'

export type AFChatTab = 'chimmy' | 'direct' | 'af_huddle' | 'dms' | 'league'
