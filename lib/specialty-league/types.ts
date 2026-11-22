/**
 * Specialty League Factory — types and extension points.
 * Use these interfaces to add new league types (Survivor, Big Brother, Salary Cap, Devy, etc.)
 * without duplicating architecture. Guillotine is the reference implementation.
 *
 * PROMPT 336 — AllFantasy Specialty League Factory Template.
 */

import type { LeagueSport } from '@prisma/client'

/** League type IDs that have a dedicated specialty implementation (wizard + backend + UI). */
export type SpecialtyLeagueId =
  | 'guillotine'
  | 'survivor'
  | 'big_brother'
  | 'salary_cap'
  | 'devy'
  | 'merged_devy'
  | 'merged_devy_c2c'
  | 'tournament'
  | 'best_ball'
  | 'idp'
  | 'zombie'
  | 'keeper'

/** Canonical variant string stored in League.leagueVariant (lowercase). */
type LeagueVariant = string

// --- Config ---

/** Sport-aware default values (e.g. elimination end week by sport). */
type SportAwareDefaults<TSettings = Record<string, unknown>> = Partial<
  Record<LeagueSport, Partial<TSettings>>
>

/** Loader: (leagueId) => config or null. Config shape is league-specific. */
type SpecialtyConfigLoader<TConfig = unknown> = (
  leagueId: string
) => Promise<TConfig | null>

/** Upsert config after league create. Input is partial; defaults from sport/registry. */
type SpecialtyConfigUpsert<TInput = Record<string, unknown>> = (
  leagueId: string,
  input: Partial<TInput>
) => Promise<unknown | null>

// --- Detection ---

/** (leagueId) => is this league of this specialty type? */
type SpecialtyLeagueDetector = (leagueId: string) => Promise<boolean>

// --- Assets & theming ---

interface SpecialtyLeagueAssets {
  /** League avatar / branding image URL (e.g. /guillotine/Guillotine.png). */
  leagueImage: string
  /** First league-entry splash video URL (optional). */
  firstEntryVideo?: string
  /** Post-draft intro video URL (optional). */
  introVideo?: string
}

/** Resolver: (env/overrides) => assets. Allows env-based overrides. */
type SpecialtyAssetsResolver = () => SpecialtyLeagueAssets

// --- UI extension points ---

/** Component path (e.g. @/components/guillotine/GuillotineFirstEntryModal) or lazy import. */
type FirstEntryModalComponent = string | (() => Promise<{ default: unknown }>)

/** Component path for specialty league home (Overview replacement). */
type SpecialtyHomeComponent = string | (() => Promise<{ default: unknown }>)

/** Optional: custom standings tab component path. */
type StandingsVariantComponent = string | null

// --- API routes ---

/** API path for summary (e.g. /api/leagues/[leagueId]/guillotine/summary). Used for 404 guard and docs. */
type SummaryRoutePath = string

/** API path for AI (e.g. /api/leagues/[leagueId]/guillotine/ai). */
type AIRoutePath = string | null

// --- Automation engine ---

/** Run weekly (or period) evaluation (e.g. elimination, danger, roster release). Signature is league-specific. */
type SpecialtyAutomationRunner = (args: {
  leagueId: string
  weekOrPeriod: number
  sport: LeagueSport
}) => Promise<{ ok: boolean; error?: string }>

/** Optional: event log append. Event types are league-specific. */
type SpecialtyEventLogAppend = (
  leagueId: string,
  eventType: string,
  metadata?: Record<string, unknown>
) => Promise<void>

// --- Guards ---

/** Guard: can this roster perform lineup/waiver/trade? (e.g. chopped rosters cannot). */
type SpecialtyRosterGuard = (
  leagueId: string,
  rosterId: string
) => Promise<boolean>

/** Optional: list of roster IDs that are "out" (chopped, eliminated, etc.) for bulk checks. */
type SpecialtyGetExcludedRosterIds = (leagueId: string) => Promise<string[]>

// --- AI extension point ---

interface SpecialtyAIExtension {
  /** Entitlement feature id for gating (e.g. guillotine_ai). */
  entitlementFeatureId: string
  /** Build deterministic context for prompts (no LLM here). */
  buildContext: (args: {
    leagueId: string
    weekOrPeriod: number
    type: string
    userRosterId?: string
  }) => Promise<unknown | null>
  /** Build { system, user } prompt from context and type. */
  buildPrompt: (context: unknown, type: string) => { system: string; user: string }
  /** Call LLM and return explanation/strategy (league-specific result shape). */
  generate: (context: unknown, type: string) => Promise<{ explanation: string; [k: string]: unknown }>
}

// --- Commissioner controls ---

