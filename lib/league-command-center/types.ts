/**
 * League Command Center — canonical view-model contracts.
 *
 * This module is data-only (no React) so it can be imported by server loaders,
 * API routes, and tests without pulling in the component tree.
 *
 * Two rules are encoded here rather than left to convention, because both are
 * easy to violate silently:
 *
 *  1. **Role and entitlement are separate axes.** `CommandCenterRole`
 *     (manager / co-commissioner / commissioner) never implies paid access, and
 *     `CanAccessResult` never implies league authority. Resolve them
 *     independently and check them independently.
 *
 *  2. **Action capability is derived, never asserted.** `ActionCapability` is a
 *     presentation projection of the existing
 *     `RecommendationExecutionCapability` contract
 *     (`lib/shared-services/league-hub/types.ts`) — it does not introduce a
 *     second, competing taxonomy. A write button only appears when AllFantasy
 *     can genuinely perform the write (`canExecute`), and an external link only
 *     appears when a real URL could actually be constructed.
 */
import type {
  LeagueHubProvider,
  LeagueImportType,
  ProviderCapabilityBadge,
  RecommendationExecutionCapability,
  SyncFreshness,
} from '@/lib/shared-services/league-hub/types'
import type { CanAccessResult } from '@/lib/access/canAccess'

// ── Role axis ─────────────────────────────────────────────────────────────────

/**
 * League authority. Deliberately narrower than `LeagueRole` from
 * `lib/league/permissions.ts`: the Command Center is a member-only surface, so
 * `null` (non-member) never reaches a view model — the route returns an access
 * state instead. `viewer` collapses to `manager` for rendering purposes.
 */
export type CommandCenterRole = 'manager' | 'co_commissioner' | 'commissioner'

/** True for commissioner and co-commissioner — the two roles that see the ops layer. */
export function hasCommissionerAuthority(role: CommandCenterRole): boolean {
  return role === 'commissioner' || role === 'co_commissioner'
}

/**
 * The three additive layers every section renders, in this order.
 *
 * `commissioner` is strictly ADDITIVE — it is never a replacement for
 * `personal`. A commissioner is still an active fantasy manager and must keep
 * the full personal experience. See `LayerSection` for the enforced contract.
 */
export type CommandCenterLayer = 'personal' | 'shared' | 'commissioner'

// ── Action capability ─────────────────────────────────────────────────────────

/**
 * How an action can actually be completed, from the user's point of view.
 *
 * Projection of `RecommendationExecutionCapability`:
 *   native_execute      → native_write
 *   copy_action         → copyable_message
 *   open_provider       → external_deep_link (real URL available)
 *                       → read_only_guidance (no URL could be built)
 *   recommendation_only → informational
 */
export type ActionCapabilityKind =
  /** AllFantasy performs the write itself. Native leagues only. */
  | 'native_write'
  /** Reviewed in AllFantasy, completed by the user on the source platform. No deep link exists. */
  | 'read_only_guidance'
  /** Opens the source platform at a real, constructible URL to finish the action. */
  | 'external_deep_link'
  /** AllFantasy prepares text for the user to paste elsewhere. */
  | 'copyable_message'
  /** No action path — informational only. */
  | 'informational'

export interface ActionCapability {
  kind: ActionCapabilityKind
  /** User-facing explanation of what will happen, e.g. "Opens Sleeper to finish". */
  label: string
  /** Phosphor icon name, e.g. `ph-arrow-square-out`. */
  icon: string
  /**
   * Real external URL. Non-null **only** for `external_deep_link`. Never a
   * guess — when a provider URL cannot be constructed from stored data the
   * capability degrades to `read_only_guidance` instead.
   */
  href: string | null
  /** Text to copy. Non-null **only** for `copyable_message`. */
  copyText: string | null
  /**
   * True **only** when AllFantasy can genuinely perform the write. Drives
   * whether a real submit control renders. Never true for imported leagues.
   */
  canExecute: boolean
}

