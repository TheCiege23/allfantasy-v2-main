/**
 * AI Action Permission Guard
 * Validates that the current user context has the permissions required to execute
 * an AI action. Also checks league state constraints (draft lock, waiver lock,
 * trade deadline, roster flags, etc.).
 */

import type { AIAction, AIActionContext, AIActionPermission } from './AIActionModel'
import { isActionValidForSport } from './AIActionSportAdapter'

interface PermissionCheckResult {
  allowed: boolean
  /** Human-readable reason when blocked, null when allowed */
  reason: string | null
}

type AIActionClass = 'safe_immediate' | 'confirmed_user' | 'restricted'

type AIActionDecisionStatus = 'allowed' | 'allowed_with_confirmation' | 'blocked'

type BlockedBy =
  | 'permissions'
  | 'premium'
  | 'commissioner_restriction'
  | 'league_state'
  | 'sport_rules'
  | 'transaction_legality'

interface AIActionDecision {
  actionClass: AIActionClass
  status: AIActionDecisionStatus
  requiresConfirmation: boolean
  reason: string | null
  blockedBy?: BlockedBy
}

const SAFE_IMMEDIATE_ACTIONS = new Set([
  'compare_draft_options',
  'compare_claims',
  'compare_replacement',
  'compare_alternatives',
  'open_deep_dive',
  'save_recommendation',
  'add_to_watchlist',
  'queue_player',
])

const CONFIRMED_USER_ACTIONS = new Set([
  'claim_player',
  'drop_player',
  'save_lineup',
  'propose_trade',
  'post_to_league_chat',
  'draft_announcement',
  'post_recap',
  'generate_rule_update',
])

const RESTRICTED_ACTIONS = new Set([
  'approve_issue',
])

// ─── Role Hierarchy ─────────────────────────────────────────────────────────────

/**
 * Maps an AIActionPermission to role-level precedence.
 * 'admin' > 'commissioner' > 'co-owner' > 'member'
 */
const ROLE_RANK: Record<string, number> = {
  admin: 4,
  commissioner: 3,
  'co-owner': 2,
  'co_owner': 2,
  member: 1,
  viewer: 0,
}

/**
 * Does the user's role satisfy the permission requirement?
 */
function roleCoversPermission(
  userRole: AIActionContext['role'],
  permission: AIActionPermission,
): boolean {
  if (userRole === null) return false

  // Subscription permissions checked separately
  if (permission === 'premium' || permission === 'commissioner_subscription') return false

  const permAsRole = permission === 'co_owner' ? 'co-owner' : permission
  const userRank = ROLE_RANK[userRole] ?? 0
  const requiredRank = ROLE_RANK[permAsRole] ?? 99

  return userRank >= requiredRank
}

// ─── Permission Guard ───────────────────────────────────────────────────────────

/**
 * Check whether the user has the permissions required by the action.
 * Returns { allowed: true } or { allowed: false, reason: '...' }.
 */
function validateAIActionPermissions(
  action: AIAction,
  context: AIActionContext,
): PermissionCheckResult {
  const { role, subscriptionState } = context
  const { requiredPermissions } = action

  // Premium subscription check
  if (action.requiresPremium) {
    const hasSub = subscriptionState.hasPremium || subscriptionState.hasAdmin
    if (!hasSub) {
      const label = action.premiumBadgeLabel ?? 'AllFantasy Pro'
      return {
        allowed: false,
        reason: `This action needs ${label}. Upgrade your plan to use it.`,
      }
    }
  }

  // Commissioner subscription check (separate from role)
  if (requiredPermissions.includes('commissioner_subscription')) {
    if (!subscriptionState.hasCommissioner && !subscriptionState.hasAdmin) {
      return {
        allowed: false,
        reason: 'This action requires an AllFantasy Commissioner subscription.',
      }
    }
  }

  // Commissioner / role check
  if (action.requiresCommissioner) {
    if (role !== 'commissioner' && role !== 'admin') {
      return {
        allowed: false,
        reason: 'Only the league commissioner can run this action.',
      }
    }
  }

  // Check minimum role in requiredPermissions (excluding subscription keys)
  const rolePermissions = requiredPermissions.filter(
    (p) => p !== 'premium' && p !== 'commissioner_subscription',
  )
  if (rolePermissions.length > 0) {
    const satisfied = rolePermissions.some((p) => roleCoversPermission(role, p))
    if (!satisfied) {
      return {
        allowed: false,
        reason: 'Your league role does not allow this action.',
      }
    }
  }

  return { allowed: true, reason: null }
}

