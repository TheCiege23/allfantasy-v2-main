/**
 * AI Action Binding Service — core of the AllFantasy unified action system.
 *
 * Responsibilities:
 *   resolveAIActions()           — turn a BindingInput into a validated list of AIActions
 *   validateAIActionAvailability() — check a single action against context
 *   bindRecommendationToWorkflow() — attach prefill data ready for the UI
 *   executeAIAction()             — stage / return result for UI layer to execute
 *   confirmAIActionIfNeeded()     — returns true if a confirmation modal is required
 */

import type {
  AIAction,
  AIActionContext,
  AIActionResult,
  AIActionType,
  BindingInput,
} from './AIActionModel'
import { AI_ACTION_REGISTRY, getActionMeta } from './AIActionRegistry'
import { applyAvailabilityToAction } from './AIActionPermissionGuard'
import { isActionValidForSport, getSportSpecificPayload } from './AIActionSportAdapter'
import { buildPrefillData, buildWorkflowPrefill, getPrefillTarget } from './AIActionWorkflowPrefiller'
import { validateActionExecution } from './AIActionExecutionValidator'
import { logAIActionEvent } from './AIActionLogger'
import {
  buildStagedWriteAuthority,
  describeStagedAction,
  getAIActionWriteScope,
  type ActionLeagueWrite,
} from './AIActionWriteScope'

// ─── Recommendation → Action Type Inference ─────────────────────────────────────

/**
 * Simple keyword-based inference when no structured type is provided.
 * Returns the single best-matching action type, or null.
 */
function inferActionTypeFromText(text: string): AIActionType | null {
  const lower = text.toLowerCase()

  // Draft keywords
  if (lower.includes('queue') || lower.includes('draft queue')) return 'queue_player'
  if (lower.includes('bid') && lower.includes('auction')) return 'set_auction_bid'
  if (lower.includes('draft') && lower.includes('player')) return 'draft_player'
  if (lower.includes('bookmark')) return 'bookmark_player'

  // Waiver keywords
  if (lower.includes('claim') && (lower.includes('drop') || lower.includes('swap'))) return 'drop_player_for_claim'
  if (lower.includes('claim') || lower.includes('pick up')) return 'claim_player'
  if (lower.includes('faab') || lower.includes('free agent budget')) return 'set_faab_bid'
  if (lower.includes('watchlist') || lower.includes('watch list')) return 'add_to_watchlist'
  if (lower.includes('waiver plan')) return 'save_waiver_plan'

  // Lineup keywords
  if (lower.includes('start') && lower.includes('player')) return 'start_player'
  if (lower.includes('bench') && lower.includes('player')) return 'bench_player'
  if (lower.includes('optimize') && lower.includes('lineup')) return 'optimize_lineup'
  if (lower.includes('optimize') && lower.includes('bench')) return 'optimize_bench'
  if (lower.includes('swap')) return 'swap_players'

  // Trade keywords
  if (lower.includes('counter')) return 'generate_counter'
  if (lower.includes('propose') && lower.includes('trade')) return 'propose_trade'
  if (lower.includes('analyze') && lower.includes('trade')) return 'analyze_trade'
  if (lower.includes('trade') && lower.includes('review')) return 'ai_trade_review'
  if (lower.includes('share') && lower.includes('trade')) return 'share_trade_summary'

  // Roster keywords
  if (lower.includes('drop') && lower.includes('player')) return 'drop_player'
  if (lower.includes('injured reserve') || lower.includes(' ir ') || lower.includes(' ir\n')) return 'move_to_ir'
  if (lower.includes('injured list') || lower.includes(' il ') || lower.includes(' il\n')) return 'move_to_il'
  if (lower.includes('taxi')) return 'move_to_taxi'
  if (lower.includes('devy') || lower.includes('developmental')) return 'move_to_devy'
  if (lower.includes('trade block')) return 'flag_trade_block'

  // Matchup keywords
  if (lower.includes('simulate') || lower.includes('simulation')) return 'simulate_matchup'
  if (lower.includes('alternate starter')) return 'try_alternate_starter'
  if (lower.includes('ceiling')) return 'optimize_ceiling'
  if (lower.includes('floor')) return 'optimize_floor'
  if (lower.includes('categor')) return 'optimize_categories'

  // Commissioner keywords
  if (lower.includes('announcement')) return 'draft_announcement'
  if (lower.includes('recap')) return 'post_recap'
  if (lower.includes('warning') || lower.includes('warn')) return 'send_warning'
  if (lower.includes('health report')) return 'open_health_report'
  if (lower.includes('rule')) return 'generate_rule_update'

  // Discovery keywords
  if (lower.includes('join') && lower.includes('league')) return 'join_league'
  if (lower.includes('why') && lower.includes('league')) return 'ask_why_fit'
  if (lower.includes('compare') && lower.includes('league')) return 'compare_leagues'

  // General fallback
  if (lower.includes('deep dive') || lower.includes('analysis')) return 'open_deep_dive'
  if (lower.includes('reminder')) return 'schedule_reminder'
  if (lower.includes('save')) return 'save_recommendation'
  if (lower.includes('compare') || lower.includes('alternatives')) return 'compare_alternatives'
  if (lower.includes('post') && lower.includes('chat')) return 'post_to_league_chat'

  return null
}

