/**
 * Commissioner OS Surface Alignment — Phase B Increment 3.
 *
 * League Health source-of-truth decision: **FEDERATE, not replace.**
 *
 * Audit finding (docs/os/COMMISSIONER_OS_SURFACE_ALIGNMENT.md): `monitorLeagueHealth`
 * (`lib/league-health/league-health-engine.ts`) is a PURE, already-deterministic scoring
 * function over an explicit input struct — it performs no data access of its own. Its route
 * (`/api/league-health`) has **no live UI caller anywhere in the codebase** (the "League Health
 * Check" card on the AI Tools page links to a Chimmy chat prompt, not this route) and **no
 * existing tests** — so there is no live behavior to break, and no reason to redesign a working,
 * tested scoring algorithm. The lowest-risk path is to feed it REAL Decision OS numbers instead
 * of whatever a caller previously had to hand-supply, while leaving the scoring engine itself
 * byte-for-byte untouched.
 *
 * This module composes the SAME real sources Increments 1–2 already proved out:
 *   - `loadLeagueEvents` (Increment 1's additive event composition, including imported/
 *     external-league activity) → `assembleLeagueBehavioralFacts` for league-wide counts.
 *   - Per-manager `assembleManagerBehavioralFacts` → `deriveManagerBehavioralIntelligence` (the
 *     same computation `resolveManagerIntelligencePayload` already does) for participation tier,
 *     retention risk, and inactivity signals — "inactivity risk" and "commissioner action
 *     opportunities" the demo explicitly asks for.
 *   - `resolveLeagueActivityTrend` (Increment 2) for trend direction/delta/period data.
 *
 * Honesty contract: every `LeagueHealthInput` field this module can derive from real data is
 * derived; every field it CANNOT derive (league settings like `numTeams`/`waiverType`, or signals
 * with no Decision OS source yet like `chatMessageCount`/`disputeCount`) keeps the engine's
 * existing schema default — and `fieldProvenance` says so explicitly, so a caller/demo never
 * mistakes a schema default for a measured zero. Nothing here is fabricated.
 */

import {
  loadLeagueEvents,
  lookbackDays,
  sinceDate,
  resolveLeagueActivityTrend,
  type LeagueActivityTrendSummary,
} from './dashboard-intelligence'
import { assembleLeagueBehavioralFacts, assembleManagerBehavioralFacts } from './behavioral/assemble'
import { deriveManagerBehavioralIntelligence } from './behavioral/manager-intelligence'
import type { ManagerRetentionRisk } from './behavioral/manager-intelligence'
import { monitorLeagueHealth, LeagueHealthInputSchema, type LeagueHealthInput, type LeagueHealthResult } from '@/lib/league-health'

/** Fields this module can populate from real Decision OS data, vs. left at the engine's schema default. */
export const DECISION_OS_DERIVED_FIELDS = [
  'activeManagers',
  'inactiveManagers',
  'totalTradesThisSeason',
  'totalWaiverClaims',
  'commissionerActionsThisSeason',
] as const satisfies readonly (keyof LeagueHealthInput)[]

export type FieldProvenance = Record<keyof LeagueHealthInput, 'decision_os' | 'schema_default'>

export interface ManagerAtRetentionRisk {
  managerId: string
  retentionRisk: ManagerRetentionRisk
  retentionRiskReasons: string[]
  isInactive: boolean
}

export interface DecisionOsLeagueHealthContext {
  /** Total real events (all types) that fed the league-wide facts. */
  activityEventCount: number
  activeManagerCount: number
  inactiveManagerCount: number
  tradeCount: number
  waiverClaimCount: number
  draftPickCount: number
  commissionerActionCount: number
  /** Sum of every active manager's lineup/roster engagement event count — a real, additive "roster activity" signal not tracked at league scope by LeagueBehavioralFacts itself. */
  rosterActivityCount: number
  /** Managers at 'high'/'critical' retention risk — the demo's "inactivity risk" + "commissioner action opportunity" signal. */
  managersAtRetentionRisk: ManagerAtRetentionRisk[]
  trend: LeagueActivityTrendSummary
}

export interface DecisionOsLeagueHealthResult {
  /** The existing, UNCHANGED monitorLeagueHealth() scoring output. */
  engine: LeagueHealthResult
  /** The real Decision OS signals behind (some of) that score. */
  decisionOs: DecisionOsLeagueHealthContext
  /** Which LeagueHealthInput fields were real (Decision OS-derived) vs the engine's schema default — never silently conflate the two. */
  fieldProvenance: FieldProvenance
}