// ─── League State Constraints ───────────────────────────────────────────────────

/**
 * Check whether league state (lockouts, deadlines, draft status) blocks the action.
 */
function checkLeagueStateConstraints(
  action: AIAction,
  context: AIActionContext,
): PermissionCheckResult {
  const state = context.leagueState

  if (state.isLocked) {
    return { allowed: false, reason: 'The league is currently locked by the commissioner.' }
  }

  const type = action.type

  // Draft-area actions — only valid during active draft
  if (
    ['queue_player', 'auto_queue_best_3', 'draft_player', 'set_auction_bid'].includes(type)
  ) {
    if (!state.isDraftActive) {
      return { allowed: false, reason: 'Draft actions are only available while the draft is live.' }
    }
  }

  // Waiver / claim actions
  if (['claim_player', 'set_faab_bid', 'drop_player_for_claim'].includes(type)) {
    if (!state.isWaiverOpen) {
      return { allowed: false, reason: 'Waivers are currently closed.' }
    }
  }

  // Lineup actions — locked during game windows
  if (
    ['start_player', 'bench_player', 'optimize_lineup', 'optimize_bench', 'swap_players', 'save_lineup', 'move_to_bench'].includes(type)
  ) {
    if (state.isLineupLocked) {
      return { allowed: false, reason: 'Lineup lock is in effect — you cannot change starters.' }
    }
  }

  // Trade actions — locked after trade deadline
  if (['propose_trade', 'generate_counter', 'save_counter_draft'].includes(type)) {
    if (state.isTradeDeadlinePast) {
      return { allowed: false, reason: 'The trade deadline has passed for this season.' }
    }
  }

  // Roster move actions — IR/IL/Taxi/Devy depend on roster config
  if (type === 'move_to_ir') {
    if (!context.rosterState?.hasIR) {
      return { allowed: false, reason: 'This league does not have an IR slot.' }
    }
  }
  if (type === 'move_to_il') {
    if (!context.rosterState?.hasIL) {
      return { allowed: false, reason: 'This league does not have an IL slot.' }
    }
  }
  if (type === 'move_to_taxi') {
    if (!context.rosterState?.hasTaxi) {
      return { allowed: false, reason: 'This league does not have a taxi squad.' }
    }
  }
  if (type === 'move_to_devy') {
    if (!context.rosterState?.hasDevy) {
      return { allowed: false, reason: 'This league does not have a developmental squad.' }
    }
  }

  return { allowed: true, reason: null }
}

function checkSportRuleConstraints(
  action: AIAction,
  context: AIActionContext,
): PermissionCheckResult {
  const sport = action.sport ?? context.sport
  const leagueType = action.leagueType ?? context.leagueType
  if (!isActionValidForSport(action.type, sport, leagueType)) {
    return {
      allowed: false,
      reason: `This action is not supported for ${sport} ${leagueType} leagues.`,
    }
  }

  return { allowed: true, reason: null }
}

function checkTransactionLegality(
  action: AIAction,
  context: AIActionContext,
): PermissionCheckResult {
  const payload = action.payload ?? {}
  const p = payload as Record<string, unknown>
  const transactionState = context.transactionState

  if (transactionState?.canTransact === false) {
    return { allowed: false, reason: 'Transactions are currently disabled for your team.' }
  }
  if (transactionState?.maxTransactionsReached) {
    return { allowed: false, reason: 'You have reached your transaction limit for this period.' }
  }
  if (transactionState?.rosterMoveLocked) {
    return { allowed: false, reason: 'Roster moves are temporarily locked right now.' }
  }
  if (transactionState?.pendingCommissionerApproval) {
    return { allowed: false, reason: 'You already have a pending action awaiting commissioner review.' }
  }

  if (action.type === 'claim_player') {
    const playerId = (p.playerId as string | undefined) ?? (p.playerIds as string[] | undefined)?.[0]
    if (!playerId) return { allowed: false, reason: 'Claim actions must include a player to claim.' }
  }

  if (action.type === 'drop_player') {
    const playerId = (p.playerId as string | undefined) ?? (p.playerIds as string[] | undefined)?.[0]
    if (!playerId) return { allowed: false, reason: 'Drop actions must include a player to drop.' }
  }

  if (action.type === 'drop_player_for_claim') {
    const claimPlayerId = (p.claimPlayerId as string | undefined) ?? (p.playerIds as string[] | undefined)?.[0]
    const dropPlayerId = (p.dropPlayerId as string | undefined) ?? (p.playerIds as string[] | undefined)?.[1]
    if (!claimPlayerId || !dropPlayerId) {
      return { allowed: false, reason: 'Drop-and-claim actions must include both claim and drop players.' }
    }
    if (claimPlayerId === dropPlayerId) {
      return { allowed: false, reason: 'You cannot drop and claim the same player in one action.' }
    }
  }

  if (action.type === 'save_lineup') {
    const changedCount = p.changedSlotCount as number | undefined
    if (typeof changedCount === 'number' && changedCount <= 0) {
      return { allowed: false, reason: 'There are no lineup changes to save.' }
    }
  }

  if (action.type === 'propose_trade' || action.type === 'generate_counter') {
    const targetTeamId = p.targetTeamId as string | undefined
    const givingAssets = p.givingAssets as unknown[] | undefined
    const receivingAssets = p.receivingAssets as unknown[] | undefined

    if (!targetTeamId) {
      return { allowed: false, reason: 'Trade actions must include a target team.' }
    }
    if (!givingAssets || givingAssets.length === 0 || !receivingAssets || receivingAssets.length === 0) {
      return { allowed: false, reason: 'Trade actions must include assets on both sides.' }
    }
  }

  return { allowed: true, reason: null }
}

