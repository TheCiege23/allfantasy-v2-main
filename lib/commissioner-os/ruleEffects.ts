/**
 * The planned-effect vocabulary — what a template can say it wants to happen.
 *
 * 🛑 THESE MAP ONTO `lib/specialty-automation/actionPlans.ts` WHEREVER ONE ALREADY EXISTS, RATHER
 * THAN INVENTING A PARALLEL SET OF ACTION STRINGS. `ELIMINATE_ROSTER` emits `eliminate_roster`, the
 * exact string `planEliminateRoster` already produces and `persistAutomationActions` already
 * writes. That matters more than it looks: the specialty automation pipeline persists actions by
 * `actionType`, so a second vocabulary would produce rows that every existing reader silently
 * ignores — present in the table, absent from every surface, and indistinguishable from an action
 * that was never planned.
 *
 * ⚠ NOTHING HERE EXECUTES. A `RuleEffect` is a declaration in a template; the planner turns it into
 * a `PlannedAction` carrying an authority verdict. Executors are out of scope for this phase and
 * five of these effects have no executor anywhere in the repo yet — `executorStatus` says which,
 * so a surface can tell "planned and ready" from "planned and nobody can run it".
 *
 * Pure: constants and lookups only.
 */

import { ActionTypes } from '@/lib/specialty-automation/actionPlans'
import type { EffectScope } from '@/lib/commissioner-os/authority'

export type RuleEffectType =
  | 'ADD_ROSTER_SLOT'
  | 'SET_BENCH_SIZE'
  | 'AWARD_FAAB'
  | 'ASSIGN_POWER'
  | 'CONSUME_POWER'
  | 'MOVE_TRIBE'
  | 'ELIMINATE_ROSTER'
  | 'RELEASE_ROSTER'
  | 'TRANSFER_PLAYER'
  | 'PROMOTE_TEAM'
  | 'RELEGATE_TEAM'
  | 'ASSIGN_DRAFT_SLOT'
  | 'CREATE_COMMISSIONER_TASK'
  | 'GENERATE_ANNOUNCEMENT'

/**
 * Whether anything in this repo can carry the effect out today.
 *
 * `engine`  — a canonical engine exists and this effect delegates to it.
 * `planned` — the action type is persisted by the specialty pipeline but no executor applies it.
 * `none`    — no executor and no persistence path. Guidance only.
 *
 * ⚠ THIS IS THE FIELD THAT KEEPS A FIXTURE HONEST. A template listing fourteen effects reads as
 * fourteen automated behaviours unless something says otherwise. Nine of these are `planned` or
 * `none` right now.
 */
export type RuleEffectExecutorStatus = 'engine' | 'planned' | 'none'

export type RuleEffectDefinition = {
  type: RuleEffectType
  /**
   * The `PlannedAction.actionType` string this effect emits.
   *
   * ⚠ REUSED FROM `ActionTypes` WHERE ONE EXISTS. New strings are snake_case to match the five
   * that already ship, because `AutomationAction.actionType` is a plain column and a mixed-case
   * value would be invisible to every existing query.
   */
  actionType: string
  scope: EffectScope
  /** Whether a later import/sync of the league can establish the effect happened. */
  verifiableFromImport: boolean
  executorStatus: RuleEffectExecutorStatus
  /** The canonical engine that owns this behaviour, when one does. Not a call — a pointer. */
  canonicalEngine: string | null
  summary: string
}

/**
 * ⚠ SCOPE IS ABOUT THE SYSTEM OF RECORD, NOT ABOUT IMPORTANCE. `ELIMINATE_ROSTER` is `external`
 * because on an imported league the roster genuinely lives on the host platform and AllFantasy
 * dropping it here would not drop it there. `MOVE_TRIBE` is `internal` because no host platform has
 * ever heard of a tribe — it is an AllFantasy construct end to end, so AF can execute it on a
 * Sleeper league without claiming anything false.
 */
