/**
 * My Team / Manager Command Center — contract for the `/my-team` surface.
 *
 * Design rule that governs this whole file: **every section carries its own
 * availability verdict.** The page never renders a number it cannot source, so
 * a section is either `ok` (with attribution) or it states why it is not. That
 * is enforced structurally by `SectionState<T>` rather than by convention — a
 * caller cannot read `.data` without first narrowing on `status`.
 *
 * Nothing here recomputes scoring, projections, matchup pairing, or standings.
 * The aggregator reuses the already-live canonical engines:
 *   - `server/services/matchupCenterService.ts` → matchup, starters, win prob
 *   - `lib/lineup-actions/computeLineupActionsForUser.ts` → lineup issues
 *   - `lib/shared-services/game-day/GameDayContextAssembler.ts` → both, wrapped
 *     with week resolution + a provider-neutral matchup state
 * See `lib/shared-services/game-day/README.md` for that audit.
 */

import type { SourceAttribution } from '@/lib/shared-services/game-day/types'
import type { LineupActionItem, MatchupCenterPayload } from '@/lib/shared-services/game-day/types'
import type { UserLeague } from '@/app/dashboard/types'

export type { SourceAttribution, LineupActionItem, MatchupCenterPayload }

/**
 * Why a section has no data. These map 1:1 onto the honest states the surface is
 * allowed to display — there is deliberately no generic "error" bucket, because
 * "something went wrong" is not an answer a manager can act on.
 */
export type UnavailableKind =
  /** Provider/native fetch failed or returned nothing this cycle. */
  | 'provider_unavailable'
  /** Data exists but is past its freshness window — shown with the stale timestamp. */
  | 'stale'
  /** Real rows exist but too few to say anything defensible. */
  | 'insufficient_data'
  /** The source platform genuinely does not expose this field (e.g. Sleeper FAAB on a non-FAAB league). */
  | 'not_exposed_by_platform'
  /** The league's format/sport has no equivalent concept (e.g. bye weeks in a daily sport). */
  | 'unsupported_for_format'
  /** A real engine exists but is not enabled for live surfaces — never silently faked. */
  | 'engine_not_enabled'
  /** The user's connection to the provider needs re-auth or a fresh import. */
  | 'resync_required'
  /** Gated behind a plan the viewer does not hold. */
  | 'requires_upgrade'

export type SectionUnavailable = {
  status: 'unavailable'
  kind: UnavailableKind
  /** One sentence, written for a manager, not a developer. Rendered verbatim. */
  reason: string
  /** Optional operator-facing detail (error text, missing table). Never rendered as the primary message. */
  detail?: string
  /** Deep link that would actually resolve this, when one exists (resync, upgrade, open platform). */
  resolveHref?: string
  resolveLabel?: string
}

export type SectionOk<T> = {
  status: 'ok'
  data: T
  attribution: SourceAttribution
}

/**
 * A section is readable only after narrowing. `SectionOk` carries attribution so
 * every rendered figure can show where it came from and how fresh it is.
 */
export type SectionState<T> = SectionOk<T> | SectionUnavailable

export function sectionOk<T>(data: T, attribution: SourceAttribution): SectionOk<T> {
  return { status: 'ok', data, attribution }
}

export function sectionUnavailable(
  kind: UnavailableKind,
  reason: string,
  extra?: Omit<SectionUnavailable, 'status' | 'kind' | 'reason'>,
): SectionUnavailable {
  return { status: 'unavailable', kind, reason, ...extra }
}

// ── Write capability ─────────────────────────────────────────────────────────

/**
 * What this surface may actually DO for this league, as opposed to what it can
 * show. Imported leagues are analysis-only; every mutating affordance must route
 * back to the source platform. Keeping this as data (rather than
 * `platform === 'sleeper'` checks scattered through the UI) is what stops the
 * page from ever implying an action happened inside AllFantasy when it did not.
 */
export type WriteCapability = {
  /** True only for AllFantasy-native leagues the viewer owns a team in. */
  canEditLineup: boolean
  canSubmitWaiverClaim: boolean
  canProposeTrade: boolean
  canMoveToIr: boolean
  /** Deep link to the source platform for this league, when one is derivable. */
  platformHref: string | null
  /** e.g. "Sleeper" — used in button copy: "Open in Sleeper". */
  platformLabel: string | null
  /** Why writes are blocked, shown once near the header rather than on every button. */
  readOnlyReason: string | null
}

// ── Header / identity ────────────────────────────────────────────────────────

export type TeamIdentity = {
  teamName: string
  managerName: string | null
  avatarUrl: string | null
  record: { wins: number; losses: number; ties: number } | null
  /** Standings rank, 1-based. Null when standings are not resolvable. */
  rank: number | null
  teamCount: number | null
  /** Power rank is a separate engine from standings rank — null unless genuinely computed. */
  powerRank: number | null
}

// ── Mission control ──────────────────────────────────────────────────────────

export type MissionIndicatorTone = 'critical' | 'warning' | 'positive' | 'neutral' | 'unknown'

export type MissionIndicator = {
  id: string
  label: string
  /** Primary display value, pre-formatted. `null` renders as an em dash, never as 0. */
  value: string | null
  sublabel: string | null
  tone: MissionIndicatorTone
  /** Anchor id on the page this indicator scrolls to. */
  targetId: string
  /** Set when the underlying section is unavailable — the tile shows this instead of a fake value. */
  unavailableReason: string | null
}