// ── League identity ───────────────────────────────────────────────────────────

export interface CommandCenterLeagueIdentity {
  leagueId: string
  name: string
  sport: string
  /**
   * Rendered season label. A **string**, deliberately: `League.season` is an
   * `Int` but `SleeperLeague.season` is a `String`, and number-only handling of
   * that column has silently nulled entire boards before. Formatting happens
   * once, at load, via `resolveSeasonLabel`.
   */
  seasonLabel: string
  logoUrl: string | null
  managerCount: number
  commissionerName: string | null
  /** Null when the current week genuinely cannot be resolved — never defaulted to 1. */
  currentWeek: number | null
  /** e.g. "Dynasty · Full PPR". Falls back to "Scoring unavailable" rather than inventing a format. */
  scoringFormatLabel: string
  rosterSize: number | null
  playoffFormatLabel: string | null
  tradeDeadlineLabel: string | null
}

// ── Source / trust ────────────────────────────────────────────────────────────

/**
 * Freshness projected for display. Distinct from `SyncFreshnessState`, which is
 * the storage-level fact; this is the user-facing severity.
 */
export type SourceTrustStatus = 'live' | 'current' | 'delayed' | 'stale' | 'unknown'

export interface CommandCenterSource {
  provider: LeagueHubProvider
  /** Display name, e.g. "Sleeper", "AllFantasy". */
  label: string
  isNative: boolean
  kindLabel: 'Native' | 'Imported'
  importType: LeagueImportType
  /** Straight from `deriveProviderCapabilities` — not re-derived here. */
  capabilities: ProviderCapabilityBadge[]
  freshness: SyncFreshness
  trustStatus: SourceTrustStatus
  /** e.g. "Updated 4 minutes ago", "Last synced 18 hours ago — showing last confirmed data". */
  trustDetail: string
  /** One line on what the user can and cannot do here, e.g. "Read-only import — reviewed here, completed on Sleeper." */
  capabilityNote: string
}

// ── Viewer ────────────────────────────────────────────────────────────────────

export interface CommandCenterTeamRecord {
  wins: number
  losses: number
  ties: number
}

export interface CommandCenterAdminPreview {
  /** Server-verified site admin. The preview control renders only when true. */
  isAdmin: boolean
  /** The viewer's genuine league role, before any preview. */
  realRole: CommandCenterRole
  previewActive: boolean
  /** Roles this admin may preview — never above their real role. */
  availableRoles: CommandCenterRole[]
  /** Set when an elevation was requested and refused, so the UI can explain it. */
  deniedElevation: CommandCenterRole | null
}

export interface CommandCenterViewer {
  userId: string
  /**
   * The role the page renders as. Equals the real league role unless a
   * server-verified admin is running a downgrade-only preview — see
   * `lib/league-command-center/adminPreview.ts`. Never above the real role.
   */
  role: CommandCenterRole
  /** Convenience for `hasCommissionerAuthority(role)`. */
  isCommissioner: boolean
  /** `LeagueTeam.id`, or null when the viewer owns the league but has not claimed a team. */
  teamId: string | null
  teamName: string | null
  record: CommandCenterTeamRecord | null
  /** `LeagueTeam.currentRank`. Null when standings are unavailable. */
  standingsPosition: number | null
}

// ── Season phase ──────────────────────────────────────────────────────────────

/**
 * Derived from real league state, never a UI toggle. The prototype exposes this
 * as a designer switch; in production it is a fact.
 */
export type SeasonPhase = 'preseason' | 'in_season' | 'playoffs' | 'offseason'

// ── Entitlement ───────────────────────────────────────────────────────────────

export interface CommandCenterEntitlement {
  /** Resolved server-side via `canAccessForUser`. Client code must not re-derive access. */
  intelligence: CanAccessResult
  /** Premium Command Center tab. Free tier sees a teaser only. */
  commandCenterTab: CanAccessResult
}

// ── Root view model ───────────────────────────────────────────────────────────

