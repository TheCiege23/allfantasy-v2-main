/**
 * Decision OS - the league-wide Manager DNA directory.
 *
 * `resolveManagerIntelligencePayload` computes DNA for EVERY manager in a league and then returns
 * exactly one profile: the caller's own. That narrowing is a deliberate privacy property of the
 * per-manager route, not an accident, and it is why the Commissioner OS `managers` namespace has
 * been returning an honest "backend does not expose this" error rather than a directory.
 *
 * This module is the directory that narrowing withholds. It runs the SAME pipeline via
 * `computeLeagueDna` - never a second copy of the classification rules - and returns every
 * manager's profile. Its callers are responsible for authorization; see the route for the gate.
 *
 * TWO THINGS ARE DELIBERATELY WITHHELD even from an authorized commissioner:
 *
 * - `derivation` - the step-by-step classifier trace (scores, threshold comparisons). It exists to
 *   explain a classification to the person it describes. Shipping another manager's internal
 *   reasoning trace into a directory listing is more exposure than a directory needs, and nothing
 *   in the UI asks for it.
 * - Any collapsed "manager score". `ManagerIntelligenceView`'s own contract is explicit that no
 *   single overall score is ever shown. This module carries the categorical classifications and
 *   their quality signals (`confidence`, `completeness`) and computes no composite.
 *
 * `warnings` IS carried: conflicting signals, missing data and proxy detections are honest caveats
 * about how much to trust a row, and a directory that hides them shows every profile as equally
 * solid when it is not.
 */
import { computeLeagueDna } from './dashboard-intelligence'
import { defaultListManagerBehavioralTrends } from './snapshot/prismaBehavioralSnapshotStore'
import { deriveBehavioralTrend, deriveEventCountDelta } from './snapshot/behavioralTrend'
import type {
  DecisionStyle,
  EngagementReliability,
  ManagerIdentityLabel,
  ManagerTrait,
  RiskTendency,
  TransactionStyle,
} from './phase6/dna/types'

/** Direction of a manager's own engagement over time. */
export type ManagerEngagementDirection = 'rising' | 'steady' | 'declining'

/**
 * A per-manager engagement trend, or an honest reason there isn't one.
 *
 * A discriminated union rather than a bare direction on purpose: `engagementReliability` is a LEVEL
 * (reliable / inconsistent / unreliable) and a trend is a DIRECTION. They are orthogonal - a
 * manager can be reliably absent - so one can never be derived from the other, and a manager with
 * too few snapshots has no trend at all. Defaulting that case to 'steady' would be indistinguishable
 * from a real measurement, which is the precise misrepresentation the `managers` namespace has been
 * refusing to make.
 */
export type ManagerEngagementTrend =
  | { available: false; reason: 'no_snapshots' | 'insufficient_history' }
  | {
      available: true
      direction: ManagerEngagementDirection
      periodsTracked: number
      eventCountDelta: number
    }

export interface ManagerDnaDirectoryRow {
  managerId: string
  primaryIdentity: ManagerIdentityLabel
  /** Classification confidence 0-1. Always 0 for 'unknown'. */
  confidence: number
  decisionStyle: DecisionStyle
  transactionStyle: TransactionStyle
  riskTendency: RiskTendency
  engagementReliability: EngagementReliability
  traits: ManagerTrait[]
  /** Input data quality 0-100 for this profile. */
  completeness: number
  /** Honest caveats about this row (conflicting signals, missing data, proxy detections). */
  warnings: string[]
  engagementTrend: ManagerEngagementTrend
}

export type ManagerDnaDirectory =
  | { available: false; leagueId: string; reason: 'pipeline_failed' }
  | {
      available: true
      leagueId: string
      rows: ManagerDnaDirectoryRow[]
      totalManagersAnalyzed: number
      profiledManagers: number
      insufficientDataManagers: number
      /** League-level assembly warnings, distinct from a row's own. */
      warnings: string[]
      /** Manager DNA assembly version, so a consumer can tell which ruleset produced a row. */
      version: string
    }

/**
 * Derive one manager's engagement direction from their behavioral snapshots.
 *
 * Reuses `deriveBehavioralTrend` + `deriveEventCountDelta` - the SAME two functions
 * `resolveLeagueActivityTrend` uses - so a manager's direction and their league's direction can
 * never be computed by two different rules. Only the vocabulary differs: a league's activity is
 * increasing/decreasing/flat, a person's engagement is rising/steady/declining.
 */
export function deriveManagerEngagementTrend(
  records: Parameters<typeof deriveBehavioralTrend>[0],
): ManagerEngagementTrend {
  const trend = deriveBehavioralTrend(records)
  if (trend.length === 0) return { available: false, reason: 'no_snapshots' }
  if (trend.length < 2) return { available: false, reason: 'insufficient_history' }

  const delta = deriveEventCountDelta(trend)
  if (delta === null) return { available: false, reason: 'insufficient_history' }

  return {
    available: true,
    direction: delta > 0 ? 'rising' : delta < 0 ? 'declining' : 'steady',
    periodsTracked: trend.length,
    eventCountDelta: delta,
  }
}

/**
 * Resolve every manager's DNA profile for one league.
 *
 * Degraded-safe, matching every sibling Decision OS resolver: never throws. A pipeline failure
 * returns `available: false`, which a caller must render as "we could not compute this" - never as
 * an empty league.
 *
 * The trend read is deliberately independent of the DNA computation: a snapshot-table hiccup
 * degrades every row's `engagementTrend` to an honest `no_snapshots` and leaves the classifications
 * fully intact, rather than failing the whole directory over a secondary field.
 */
export async function resolveManagerDnaDirectory({
  leagueId,
  now = new Date(),
}: {
  leagueId: string
  now?: Date
}): Promise<ManagerDnaDirectory> {
  let computation
  try {
    computation = await computeLeagueDna({ leagueId, now })
  } catch {
    return { available: false, leagueId, reason: 'pipeline_failed' }
  }

  // Already degrades to an empty Map on its own; the catch is belt-and-braces so a trend failure
  // can never take the classifications down with it.
  let trendsByManager: Map<string, Parameters<typeof deriveBehavioralTrend>[0]>
  try {
    trendsByManager = await defaultListManagerBehavioralTrends(leagueId)
  } catch {
    trendsByManager = new Map()
  }

  const { dnaResult } = computation
  const rows: ManagerDnaDirectoryRow[] = dnaResult.profiles.map((profile) => ({
    managerId: profile.managerId,
    primaryIdentity: profile.primaryIdentity,
    confidence: profile.confidence,
    decisionStyle: profile.decisionStyle,
    transactionStyle: profile.transactionStyle,
    riskTendency: profile.riskTendency,
    engagementReliability: profile.engagementReliability,
    traits: profile.traits,
    completeness: profile.completeness,
    warnings: profile.warnings,
    // `derivation` is deliberately not carried - see the module header.
    engagementTrend: deriveManagerEngagementTrend(trendsByManager.get(profile.managerId) ?? []),
  }))

  return {
    available: true,
    leagueId,
    rows,
    totalManagersAnalyzed: dnaResult.totalManagersAnalyzed,
    profiledManagers: dnaResult.profiledManagers,
    insufficientDataManagers: dnaResult.insufficientDataManagers,
    warnings: dnaResult.warnings,
    version: dnaResult.version,
  }
}