// ── Game plan ────────────────────────────────────────────────────────────────

export type GamePlanPriority = 'critical' | 'high' | 'medium' | 'low'

/**
 * One row of the prioritized action queue. Derived from real `LineupActionItem`s
 * plus deadline-driven items; never invented to fill the list. When the queue is
 * empty because a scan failed (rather than because the team is in good shape),
 * the section reports unavailable instead of an encouraging zero-state.
 */
export type GamePlanItem = {
  id: string
  priority: GamePlanPriority
  /** Imperative headline: "Fill your empty FLEX slot". */
  title: string
  /** Why this matters, in one sentence. */
  reason: string
  playerName: string | null
  slotLabel: string | null
  /** ISO instant. Only set when a real lock/deadline timestamp exists. */
  deadlineIso: string | null
  /** 0..1. Null when the source engine did not produce a confidence. */
  confidence: number | null
  /** Projected point delta from taking the action, when the engine computed one. */
  expectedGain: number | null
  /** Which engine produced this, surfaced in the UI for traceability. */
  sourceModule: string
  /** The action the user should take. Wording adapts to `WriteCapability`. */
  actionLabel: string | null
  actionHref: string | null
  /** True when the action can only be completed on the source platform. */
  externalOnly: boolean
}

// ── Lineup ───────────────────────────────────────────────────────────────────

export type LineupSlotStatus =
  | 'ok'
  | 'empty'
  | 'locked'
  | 'injured'
  | 'questionable'
  | 'out'
  | 'bye'
  | 'illegal'
  | 'unknown'

export type LineupPlayer = {
  playerId: string
  name: string
  position: string
  team: string | null
  opponent: string | null
  headshotUrl: string | null
  /** Live/actual points. Null before the game starts — distinct from 0.0 scored. */
  currentPoints: number | null
  projectedPoints: number | null
  injuryStatus: string | null
  newsBlurb: string | null
  weatherSummary: string | null
  gameLabel: string
  gameStatus: 'upcoming' | 'live' | 'final' | 'unknown'
  aiInsight: string | null
}

export type LineupSlot = {
  slotId: string
  slotLabel: string
  player: LineupPlayer | null
  status: LineupSlotStatus
  /** Non-null only when a real lock instant is known. */
  lockTimeIso: string | null
}

export type LineupView = {
  starters: LineupSlot[]
  /** Bench/IR/taxi are only populated for sources that expose them. */
  bench: LineupPlayer[]
  reserve: LineupPlayer[]
  /** Sum of starter projections. Null when any starter projection is missing. */
  projectedTotal: number | null
  currentTotal: number | null
  /** True when the roster came back but some slots could not be resolved. */
  partial: boolean
}

// ── Matchup ──────────────────────────────────────────────────────────────────

export type MatchupView = {
  payload: MatchupCenterPayload
  /** Which side of `payload` is the viewer. The service does not guarantee left. */
  viewerSide: 'left' | 'right'
  /**
   * Win probability as a percentage for the VIEWER, or null.
   *
   * Honesty note: `matchupCenterService` derives this from a simple projected-points
   * ratio — it is NOT the Gaussian `lib/matchup-prediction-engine`. The UI labels it
   * as a projection ratio for exactly this reason. Do not relabel it as a simulation.
   */
  viewerWinProbabilityPct: number | null
  winProbabilityMethod: 'projected_points_ratio'
  state: string
}

// ── Roster strength ──────────────────────────────────────────────────────────

export type PositionStrength = {
  position: string
  /** Aggregate projected points from rostered players at this position. */
  value: number
  /** Rank within league, 1-based. Null unless every rival roster was resolvable. */
  leagueRank: number | null
  starterCount: number
  depthCount: number
}

export type RosterStrengthView = {
  positions: PositionStrength[]
  /**
   * Overall letter grade. Only produced when every starting position resolved —
   * a grade computed over partial data would be the most misleading number on
   * the page, so it is withheld rather than approximated.
   */
  overallGrade: string | null
  gradeBasis: string
}

export type RosterNeed = {
  position: string
  severity: 'critical' | 'high' | 'medium'
  summary: string
  evidence: string[]
}

// ── Assembled context ────────────────────────────────────────────────────────

export type MyTeamContext = {
  league: UserLeague
  leagueId: string
  season: number
  week: number
  weekResolutionSource: string
  isPlayoffWeek: boolean
  sport: string
  platform: string
  identity: TeamIdentity
  write: WriteCapability
  viewerIsCommissioner: boolean

  lineup: SectionState<LineupView>
  gamePlan: SectionState<GamePlanItem[]>
  matchup: SectionState<MatchupView>
  rosterStrength: SectionState<RosterStrengthView>
  rosterNeeds: SectionState<RosterNeed[]>
  playoffOutlook: SectionState<never>
  waivers: SectionState<never>
  trades: SectionState<never>

  missionControl: MissionIndicator[]

  /** When the underlying engines last produced data. Drives the freshness badge. */
  generatedAtIso: string
  /** True when any section is unavailable — header shows a single honest summary. */
  degraded: boolean
}
