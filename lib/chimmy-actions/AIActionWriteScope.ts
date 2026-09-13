/**
 * What an AI action would change if the manager carried it through — and how to describe the
 * moment it is STAGED without implying it already happened.
 *
 * `executeAIAction` validates an action and hands the UI a prefill. It never writes a lineup,
 * submits a claim or sends a trade. So the honest state at that point is "staged", and for an
 * imported (SHADOW) league it must also say that nothing reached the source platform.
 *
 * `AI_ACTION_WRITE_SCOPE` is a `Record` over every `AIActionType` on purpose: adding an action
 * type without deciding what it touches is a type error, not a silent default.
 *
 * Client-safe: no `@/lib/prisma`. The DB read lives in `./AIActionLeagueWriteContext`.
 */

import type { AIActionType } from './AIActionModel'
import {
  resolveWriteAuthority,
  sourcePlatformLabel,
  type WriteAuthority,
  type WriteAuthorityAction,
} from '@/lib/league/write-authority'
import type { SourceActionType, SourceLink } from '@/lib/league-links/sourceLinkResolver'

/**
 * The league state an action would change once submitted. `draft` is separate because draft
 * picks and queues have no Write Authority copy. `null` means the action changes nothing on a
 * host platform (analysis, comparisons, AllFantasy-only saves, navigation).
 */
export type AIActionWriteScope = WriteAuthorityAction | 'draft' | null

export const AI_ACTION_WRITE_SCOPE: Record<AIActionType, AIActionWriteScope> = {
  // Draft
  queue_player: 'draft',
  auto_queue_best_3: 'draft',
  draft_player: 'draft',
  set_auction_bid: 'draft',
  bookmark_player: null,
  compare_draft_options: null,
  // Waiver
  claim_player: 'waiver_claim',
  add_to_watchlist: null,
  set_faab_bid: 'waiver_claim',
  drop_player_for_claim: 'waiver_add_drop',
  compare_claims: null,
  save_waiver_plan: null,
  // Lineup
  start_player: 'lineup',
  bench_player: 'lineup',
  optimize_lineup: 'lineup',
  optimize_bench: 'lineup',
  swap_players: 'lineup',
  save_lineup: 'lineup',
  // Trade
  analyze_trade: null,
  propose_trade: 'trade',
  generate_counter: 'trade',
  save_counter_draft: null,
  ai_trade_review: null,
  share_trade_summary: null,
  // Roster
  drop_player: 'waiver_add_drop',
  move_to_bench: 'lineup',
  move_to_ir: 'lineup',
  move_to_il: 'lineup',
  move_to_taxi: 'lineup',
  move_to_devy: 'lineup',
  compare_replacement: null,
  flag_trade_block: null,
  save_future_move: null,
  // Matchup
  simulate_matchup: null,
  try_alternate_starter: 'lineup',
  optimize_ceiling: 'lineup',
  optimize_floor: 'lineup',
  optimize_categories: 'lineup',
  save_matchup_strategy: null,
  // Commissioner
  draft_announcement: null,
  post_recap: null,
  send_warning: null,
  approve_issue: null,
  generate_rule_update: null,
  open_health_report: null,
  // Discovery
  join_league: null,
  save_league: null,
  compare_leagues: null,
  ask_why_fit: null,
  // General
  open_deep_dive: null,
  save_recommendation: null,
  schedule_reminder: null,
  compare_alternatives: null,
  post_to_league_chat: null,
  start_simulation: null,
}

export function getAIActionWriteScope(type: AIActionType): AIActionWriteScope {
  return AI_ACTION_WRITE_SCOPE[type] ?? null
}

/** Which host-platform screen a staged action should link to. */
export function sourceLinkActionForScope(scope: AIActionWriteScope): SourceActionType | undefined {
  switch (scope) {
    case 'lineup':
      return 'lineup'
    case 'trade':
      return 'trade'
    case 'waiver_claim':
    case 'waiver_add_drop':
      return 'waiver'
    case 'draft':
    case 'settings':
      return 'league'
    default:
      return undefined
  }
}

/**
 * Write Authority for a STAGED action. Deliberately carries no success copy: the envelope's
 * `copy` ("Claim submitted", "Waiver recommendation saved") describes a write that happened,
 * and a staged action has not happened anywhere yet.
 */
export type StagedWriteAuthority = {
  authority: WriteAuthority
  platform: string | null
  sourceLabel: string | null
  /** True when submitting would still NOT reach the source platform. */
  shadow: boolean
}

export function buildStagedWriteAuthority(platform: string | null | undefined): StagedWriteAuthority {
  const authority = resolveWriteAuthority(platform)
  return {
    authority,
    platform: platform ?? null,
    sourceLabel: sourcePlatformLabel(platform),
    shadow: authority === 'SHADOW',
  }
}

/**
 * The message for a successfully staged action.
 *
 * - No write scope: unchanged wording — nothing to disclose.
 * - Authority unknown (no league, or the league row could not be read): says it still needs
 *   submitting, and makes no claim about where it would land.
 * - SHADOW: says nothing was sent to the source platform and where to make the change.
 * - NATIVE / CONNECTED: says it still needs reviewing and submitting.
 */
export function describeStagedAction(input: {
  label: string
  scope: AIActionWriteScope
  writeAuthority: StagedWriteAuthority | null
}): string {
  const { label, scope, writeAuthority } = input
  if (scope === null) return `Action "${label}" is ready.`
  if (writeAuthority?.shadow) {
    const source = writeAuthority.sourceLabel ?? 'your host platform'
    return `"${label}" is staged in AllFantasy — nothing has been sent to ${source}. Make the change in ${source} to apply it.`
  }
  return `"${label}" is staged — review and submit it to apply the change.`
}

/**
 * League facts resolved server-side for a staged action (see `./AIActionLeagueWriteContext`).
 * Null means the league could not be read, and the staged message makes no claim about where a
 * submit would land.
 */
export type ActionLeagueWrite = {
  /** Raw `League.platform`; null for a native league. */
  platform: string | null
  /** Host-platform link, only for a SHADOW league. */
  sourceLink: SourceLink | null
}