// ─── Build AIAction from Binding Input ─────────────────────────────────────────

function buildAIAction(
  type: AIActionType,
  input: BindingInput,
  context: AIActionContext,
): AIAction {
  const meta = getActionMeta(type)

  // Build base payload from entities
  const basePayload: Record<string, unknown> = {
    ...(input.entities ?? {}),
    sport: input.sport,
    leagueType: input.leagueType,
    leagueId: input.leagueId ?? null,
    teamId: input.teamId ?? null,
    confidencePct: input.confidencePct ?? null,
    recommendationText: input.recommendationText ?? null,
  }

  // Merge sport-specific payload
  const sportExtra = getSportSpecificPayload(type, input.sport, input.leagueType)

  const action: AIAction = {
    id: crypto.randomUUID(),
    type,
    label: meta.label,
    description: meta.description,
    surface: input.surface,
    leagueId: input.leagueId ?? null,
    teamId: input.teamId ?? null,
    sport: input.sport,
    leagueType: input.leagueType,
    safetyClass: meta.safetyClass,
    requiresConfirmation: meta.safetyClass !== 'instant',
    requiresCommissioner: meta.requiresCommissioner,
    requiresPremium: meta.requiresPremium,
    requiredPermissions: meta.requiredPermissions,
    isAvailable: true,
    disabledReason: null,
    payload: { ...basePayload, ...sportExtra },
    prefillTarget: getPrefillTarget(type) ?? meta.prefillTarget ?? null,
    prefillData: undefined,
    workflowPrefill: null,
    deepDiveHref: null,
    isDestructive: meta.isDestructive,
    premiumBadgeLabel: meta.premiumBadgeLabel,
  }

  // Attach prefill data
  action.prefillData = buildPrefillData(action)
  action.workflowPrefill = buildWorkflowPrefill(action)

  return action
}

// ─── resolveAIActions ───────────────────────────────────────────────────────────

/**
 * Turn a BindingInput into a validated, enriched list of AIActions ready for the UI.
 *
 * If `recommendationType` is provided, that becomes the primary action.
 * If `recommendationText` is provided, we infer the primary type.
 * We also append a universal `open_deep_dive` secondary action.
 */
export function resolveAIActions(
  input: BindingInput,
  context: AIActionContext,
): AIAction[] {
  const actions: AIAction[] = []

  // Primary action
  const primaryType: AIActionType | null =
    input.recommendationType ??
    (input.recommendationText ? inferActionTypeFromText(input.recommendationText) : null)

  if (primaryType) {
    if (isActionValidForSport(primaryType, input.sport, input.leagueType)) {
      const action = buildAIAction(primaryType, input, context)
      const validated = applyAvailabilityToAction(action, context)
      actions.push(validated)
    }
  }

  // Always append open_deep_dive as secondary if not already primary
  if (primaryType !== 'open_deep_dive') {
    const deepDive = buildAIAction('open_deep_dive', input, context)
    const validated = applyAvailabilityToAction(deepDive, context)
    actions.push(validated)
  }

  // Always append save_recommendation unless it's the primary
  if (primaryType !== 'save_recommendation') {
    const save = buildAIAction('save_recommendation', input, context)
    const validated = applyAvailabilityToAction(save, context)
    actions.push(validated)
  }

  return actions
}

// ─── validateAIActionAvailability ──────────────────────────────────────────────

/**
 * Re-validate a single action against the current context.
 * Returns an updated action with `isAvailable` and `disabledReason` set.
 */
export function validateAIActionAvailability(
  action: AIAction,
  context: AIActionContext,
): AIAction {
  return applyAvailabilityToAction(action, context)
}

// ─── bindRecommendationToWorkflow ───────────────────────────────────────────────

/**
 * Enrich an action with up-to-date prefill data and a deep dive href.
 * Call this just before presenting an action to the user.
 */
