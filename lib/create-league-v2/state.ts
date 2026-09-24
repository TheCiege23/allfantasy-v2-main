/**
 * Create League v2 — client-side state shape (concept-first unified flow).
 *
 * Collects: concept -> sport + scoring preset -> teams + name -> draft type.
 * On submit, translates into `POST /api/leagues` (canonical) or `POST /api/tournament/create`.
 */

import type { LeagueTypeId, DraftTypeId } from '@/lib/league-creation-wizard/types'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'
import {
  getDefaultBestBallSettings,
  type BestBallCreateSettings,
  type BestBallModeId,
} from '@/lib/bestball/rules'
import type { PremiumAdvancedCreateState } from '@/lib/create-league-v2/simple-create'

/** Wizard-level draft type — superset of Prisma's DraftTypeId to accommodate execution modes. */
export type WizardDraftType = DraftTypeId | 'team' | 'auto' | 'offline'

export type SupportedSport =
  | 'NFL'
  | 'NBA'
  | 'MLB'
  | 'NHL'
  | 'NCAAF'
  | 'NCAAB'
  | 'SOCCER'

export const SUPPORTED_SPORTS: SupportedSport[] = [
  'NFL',
  'NBA',
  'MLB',
  'NHL',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

export type TradeReviewMode = 'none' | 'commissioner' | 'league_vote'
export type PprMode = 'standard' | 'half' | 'full'
export type ScoringSource = 'af' | 'sleeper' | 'espn' | 'yahoo'
export type SoccerPipeline = 'mls' | 'euro'
export type LeaguePrivacy = 'public' | 'private'

export type DynastyDraftMode = 'scheduled' | 'offline'
export type DynastyRookieOrderMethod = 'reverse_standings' | 'max_pf' | 'lottery' | 'commissioner'
export type DynastyVisibility = 'public' | 'private'
export type DynastyMonetization = 'free' | 'paid'

export type CreateLeagueSectionKey = 'concept' | 'sport' | 'teams' | 'draft'
export type CreateMode = 'quick' | 'advanced'

export type DynastyCommissionerAiToggles = {
  scoringRecommendations: boolean
  rosterBalanceRecommendations: boolean
  playoffFormatRecommendations: boolean
  taxiRuleRecommendations: boolean
  draftSetupRecommendations: boolean
  antiTankingAlerts: boolean
  leagueHealthInsights: boolean
}

export type DynastyUserAiToggles = {
  dynastyOutlook: boolean
  rosterTimelineAnalysis: boolean
  contenderVsRebuilderGuidance: boolean
  startupDraftHelper: boolean
  rookieDraftHelper: boolean
  taxiStashRecommendations: boolean
  tradeAnalyzer: boolean
  futurePickValueGuidance: boolean
}

export interface DynastySetupState {
  startupDraftType: WizardDraftType
  draftMode: DynastyDraftMode
  draftDateUtc: string
  divisionCount: number
  scoringTemplateId: string
  rosterTemplateId: string
  playoffTeamCount: number
  playoffByeCount: number
  regularSeasonLength: number
  startupRosterDepth: number
  benchCount: number
  irCount: number
  taxiSlotCount: number
  taxiEligibilityYears: number
  taxiLockDeadlineWeek: number
  taxiAllowNonRookies: boolean
  taxiAllowMoveOutAfterDeadline: boolean
  rookieDraftRounds: number
  rookieDraftType: 'linear' | 'snake'
  rookieDraftOrderMethod: DynastyRookieOrderMethod
  futurePickTradeYears: number
  /** Option B slice: trailing startup-draft rounds become devy-only (NFL dynasty only). */
  devyRoundsEnabled: boolean
  devyRoundCount: number
  waiverType: 'faab' | 'rolling' | 'reverse_standings'
  faabBudget: number
  visibility: DynastyVisibility
  monetization: DynastyMonetization
  commissionerAi: DynastyCommissionerAiToggles
  userAi: DynastyUserAiToggles
  introVideoUrl: string
  introPosterUrl: string
}

/** Keeper league — persisted via `conceptSetup` → `mapKeeperCreationFromWizard` on the server. */
export interface KeeperSetupState {
  keeperMaxKeepers: number
  keeperMaxYears: number
  keeperRoundPenalty: number
  keeperWaiverAllowed: boolean
  /** Maps to League.keeperEligibilityRule */
  keeperEligibilityRule: 'any' | 'drafted_only' | 'no_waivers'
  introVideoUrl: string
  introPosterUrl: string
}

export interface BestBallSetupState extends BestBallCreateSettings {}

export function getDefaultKeeperSetup(): KeeperSetupState {
  return {
    keeperMaxKeepers: 3,
    keeperMaxYears: 3,
    keeperRoundPenalty: 1,
    keeperWaiverAllowed: true,
    keeperEligibilityRule: 'any',
    introVideoUrl: '/league-type-keeper-intro.mp4',
    introPosterUrl: '/league-type-keeper.png',
  }
}

export interface CreateLeagueV2State {
  creationMode: CreateMode
  /** Null until the user explicitly picks a league concept (concept-first). */
  leagueType: LeagueTypeId | null
  /** IDP is a modifier, not a format. When true, leagueType stays 'redraft' and we pass leagueVariant: 'IDP'. */
  idpSelected: boolean
  sport: SupportedSport
  /** Soccer-only: MLS vs European data pipeline. */
  soccerPipeline: SoccerPipeline | null
  /** Stable id from `lib/league-creation-preset/scoring-presets` */
  scoringPresetId: string
  teamCount: number
  /** Tournament-only: total managers across all feeder leagues. Must be one of TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED on the server. */
  tournamentPoolSize: number
  /** Survivor-only: number of tribes. Ignored for other league types. */
  survivorTribeCount: number
  draftType: WizardDraftType
  /** Third-round reversal — snake drafts only. */
  thirdRoundReversal: boolean
  name: string
  /** When false, name updates from smart defaults when concept/sport/teams change. */
  nameTouched: boolean
  description: string
  privacy: LeaguePrivacy
  draftDate: string
  draftTime: string
  timezone: string
  language: string
  scoringSource: ScoringSource
  tradeReviewMode: TradeReviewMode
  creatorRankLevel: number | null
  minRankLevel: number | null
  maxRankLevel: number | null
  dynasty: DynastySetupState
  keeper: KeeperSetupState
  bestBall: BestBallSetupState
  advancedSetup: PremiumAdvancedCreateState
  /** Legacy fields — derived from scoring preset on submit; kept for session hydration compatibility. */
  superflex: boolean
  tePremium: boolean
  tePremiumMultiplier: number
  pprMode: PprMode
}

function defaultDynastyBySport(sport: SupportedSport): Pick<DynastySetupState, 'benchCount' | 'irCount' | 'taxiSlotCount' | 'regularSeasonLength' | 'playoffTeamCount' | 'playoffByeCount' | 'startupRosterDepth'> {
  switch (sport) {
    case 'NBA':
      return { benchCount: 8, irCount: 3, taxiSlotCount: 4, regularSeasonLength: 20, playoffTeamCount: 6, playoffByeCount: 2, startupRosterDepth: 24 }
    case 'MLB':
      return { benchCount: 12, irCount: 4, taxiSlotCount: 6, regularSeasonLength: 21, playoffTeamCount: 6, playoffByeCount: 2, startupRosterDepth: 34 }
    case 'NHL':
      return { benchCount: 9, irCount: 3, taxiSlotCount: 4, regularSeasonLength: 21, playoffTeamCount: 6, playoffByeCount: 2, startupRosterDepth: 26 }
    case 'NCAAF':
      return { benchCount: 10, irCount: 2, taxiSlotCount: 4, regularSeasonLength: 12, playoffTeamCount: 4, playoffByeCount: 0, startupRosterDepth: 24 }
    case 'NCAAB':
      return { benchCount: 8, irCount: 2, taxiSlotCount: 3, regularSeasonLength: 16, playoffTeamCount: 4, playoffByeCount: 0, startupRosterDepth: 20 }
    case 'SOCCER':
      return { benchCount: 9, irCount: 2, taxiSlotCount: 4, regularSeasonLength: 34, playoffTeamCount: 4, playoffByeCount: 0, startupRosterDepth: 24 }
    case 'NFL':
    default:
      return { benchCount: 14, irCount: 3, taxiSlotCount: 5, regularSeasonLength: 14, playoffTeamCount: 6, playoffByeCount: 2, startupRosterDepth: 28 }
  }
}

export function getDefaultDynastySetup(sport: SupportedSport, draftType: WizardDraftType = 'snake'): DynastySetupState {
  const sportDefaults = defaultDynastyBySport(sport)
  return {
    startupDraftType: draftType,
    /*
     * 🛑 `'scheduled'` MADE THE DYNASTY FORM PERMANENTLY UNSUBMITTABLE, AND THE WIZARD HAD NO
     * WAY OUT OF IT.
     *
     * `form-completion.ts` raises a blocking `dynasty_draft_date` whenever the mode is
     * `scheduled` and `draftDateUtc` is empty, and it defaulted to `scheduled` with an empty
     * date. Nothing in the UI sets either field — `draftDateUtc` appears in exactly two places
     * in the codebase, this default and that validator — so the message ("set a date, or
     * switch draft mode to Offline") named two controls that do not exist. Production reflects
     * it: 165 dynasty leagues, every one an import, and ZERO created natively.
     *
     * ⚠ THE VALIDATION RULE IS KEPT, NOT DELETED. It is correct for anyone who does choose a
     * scheduled startup, and it will guard that choice the day the control exists. Only the
     * default moves.
     *
     * ⚠ AND NOTHING IS LOST BY DEFAULTING TO OFFLINE: the draft date is a real, editable
     * column (`LeagueSettings.draftDateUtc`) with a working post-create UI in
     * `DraftSettingsPanel`. This routes the commissioner to the screen that exists instead of
     * blocking creation on one that does not.
     */
    draftMode: 'offline',
    draftDateUtc: '',
    divisionCount: 0,
    scoringTemplateId: 'default',
    rosterTemplateId: `dynasty-${sport.toLowerCase()}`,
    playoffTeamCount: sportDefaults.playoffTeamCount,
    playoffByeCount: sportDefaults.playoffByeCount,
    regularSeasonLength: sportDefaults.regularSeasonLength,
    startupRosterDepth: sportDefaults.startupRosterDepth,
    benchCount: sportDefaults.benchCount,
    irCount: sportDefaults.irCount,
    taxiSlotCount: sportDefaults.taxiSlotCount,
    taxiEligibilityYears: 2,
    taxiLockDeadlineWeek: Math.max(1, Math.min(18, sportDefaults.regularSeasonLength - 1)),
    taxiAllowNonRookies: false,
    taxiAllowMoveOutAfterDeadline: true,
    rookieDraftRounds: 4,
    rookieDraftType: 'linear',
    rookieDraftOrderMethod: 'max_pf',
    futurePickTradeYears: 3,
    devyRoundsEnabled: false,
    devyRoundCount: 2,
    waiverType: 'faab',
    faabBudget: 100,
    visibility: 'private',
    monetization: 'free',
    commissionerAi: {
      scoringRecommendations: true,
      rosterBalanceRecommendations: true,
      playoffFormatRecommendations: true,
      taxiRuleRecommendations: true,
      draftSetupRecommendations: true,
      antiTankingAlerts: true,
      leagueHealthInsights: true,
    },
    userAi: {
      dynastyOutlook: true,
      rosterTimelineAnalysis: true,
      contenderVsRebuilderGuidance: true,
      startupDraftHelper: true,
      rookieDraftHelper: true,
      taxiStashRecommendations: true,
      tradeAnalyzer: true,
      futurePickValueGuidance: true,
    },
    introVideoUrl: '/league-type-dynasty-intro.mp4',
    introPosterUrl: '/league-type-dynasty.png',
  }
}

export function getDefaultBestBallSetup(
  sport: SupportedSport,
  mode: BestBallModeId = 'standard',
  draftType: WizardDraftType = 'snake',
): BestBallSetupState {
  return getDefaultBestBallSettings(sport, mode, draftType === 'auction' || draftType === 'linear' || draftType === 'offline' || draftType === 'auto' || draftType === 'snake' ? draftType : 'snake')
}

export const DEFAULT_V2_STATE: CreateLeagueV2State = {
  creationMode: 'quick',
  leagueType: null,
  idpSelected: false,
  sport: 'NFL',
  soccerPipeline: null,
  scoringPresetId: '',
  teamCount: 12,
  tournamentPoolSize: 32,
  survivorTribeCount: 4,
  draftType: 'snake',
  thirdRoundReversal: false,
  name: '',
  nameTouched: false,
  description: '',
  privacy: 'private',
  draftDate: '',
  draftTime: '',
  timezone: 'America/New_York',
  language: 'en',
  scoringSource: 'af',
  tradeReviewMode: 'commissioner',
  creatorRankLevel: null,
  minRankLevel: null,
  maxRankLevel: null,
  dynasty: getDefaultDynastySetup('NFL', 'snake'),
  keeper: getDefaultKeeperSetup(),
  bestBall: getDefaultBestBallSetup('NFL', 'standard', 'snake'),
  advancedSetup: {},
  superflex: false,
  tePremium: false,
  tePremiumMultiplier: 1.5,
  pprMode: 'half',
}

export const V2_STORAGE_KEY = 'af:create-league-v2:state'

export function loadPersistedV2State(): Partial<CreateLeagueV2State> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(V2_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CreateLeagueV2State>
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function persistV2State(state: CreateLeagueV2State): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(V2_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Quota / disabled storage — safe to ignore.
  }
}

export function clearPersistedV2State(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(V2_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function getEffectiveLeagueType(state: CreateLeagueV2State): LeagueTypeId | null {
  if (state.idpSelected) return 'redraft'
  return state.leagueType
}

export function isDynastyConcept(type: LeagueTypeId | null): boolean {
  return type === 'dynasty' || type === 'devy' || type === 'c2c'
}

/** Mirrors server-side TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED; keep in sync. */
export const TOURNAMENT_POOL_SIZE_OPTIONS: readonly number[] = [32, 64, 72, 96, 128, 144, 160, 192, 216, 224] as const

export { isFormComplete } from './form-completion'

/** @deprecated Multi-step flow removed — kept for imports that still reference page ids. */
export type V2PageId = 'setup' | 'identity' | 'scoring' | 'review'

/** @deprecated */
export const V2_PAGES: readonly V2PageId[] = ['setup', 'identity', 'scoring', 'review'] as const

/** @deprecated */
export const V2_PAGE_LABELS: Record<V2PageId, string> = {
  setup: 'Setup',
  identity: 'Identity',
  scoring: 'Scoring',
  review: 'Review',
}

/** @deprecated */
export function isSetupComplete(s: CreateLeagueV2State): boolean {
  return Boolean(getEffectiveLeagueType(s) && s.sport && s.teamCount > 0 && s.draftType)
}

/** @deprecated */
export function isIdentityComplete(s: CreateLeagueV2State): boolean {
  return s.name.trim().length >= 3 && s.name.trim().length <= 100
}

/** @deprecated */
export function isScoringComplete(_s: CreateLeagueV2State): boolean {
  return true
}

/** @deprecated */
export function canAdvance(page: V2PageId, state: CreateLeagueV2State): boolean {
  switch (page) {
    case 'setup':
      return isSetupComplete(state)
    case 'identity':
      return isIdentityComplete(state)
    case 'scoring':
      return isScoringComplete(state)
    case 'review':
      return analyzeCreateLeagueCompletion(state).length === 0
  }
}

/** Football-like sports where the Scoring page detail panel applies. */
export function isFootballLike(sport: SupportedSport): boolean {
  return sport === 'NFL' || sport === 'NCAAF'
}