/** Commissioner-only actions (e.g. override chop, manual eliminate). Keys are action ids. */
type SpecialtyCommissionerActions = Record<
  string,
  (args: { leagueId: string; payload?: unknown }) => Promise<{ ok: boolean; error?: string }>
>

// --- Reusable capability flags (PROMPT 350) ---

/** Optional: which reusable modules this specialty implements. Used for docs and QA harness. */
interface SpecialtyLeagueCapabilities {
  tribeOrchestration?: boolean
  hiddenPowerSystem?: boolean
  privateVoting?: boolean
  eliminationPipeline?: boolean
  sidecarLeague?: boolean
  tokenizedReturn?: boolean
  miniGameRegistry?: boolean
  mergeJuryPhases?: boolean
  officialCommandParsing?: boolean
  aiHostHooks?: boolean
  /** Status transformation (e.g. Survivor/Zombie/Whisperer, infection, revive). */
  statusTransformation?: boolean
  /** Resource inventory ledger (serum, weapons, ambush — balance + audit). */
  resourceInventoryLedger?: boolean
  /** One-to-many universe (universe → levels → leagues). */
  oneToManyUniverse?: boolean
  /** Cross-league standings aggregation. */
  crossLeagueStandings?: boolean
  /** Promotion/relegation engine. */
  promotionRelegationEngine?: boolean
  /** Weekly board generation (risk list, movement watch). */
  weeklyBoardGeneration?: boolean
  /** Anti-collusion flag registry. */
  antiCollusionFlagRegistry?: boolean
  /** Anti-neglect / replacement workflows. */
  antiNeglectReplacementWorkflow?: boolean
  /** AI recap hooks (league + optional scope). */
  aiRecapHooks?: boolean
}

// --- QA harness ---

/** QA harness: run standard checks for a specialty league (creation, config, guards, automation, AI). */
type SpecialtyQAHarness = (args: {
  leagueId: string
  specId: SpecialtyLeagueId
  options?: { week?: number; skipAutomation?: boolean }
}) => Promise<{
  passed: string[]
  failed: { check: string; reason: string }[]
  skipped: string[]
}>

// --- Full spec (per league type) ---

export interface SpecialtyLeagueSpec<
  TConfig = unknown,
  TConfigInput = Record<string, unknown>,
> {
  id: SpecialtyLeagueId
  /** Stored in League.leagueVariant (lowercase). */
  leagueVariant: LeagueVariant
  /** Display label (e.g. "Guillotine"). */
  label: string
  /** Wizard LeagueTypeId that maps to this specialty (for create flow). */
  wizardLeagueTypeId: string

  /** Sport-aware default settings (e.g. end week by sport). */
  sportAwareDefaults?: SportAwareDefaults<TConfigInput>

  /** Is this league of this type? (DB or leagueVariant). */
  detect: SpecialtyLeagueDetector
  /** Load full config for engine/UI. */
  getConfig: SpecialtyConfigLoader<TConfig>
  /** Upsert config (e.g. on league create). */
  upsertConfig?: SpecialtyConfigUpsert<TConfigInput>

  /** Asset URLs (league image, first-entry video, intro video). */
  assets: SpecialtyLeagueAssets | SpecialtyAssetsResolver

  /** First-entry modal: component path or lazy. */
  firstEntryModal?: FirstEntryModalComponent
  /** Specialty home (Overview tab replacement): component path or lazy. */
  homeComponent: SpecialtyHomeComponent
  /** Custom standings component path if any. */
  standingsComponent?: StandingsVariantComponent

  /** Summary API route path (for docs and 404 handling). */
  summaryRoutePath: SummaryRoutePath
  /** AI route path if this type has dedicated AI. */
  aiRoutePath?: AIRoutePath

  /** Run weekly/period automation (evaluation, elimination, release). */
  runAutomation?: SpecialtyAutomationRunner
  /** Append event to league event log. */
  appendEvent?: SpecialtyEventLogAppend

  /** Guard: can roster perform actions? */
  rosterGuard?: SpecialtyRosterGuard
  /** Get roster IDs excluded from actions (e.g. chopped). */
  getExcludedRosterIds?: SpecialtyGetExcludedRosterIds

  /** AI extension (context, prompts, generate). Null if no dedicated AI. */
  ai?: SpecialtyAIExtension | null

  /** Commissioner-only actions. */
  commissionerActions?: SpecialtyCommissionerActions

  /** Optional: reusable capability flags (tribe, voting, sidecar, etc.). */
  capabilities?: SpecialtyLeagueCapabilities

  /** Optional: QA harness for this specialty. */
  qaHarness?: SpecialtyQAHarness
}