export function bindRecommendationToWorkflow(action: AIAction): AIAction {
  const prefillData = buildPrefillData(action)
  const workflowPrefill = buildWorkflowPrefill(action)

  // Build deep dive route if leagueId is present
  const deepDiveHref = buildDeepDiveHref(action)

  return {
    ...action,
    prefillData,
    workflowPrefill,
    prefillTarget: getPrefillTarget(action.type) ?? action.prefillTarget ?? null,
    deepDiveHref,
  }
}

function buildDeepDiveHref(action: AIAction): string | null {
  const { leagueId, teamId, sport, type } = action

  const entityId = (action.payload.playerIds as string[] | undefined)?.[0]

  if (type === 'open_deep_dive' && entityId) {
    return `/players/${entityId}`
  }
  if (leagueId && teamId) {
    return `/leagues/${leagueId}/teams/${teamId}`
  }
  if (leagueId) {
    return `/leagues/${leagueId}`
  }
  if (sport) {
    return `/sports/${sport.toLowerCase()}`
  }
  return null
}

// ─── confirmAIActionIfNeeded ────────────────────────────────────────────────────

/**
 * Returns true when the action requires a confirmation modal before execution.
 * The UI checks this to decide whether to show <ChimmyActionConfirmModal>.
 */
export function confirmAIActionIfNeeded(action: AIAction): boolean {
  return action.requiresConfirmation || action.isDestructive === true
}

// ─── executeAIAction ────────────────────────────────────────────────────────────

/**
 * Stage an AI action for execution.
 *
 * This service layer validates the action and returns an AIActionResult.
 * Actual workflow execution (lineup saves, waiver submits, etc.) is performed
 * by the UI layer via prefillTarget + prefillData.
 *
 * Logs 'staged' on success — never 'completed', because nothing has been written yet. The
 * result says so too (`outcome: 'staged'`, `executed: false`), and for a league-changing action
 * `leagueWrite` (resolved server-side from the authorized league) lets the message disclose
 * that an imported league's host platform has not been touched.
 */
export async function executeAIAction(
  action: AIAction,
  context: AIActionContext,
  leagueWrite?: ActionLeagueWrite | null,
): Promise<AIActionResult> {
  const start = Date.now()

  // Re-validate before executing
  const validatedExecution = validateActionExecution(action, context)
  const validated = validatedExecution.normalizedAction

  if (!validatedExecution.allowed) {
    const firstIssue = validatedExecution.issues[0]
    await logAIActionEvent({
      id: crypto.randomUUID(),
      actionType: action.type,
      surface: action.surface,
      userId: context.userId,
      leagueId: action.leagueId,
      teamId: action.teamId,
      sport: action.sport,
      event: 'failed',
      timestamp: Date.now(),
      metadata: {
        reason: firstIssue?.message ?? validated.disabledReason,
        issues: validatedExecution.issues.map((issue) => issue.code),
      },
    })
    return {
      success: false,
      actionId: action.id,
      actionType: action.type,
      message: firstIssue?.message ?? validated.disabledReason ?? 'Action is not available.',
      error: firstIssue?.message ?? validated.disabledReason ?? 'Action unavailable',
      outcome: 'failed',
      executed: false,
      data: {
        issues: validatedExecution.issues,
      },
    }
  }

  // Enrich with latest prefill
  const enriched = bindRecommendationToWorkflow(validated)

  // Log staging — NOT completion. The manager has not submitted anything yet.
  await logAIActionEvent({
    id: crypto.randomUUID(),
    actionType: action.type,
    surface: action.surface,
    userId: context.userId,
    leagueId: action.leagueId,
    teamId: action.teamId,
    sport: action.sport,
    event: 'staged',
    timestamp: Date.now(),
    durationMs: Date.now() - start,
  })

  const writeScope = getAIActionWriteScope(enriched.type)
  const writeAuthority =
    writeScope !== null && leagueWrite ? buildStagedWriteAuthority(leagueWrite.platform) : null

  return {
    success: true,
    actionId: enriched.id,
    actionType: enriched.type,
    message: describeStagedAction({ label: enriched.label, scope: writeScope, writeAuthority }),
    outcome: 'staged',
    executed: false,
    writeScope,
    writeAuthority,
    sourceLink: writeAuthority?.shadow ? (leagueWrite?.sourceLink ?? null) : null,
    prefillApplied: Boolean(enriched.prefillData && Object.keys(enriched.prefillData).length > 0),
    navigateTo: enriched.deepDiveHref ?? null,
    data: {
      prefillTarget: enriched.prefillTarget,
      prefillData: enriched.prefillData,
      workflowPrefill: enriched.workflowPrefill,
    },
  }
}