export function getAIActionClass(action: AIAction): AIActionClass {
  const actionType = String(action.type)

  if (SAFE_IMMEDIATE_ACTIONS.has(actionType)) return 'safe_immediate'

  const destructiveKeyword = /(reset|delete|archive)/i.test(actionType)
  const commissionerOverrideKeyword = /(override|commissioner_override)/i.test(actionType)
  const draftResetKeyword = /draft.*reset|reset.*draft/i.test(actionType)
  if (
    action.safetyClass === 'restricted'
    || RESTRICTED_ACTIONS.has(actionType)
    || destructiveKeyword
    || commissionerOverrideKeyword
    || draftResetKeyword
  ) {
    return 'restricted'
  }

  if (CONFIRMED_USER_ACTIONS.has(actionType)) return 'confirmed_user'

  if (action.safetyClass === 'confirmed') return 'confirmed_user'
  return 'safe_immediate'
}

export function evaluateAIActionDecision(
  action: AIAction,
  context: AIActionContext,
): AIActionDecision {
  const actionClass = getAIActionClass(action)

  const permissionCheck = validateAIActionPermissions(action, context)
  if (!permissionCheck.allowed) {
    const blockedBy: BlockedBy = action.requiresPremium || action.requiredPermissions.includes('premium')
      ? 'premium'
      : action.requiresCommissioner
        ? 'commissioner_restriction'
        : 'permissions'

    return {
      actionClass,
      status: 'blocked',
      requiresConfirmation: false,
      reason: permissionCheck.reason,
      blockedBy,
    }
  }

  const leagueStateCheck = checkLeagueStateConstraints(action, context)
  if (!leagueStateCheck.allowed) {
    return {
      actionClass,
      status: 'blocked',
      requiresConfirmation: false,
      reason: leagueStateCheck.reason,
      blockedBy: 'league_state',
    }
  }

  const sportRuleCheck = checkSportRuleConstraints(action, context)
  if (!sportRuleCheck.allowed) {
    return {
      actionClass,
      status: 'blocked',
      requiresConfirmation: false,
      reason: sportRuleCheck.reason,
      blockedBy: 'sport_rules',
    }
  }

  const transactionCheck = checkTransactionLegality(action, context)
  if (!transactionCheck.allowed) {
    return {
      actionClass,
      status: 'blocked',
      requiresConfirmation: false,
      reason: transactionCheck.reason,
      blockedBy: 'transaction_legality',
    }
  }

  const requiresConfirmation = actionClass !== 'safe_immediate' || action.requiresConfirmation === true
  return {
    actionClass,
    status: requiresConfirmation ? 'allowed_with_confirmation' : 'allowed',
    requiresConfirmation,
    reason: null,
  }
}

// ─── Composite ─────────────────────────────────────────────────────────────────

/**
 * Returns a new action object with `isAvailable` and `disabledReason` populated.
 */
export function applyAvailabilityToAction(
  action: AIAction,
  context: AIActionContext,
): AIAction {
  const decision = evaluateAIActionDecision(action, context)
  const reason = decision.status === 'blocked' ? decision.reason : null
  return {
    ...action,
    isAvailable: reason === null,
    disabledReason: reason,
    requiresConfirmation: decision.requiresConfirmation,
  }
}