export interface CommandCenterViewModel {
  league: CommandCenterLeagueIdentity
  source: CommandCenterSource
  viewer: CommandCenterViewer
  adminPreview: CommandCenterAdminPreview
  seasonPhase: SeasonPhase
  entitlement: CommandCenterEntitlement
  /**
   * Honest degradation surface. Populated from Canonical World
   * `completeness.warnings` / `unsupported` plus loader-level failures, and
   * rendered rather than hidden.
   */
  warnings: string[]
  generatedAt: string
}

// ── Section identity ──────────────────────────────────────────────────────────

export const COMMAND_CENTER_SECTIONS = [
  'overview',
  // Commissioner HQ layer — additive league-ops surfaces, gated by
  // `requiresCommissioner`. They never replace the personal manager
  // experience: `overview` (and roster/matchups/standings) remain the full
  // manager surface, one click away via the hero's dual-role switcher.
  'attention',
  'health',
  'matchups',
  'standings',
  'teams',
  'roster',
  'players',
  'trades',
  'draft',
  'history',
  'legacy',
  'commandcenter',
  'settings',
] as const

export type CommandCenterSectionId = (typeof COMMAND_CENTER_SECTIONS)[number]

export interface CommandCenterNavItem {
  id: CommandCenterSectionId
  label: string
  /** Phosphor icon name. */
  icon: string
  /** True when the section is built and wired. Unbuilt sections render an honest placeholder. */
  implemented: boolean
  /** True when the section requires commissioner authority to appear at all. */
  requiresCommissioner: boolean
}

/**
 * Nav registry. `implemented` is deliberately explicit rather than inferred —
 * an unbuilt tab must say so instead of rendering an empty shell that reads as
 * "there is no data".
 */
export const COMMAND_CENTER_NAV: readonly CommandCenterNavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'ph-squares-four', implemented: true, requiresCommissioner: false },
  // Commissioner HQ — additive ops layer, only rendered for commissioners.
  { id: 'attention', label: 'Attention Queue', icon: 'ph-warning-octagon', implemented: true, requiresCommissioner: true },
  { id: 'health', label: 'League Health', icon: 'ph-heartbeat', implemented: true, requiresCommissioner: true },
  { id: 'matchups', label: 'Matchups', icon: 'ph-flag-checkered', implemented: true, requiresCommissioner: false },
  { id: 'standings', label: 'Standings', icon: 'ph-list-numbers', implemented: true, requiresCommissioner: false },
  { id: 'teams', label: 'Teams', icon: 'ph-users-three', implemented: false, requiresCommissioner: false },
  { id: 'roster', label: 'Roster', icon: 'ph-identification-card', implemented: true, requiresCommissioner: false },
  { id: 'players', label: 'Players & Waivers', icon: 'ph-baseball-cap', implemented: false, requiresCommissioner: false },
  { id: 'trades', label: 'Trades', icon: 'ph-arrows-left-right', implemented: false, requiresCommissioner: false },
  { id: 'draft', label: 'Draft', icon: 'ph-cards', implemented: false, requiresCommissioner: false },
  { id: 'history', label: 'History', icon: 'ph-clock-counter-clockwise', implemented: false, requiresCommissioner: false },
  { id: 'legacy', label: 'Legacy', icon: 'ph-trophy', implemented: false, requiresCommissioner: false },
  { id: 'commandcenter', label: 'Command Center', icon: 'ph-bell-ringing', implemented: false, requiresCommissioner: false },
  { id: 'settings', label: 'Settings', icon: 'ph-gear-six', implemented: false, requiresCommissioner: true },
] as const

export function isCommandCenterSectionId(value: string): value is CommandCenterSectionId {
  return (COMMAND_CENTER_SECTIONS as readonly string[]).includes(value)
}

// Re-exported so section modules import one place rather than reaching across layers.
export type { RecommendationExecutionCapability, SyncFreshness, LeagueHubProvider }
