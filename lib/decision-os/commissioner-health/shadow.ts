/**
 * Decision OS — shadow runner for `commissioner.league.health` (Slice 4 integration).
 *
 * Runs the Decision OS health-assessment path BESIDE the Commissioner Hub's built snapshot, compares
 * parity (WRAP-FIDELITY: fed the same deterministic snapshot), logs status, and NEVER throws or
 * affects the returned hub snapshots. Gated by DECISION_OS_COMMISSIONER_HEALTH_SHADOW. ASSESSMENT
 * ONLY — the Decision OS never executes a commissioner action, changes settings, sends announcements,
 * locks teams, reverses trades, processes waivers, adjusts scores, or mutates any league state.
 */
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { shouldRunShadow, type DecisionShadowScope } from '@/lib/decision-os/core/shadow'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { runCommissionerHealthDecision, type RunCommissionerHealthResult } from './index'
import { buildProductionCommissionerHealthDecisionDeps } from './deps'
import type { CommissionerHealthDecisionDeps } from './decision'

export function shouldRunCommissionerHealthShadow(
  env: NodeJS.ProcessEnv = process.env,
  scope?: DecisionShadowScope,
): boolean {
  return shouldRunShadow('DECISION_OS_COMMISSIONER_HEALTH_SHADOW', env, scope)
}

/**
 * Stage 1 kill switch: when DECISION_OS_COMMISSIONER_HEALTH_LIVE=true, decisionOsShadow is
 * populated unconditionally on all database-source snapshots (not scope-filtered). Instant
 * rollback by setting the env var to false/unsetting it — no deploy required.
 */
export function shouldRunCommissionerHealthLive(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env['DECISION_OS_COMMISSIONER_HEALTH_LIVE'] ?? '').trim().toLowerCase() === 'true'
}

export interface CommissionerHealthShadowResult {
  ran: boolean
  leagueId: string
  result?: RunCommissionerHealthResult
  error?: string
}

export interface CommissionerHealthShadowDeps {
  buildDecisionDeps: (memo: CommissionerLeagueHealthSnapshot) => CommissionerHealthDecisionDeps
}

const defaultShadowDeps: CommissionerHealthShadowDeps = {
  buildDecisionDeps: (memo) => buildProductionCommissionerHealthDecisionDeps(memo),
}

/**
 * Shadow one league's health assessment. The decision is fed the SAME built deterministic snapshot,
 * and parity compares the Decision OS assessment against it — proving the wrapper introduces NO drift.
 * Never throws; never mutates league state. Skips the dashboard-fallback path (low-confidence,
 * non-authoritative).
 */
export async function runCommissionerHealthShadow(
  args: { userId: string; snapshot: CommissionerLeagueHealthSnapshot },
  deps: Partial<CommissionerHealthShadowDeps> = {},
): Promise<CommissionerHealthShadowResult> {
  const buildDecisionDeps = deps.buildDecisionDeps ?? defaultShadowDeps.buildDecisionDeps
  const leagueId = args.snapshot?.leagueId ?? ''
  try {
    // Skip the non-authoritative fallback path (no live roster reads).
    if (!args.snapshot || args.snapshot.source === 'dashboard-fallback') {
      emitShadowParity('commissioner.league.health', { shadow: true, ran: false, reason: 'fallback_or_missing_snapshot', userId: args.userId, leagueId })
      return { ran: false, leagueId, error: 'fallback_or_missing_snapshot' }
    }
    const result = await runCommissionerHealthDecision(
      { snapshot: args.snapshot, userId: args.userId },
      { decision: buildDecisionDeps(args.snapshot), shadow: { snapshot: args.snapshot } },
    )
    return { ran: true, leagueId, result }
  } catch (e) {
    emitShadowParity('commissioner.league.health', { shadow: true, ran: false, reason: 'shadow_error', userId: args.userId, leagueId })
    return { ran: false, leagueId, error: e instanceof Error ? e.message : 'shadow_error' }
  }
}
