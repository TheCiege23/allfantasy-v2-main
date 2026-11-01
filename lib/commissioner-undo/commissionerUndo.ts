/**
 * UNDO FOR COMMISSIONER ACTIONS, UNTIL SOMETHING DEPENDS ON THEM (redraft checklist; spec rule §0.3).
 *
 * Covered: a FAAB edit, a waiver-order edit and a standings edit — the three commissioner tools that
 * already save the value they replaced (`beforeState` on their audit row). Undo puts that value back.
 *
 * An undo is refused once it would rewrite something that has moved on:
 *   - after 24 hours;
 *   - when the value is no longer exactly what the commissioner set — a waiver claim spent the FAAB, a
 *     second edit changed it, a recompute rewrote the standings row. Undoing then would overwrite that
 *     later change, not the commissioner's;
 *   - for FAAB and waiver order, once a waiver run has happened since: the run used the edited value,
 *     so its results depend on it even where the value itself was left untouched;
 *   - for standings, once anything else has written that team's row (its `updatedAt` moved on);
 *   - when it has already been undone.
 *
 * Pure. The service (./commissionerUndoService.ts) reads the facts and applies the undo with the same
 * "still exactly what was set" condition inside the write, so two taps cannot both land.
 */

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000
export const UNDO_ACTION_TYPE = 'commissioner_undo'

export const UNDOABLE_ACTION_TYPES = [
  'commissioner_edit_faab',
  'commissioner_edit_waiver_priority',
  'commissioner_edit_standings',
] as const
export type UndoableActionType = (typeof UNDOABLE_ACTION_TYPES)[number]

export function isUndoableActionType(t: string): t is UndoableActionType {
  return (UNDOABLE_ACTION_TYPES as readonly string[]).includes(t)
}

export const STANDINGS_FIELDS = ['wins', 'losses', 'ties', 'pointsFor', 'pointsAgainst'] as const
export type StandingsFields = Record<(typeof STANDINGS_FIELDS)[number], number>

export type UndoBlock =
  | 'not_undoable'
  | 'too_old'
  | 'already_undone'
  | 'no_before_state'
  | 'changed_since'
  | 'waiver_run_since'

export const UNDO_BLOCK_TEXT: Record<UndoBlock, string> = {
  not_undoable: 'This action cannot be undone.',
  too_old: 'Undo is available for 24 hours.',
  already_undone: 'This was already undone.',
  no_before_state: 'The value before this change was not saved, so it cannot be restored.',
  changed_since: 'This value has changed since, so undoing would overwrite the newer change.',
  waiver_run_since: 'Waivers have run since, and they used this value.',
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** An audit row as the undo reads it. */
export type UndoAuditRow = {
  id: string
  actionType: string
  entityId: string | null
  beforeState: unknown
  afterState: unknown
  createdAt: Date
}

/**
 * What the action set and what it replaced, for the one row it touched. Null when the row does not
 * carry what an undo needs — an older shape, or a hand-written row.
 */
export type UndoPlan =
  | { kind: 'faab'; rosterId: string; before: number | null; after: number | null }
  | { kind: 'waiver_priority'; rosterId: string; before: number | null; after: number | null }
  | {
      kind: 'standings'
      standingId: string
      /** Null when the edit created the row: undoing removes it. */
      before: StandingsFields | null
      after: StandingsFields
      /** The row's `updatedAt` right after the edit; any later write moves it. */
      afterUpdatedAt: string
    }

function standings(v: unknown): StandingsFields | null {
  const o = obj(v)
  const out = {} as StandingsFields
  for (const f of STANDINGS_FIELDS) {
    if (!isNum(o[f])) return null
    out[f] = o[f]
  }
  return out
}

const nullableInt = (v: unknown): number | null | undefined => (v === null ? null : isNum(v) ? v : undefined)

export function planUndo(row: UndoAuditRow): UndoPlan | null {
  const before = row.beforeState
  const after = obj(row.afterState)
  if (row.actionType === 'commissioner_edit_faab' || row.actionType === 'commissioner_edit_waiver_priority') {
    const field = row.actionType === 'commissioner_edit_faab' ? 'faabRemaining' : 'waiverPriority'
    const b = before === null || before === undefined ? undefined : nullableInt(obj(before)[field])
    const a = nullableInt(after[field])
    if (!row.entityId || b === undefined || a === undefined) return null
    return { kind: row.actionType === 'commissioner_edit_faab' ? 'faab' : 'waiver_priority', rosterId: row.entityId, before: b, after: a }
  }
  if (row.actionType === 'commissioner_edit_standings') {
    const a = standings(after)
    const id = typeof after.id === 'string' ? after.id : row.entityId
    const at = after.updatedAt
    const afterUpdatedAt = typeof at === 'string' ? at : at instanceof Date ? at.toISOString() : null
    if (!a || !id || !afterUpdatedAt) return null
    // A null before is a row the edit created; anything else must be a whole standings row.
    const b = before === null ? null : standings(before)
    if (before !== null && !b) return null
    return { kind: 'standings', standingId: id, before: b, after: a, afterUpdatedAt }
  }
  return null
}

/** The present state of what the action touched, read by the service. Null: it no longer exists. */
export type UndoCurrent =
  | { kind: 'roster'; faabRemaining: number | null; waiverPriority: number | null }
  | { kind: 'standings'; fields: StandingsFields; updatedAt: string }
  | null

export function undoBlockReason(args: {
  row: UndoAuditRow
  plan: UndoPlan | null
  now: number
  alreadyUndone: boolean
  /** A waiver run started after the action (FAAB and waiver order only). */
  waiverRunSince: boolean
  current: UndoCurrent
}): UndoBlock | null {
  const { row, plan, current } = args
  if (!isUndoableActionType(row.actionType)) return 'not_undoable'
  if (args.alreadyUndone) return 'already_undone'
  if (args.now - row.createdAt.getTime() > UNDO_WINDOW_MS) return 'too_old'
  if (!plan) return 'no_before_state'
  if (plan.kind === 'standings') {
    if (!current || current.kind !== 'standings') return 'changed_since'
    if (current.updatedAt !== plan.afterUpdatedAt) return 'changed_since'
    if (STANDINGS_FIELDS.some((f) => current.fields[f] !== plan.after[f])) return 'changed_since'
    return null
  }
  if (!current || current.kind !== 'roster') return 'changed_since'
  const now = plan.kind === 'faab' ? current.faabRemaining : current.waiverPriority
  if (now !== plan.after) return 'changed_since'
  if (args.waiverRunSince) return 'waiver_run_since'
  return null
}