export const RULE_EFFECTS: Readonly<Record<RuleEffectType, RuleEffectDefinition>> = {
  ADD_ROSTER_SLOT: {
    type: 'ADD_ROSTER_SLOT',
    actionType: 'add_roster_slot',
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'planned',
    canonicalEngine: 'lib/guillotine/rosterExpansionEngine.ts',
    summary: 'Open a new starting-lineup slot from a published schedule.',
  },
  SET_BENCH_SIZE: {
    type: 'SET_BENCH_SIZE',
    actionType: 'set_bench_size',
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'planned',
    canonicalEngine: 'lib/guillotine/rosterExpansionEngine.ts',
    summary: 'Change bench depth alongside a lineup expansion.',
  },
  AWARD_FAAB: {
    type: 'AWARD_FAAB',
    actionType: 'award_faab',
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'none',
    canonicalEngine: null,
    summary: 'Grant reward FAAB on top of the season budget.',
  },
  ASSIGN_POWER: {
    type: 'ASSIGN_POWER',
    actionType: 'assign_power',
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'planned',
    canonicalEngine: 'lib/survivor/',
    summary: 'Give a team an idol, token or other power.',
  },
  CONSUME_POWER: {
    type: 'CONSUME_POWER',
    actionType: 'consume_power',
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'planned',
    canonicalEngine: 'lib/survivor/',
    summary: 'Spend a power and record the ledger entry.',
  },
  MOVE_TRIBE: {
    type: 'MOVE_TRIBE',
    actionType: 'move_tribe',
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'planned',
    canonicalEngine: 'lib/survivor/',
    summary: 'Move a team between tribes (shuffle, swap token, merge).',
  },
  ELIMINATE_ROSTER: {
    type: 'ELIMINATE_ROSTER',
    /** Existing string — `planEliminateRoster` already emits it. */
    actionType: ActionTypes.eliminateRoster,
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'engine',
    canonicalEngine: 'lib/guillotine/GuillotineEliminationEngine.ts',
    summary: 'Remove a team from the competition.',
  },
  RELEASE_ROSTER: {
    type: 'RELEASE_ROSTER',
    /** Existing string — `planReleaseToWaiverPool` already emits it. */
    actionType: ActionTypes.releaseToWaivers,
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'engine',
    canonicalEngine: 'lib/guillotine/GuillotineRosterReleaseEngine.ts',
    summary: 'Return an eliminated roster to the waiver pool.',
  },
  TRANSFER_PLAYER: {
    type: 'TRANSFER_PLAYER',
    actionType: 'transfer_player',
    scope: 'external',
    verifiableFromImport: true,
    executorStatus: 'none',
    canonicalEngine: null,
    summary: 'Move one player between rosters outside a trade.',
  },
  PROMOTE_TEAM: {
    type: 'PROMOTE_TEAM',
    /** Existing string — `planPromoteOrRelegate` already emits it. */
    actionType: ActionTypes.promoteTeam,
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'engine',
    canonicalEngine: 'lib/promotion-relegation/PromotionEngine.ts',
    summary: 'Move a team up a tier at season end.',
  },
  RELEGATE_TEAM: {
    type: 'RELEGATE_TEAM',
    actionType: ActionTypes.relegateTeam,
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'engine',
    canonicalEngine: 'lib/promotion-relegation/PromotionEngine.ts',
    summary: 'Move a team down a tier at season end.',
  },
  ASSIGN_DRAFT_SLOT: {
    type: 'ASSIGN_DRAFT_SLOT',
    actionType: 'assign_draft_slot',
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'none',
    canonicalEngine: null,
    summary: 'Place a team at a specific rookie-draft slot.',
  },
  CREATE_COMMISSIONER_TASK: {
    type: 'CREATE_COMMISSIONER_TASK',
    /** Existing string — `planCommissionerTask` already emits it. */
    actionType: ActionTypes.commissionerTask,
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'planned',
    canonicalEngine: null,
    summary: 'Queue something a human has to do.',
  },
  GENERATE_ANNOUNCEMENT: {
    type: 'GENERATE_ANNOUNCEMENT',
    actionType: 'generate_announcement',
    scope: 'internal',
    verifiableFromImport: false,
    executorStatus: 'none',
    canonicalEngine: null,
    summary: 'Draft a league-facing message about what just happened.',
  },
}

export function getRuleEffect(type: RuleEffectType): RuleEffectDefinition {
  return RULE_EFFECTS[type]
}

export const RULE_EFFECT_TYPES: readonly RuleEffectType[] = Object.freeze(
  (Object.keys(RULE_EFFECTS) as RuleEffectType[]).sort(),
)
