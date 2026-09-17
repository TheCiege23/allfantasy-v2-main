/**
 * DYNASTY AF WAR ROOM — shared types & data-availability contract.
 *
 * CONTRACT (mirrors the redraft War Room, but DYNASTY horizon):
 * - `dynastyWarRoomContext.ts` is the authoritative, deterministic, serializable
 *   context. Engines are pure functions over it; AI explains, never invents.
 * - Dynasty values are long-term asset values (FantasyCalc/dynasty-ADP) + AGE
 *   trajectory + future pick capital — NOT redraft short-season points.
 * - Weekly projections matter only for contenders' start/sit.
 * - Never fabricate values, ages, picks, injuries, or news. Missing → flagged.
 * - NFL pools never mix with NCAAF pools (sport carried through).
 */

/**
 * `available_empty` = the backing table EXISTS but holds no rows for this league
 * (a truthful "tracking enabled, nothing recorded yet" state). Distinct from
 * `missing` (table/provider not available at all). Used by futurePicks.
 *
 * `partial` = what is listed is real but KNOWN to be incomplete, so it must not be totalled or
 * counted as the whole. futurePicks: an imported league whose draft size is unknown lists only the
 * picks that changed hands, never each team's own. Engines that need the whole set check for
 * `available`, so they skip it.
 */
export type DataState = 'available' | 'stale' | 'missing' | 'available_empty' | 'partial'

export interface DynastyDataAvailability {
  scoringRules: DataState
  rosterRules: DataState
  standings: DataState
  rosters: DataState
  playerValues: DataState
  playerAges: DataState
  futurePicks: DataState
  injuries: DataState
  news: DataState
  projections: DataState
  freeAgentPool: DataState
}

export interface DynastyFreshness {
  generatedAt: string
  valuesAsOf: string | null
  injuriesAsOf: string | null
}

export interface DynastyScoringSettings {
  sport: string
  scoringPreset: string
  superflex: boolean
  tePremium: boolean
}

export interface DynastyRosterSettings {
  totalStarterSlots: number
  benchSlots: number
  taxiSlots: number
  irSlots: number
  requiredByPosition: Record<string, number>
}

export interface DynastyPlayerFact {
  playerId: string
  playerName: string
  position: string
  team: string | null
  /** roster slot category: starter | bench | taxi | ir | free_agent */
  slotType: string
  isStarterSlot: boolean
  age: number | null
  /** Dynasty asset value (higher = more valuable); from dynasty ADP/FantasyCalc when matched. */
  dynastyValue: number | null
  /** Average overall dynasty ADP (lower = more valued), when matched. */
  adp: number | null
  injuryStatus: string | null
  /** Current-week projection — only used for contender start/sit, else null. */
  weekProjection: number | null
  /** True when no value/ADP/projection signal exists for this player. */
  hasNoValueSignal: boolean
}

export interface DynastyFuturePick {
  /**
   * Stable id — used to reference a pick in the War Room's trade tools. `future_draft_picks.id` for a
   * native league; `fdp:<season>:<round>:<team>` for an imported one, whose own picks have no row.
   */
  id: string
  season: number
  round: number
  /**
   * Original owner, in `Roster.id` space (immutable "home" of the pick). For an imported pick whose
   * original team has no roster here, the provider team id — which never equals a roster id.
   */
  originalRosterId: string | null
  /** The original team's name when the pick was acquired and the name is known. */
  originalTeamName?: string | null
  /** Roster currently holding the pick (differs from original when traded). */
  currentOwnerId: string | null
  /** True when this pick has changed hands at least once. */
  traded: boolean
  /** active | traded | forfeited | used (mirrors FutureDraftPickStatus). */
  status: string
  /**
   * Deterministic structural TIER derived ONLY from round + seasons-out (a known
   * rookie-pick scaling), used for relative comparison. This is NOT a market value
   * and is never fabricated from external data; null when round is unknown.
   */
  estValue: number | null
}

/** Rookie draft window state for a season (null when no window row exists). */
export interface DynastyRookieDraftWindow {
  season: number
  status: string
  draftOrderMethod: string
  scheduledDraftDate: string | null
}

export interface DynastyTeamSummary {
  rosterId: string
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  playoffSeed: number | null
  isUserTeam: boolean
  players: DynastyPlayerFact[]
  /** Future picks owned by this team (empty when pick data is unavailable). */
  picks: DynastyFuturePick[]
}

export type ContentionWindow = 'contend' | 'rebuild' | 'middle' | 'unknown'

/** The one canonical, serializable dynasty War Room context object. */
export interface DynastyWarRoomContext {
  leagueId: string
  leagueType: 'dynasty'
  sport: string
  season: number
  scoring: DynastyScoringSettings
  roster: DynastyRosterSettings
  /** The viewer's own roster id (null for commissioner with no team). */
  userRosterId: string | null
  isCommissioner: boolean
  teams: DynastyTeamSummary[]
  freeAgents: DynastyPlayerFact[]
  /** Rookie draft windows for upcoming seasons (empty when none recorded). */
  rookieDraftWindows: DynastyRookieDraftWindow[]
  availability: DynastyDataAvailability
  freshness: DynastyFreshness
  missingDataFlags: string[]
  featureAvailability: {
    teamDirection: boolean
    rosterNeeds: boolean
    tradeAnalyze: boolean
    tradeFind: boolean
    buySellHold: boolean
    waivers: boolean
    lineup: boolean
    pickValue: boolean
  }
}

export type DynastyWarRoomAction =
  | 'team-direction'
  | 'buy-sell-hold'
  | 'trade-analyze'
  | 'trade-find'
  | 'waivers'
  | 'lineup'
  | 'ask'