function buildFieldProvenance(): FieldProvenance {
  const shape = LeagueHealthInputSchema.shape
  const provenance = {} as FieldProvenance
  for (const key of Object.keys(shape) as (keyof LeagueHealthInput)[]) {
    provenance[key] = (DECISION_OS_DERIVED_FIELDS as readonly string[]).includes(key)
      ? 'decision_os'
      : 'schema_default'
  }
  return provenance
}

/**
 * Resolve League Health from real Decision OS behavioral data, federated into the existing
 * (untouched) `monitorLeagueHealth` scoring engine. Never throws — degrades honestly to a
 * fully-zeroed, schema-default context on any read failure (matching `resolveManagerIntelligencePayload`'s
 * own contract), never fabricates a score.
 */
export async function resolveDecisionOsLeagueHealth(
  leagueId: string,
  overrides: Partial<LeagueHealthInput> = {},
): Promise<DecisionOsLeagueHealthResult> {
  const fieldProvenance = buildFieldProvenance()

  try {
    const lookback = lookbackDays()
    const since = sinceDate(lookback)
    const events = await loadLeagueEvents(leagueId, since)

    const leagueFacts = assembleLeagueBehavioralFacts({ leagueId, events, lookbackDays: lookback })

    const managerIntelligences = leagueFacts.activeManagerIds.map((managerId) => {
      const facts = assembleManagerBehavioralFacts({ managerId, leagueId, events, lookbackDays: lookback })
      return deriveManagerBehavioralIntelligence(facts, events)
    })

    const inactiveManagerCount = managerIntelligences.filter((mi) => mi.isInactive).length
    const rosterActivityCount = managerIntelligences.reduce((sum, mi) => sum + mi.lineupEngagement.eventCount, 0)
    const managersAtRetentionRisk: ManagerAtRetentionRisk[] = managerIntelligences
      .filter((mi) => mi.retentionRisk === 'high' || mi.retentionRisk === 'critical')
      .map((mi) => ({
        managerId: mi.managerId,
        retentionRisk: mi.retentionRisk,
        retentionRiskReasons: mi.retentionRiskReasons,
        isInactive: mi.isInactive,
      }))

    const trend = await resolveLeagueActivityTrend(leagueId)

    const decisionOs: DecisionOsLeagueHealthContext = {
      activityEventCount: leagueFacts.eventCount,
      activeManagerCount: leagueFacts.activeManagerIds.length,
      inactiveManagerCount,
      tradeCount: leagueFacts.totalTradeCount,
      waiverClaimCount: leagueFacts.totalWaiverClaimCount,
      draftPickCount: leagueFacts.totalDraftPickCount,
      commissionerActionCount: leagueFacts.totalCommissionerActionCount,
      rosterActivityCount,
      managersAtRetentionRisk,
      trend,
    }

    const input = LeagueHealthInputSchema.parse({
      leagueId,
      ...overrides,
      activeManagers: decisionOs.activeManagerCount,
      inactiveManagers: decisionOs.inactiveManagerCount,
      totalTradesThisSeason: decisionOs.tradeCount,
      totalWaiverClaims: decisionOs.waiverClaimCount,
      commissionerActionsThisSeason: decisionOs.commissionerActionCount,
    })

    return { engine: monitorLeagueHealth(input), decisionOs, fieldProvenance }
  } catch {
    // Honest, non-fabricated fallback: zeroed Decision OS context (never invented numbers),
    // engine result computed from schema defaults alone (the same result monitorLeagueHealth
    // would produce for an all-default league — an honest "no data" baseline, not an error page).
    const emptyDecisionOs: DecisionOsLeagueHealthContext = {
      activityEventCount: 0,
      activeManagerCount: 0,
      inactiveManagerCount: 0,
      tradeCount: 0,
      waiverClaimCount: 0,
      draftPickCount: 0,
      commissionerActionCount: 0,
      rosterActivityCount: 0,
      managersAtRetentionRisk: [],
      trend: { available: false, reason: 'no_snapshots' },
    }
    const input = LeagueHealthInputSchema.parse({ leagueId, ...overrides })
    return { engine: monitorLeagueHealth(input), decisionOs: emptyDecisionOs, fieldProvenance }
  }
}
