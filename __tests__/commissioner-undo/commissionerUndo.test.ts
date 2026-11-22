import { describe, expect, it } from 'vitest'
import { planUndo, UNDO_WINDOW_MS, undoBlockReason, type UndoAuditRow, type UndoCurrent } from '@/lib/commissioner-undo/commissionerUndo'

const AT = new Date('2026-10-25T12:00:00.000Z')
const NOW = AT.getTime() + 60_000

const row = (over: Partial<UndoAuditRow>): UndoAuditRow => ({
  id: 'a1', actionType: 'commissioner_edit_faab', entityId: 'r1',
  beforeState: { id: 'r1', faabRemaining: 100 }, afterState: { faabRemaining: 60 }, createdAt: AT, ...over,
})
const roster = (faabRemaining: number | null, waiverPriority: number | null = 3): UndoCurrent => ({ kind: 'roster', faabRemaining, waiverPriority })

const standingAfter = { id: 's1', wins: 5, losses: 2, ties: 0, pointsFor: 700.5, pointsAgainst: 650, rank: 2, updatedAt: '2026-10-25T11:59:59.123Z' }
const standingRow = (before: unknown) => row({ actionType: 'commissioner_edit_standings', entityId: 's1', beforeState: before, afterState: standingAfter })
const standingNow = (over: Partial<{ wins: number; updatedAt: string }> = {}): UndoCurrent => ({
  kind: 'standings', fields: { wins: over.wins ?? 5, losses: 2, ties: 0, pointsFor: 700.5, pointsAgainst: 650 }, updatedAt: over.updatedAt ?? standingAfter.updatedAt,
})

const block = (r: UndoAuditRow, current: UndoCurrent, over: Partial<{ now: number; alreadyUndone: boolean; waiverRunSince: boolean }> = {}) =>
  undoBlockReason({ row: r, plan: planUndo(r), now: over.now ?? NOW, alreadyUndone: over.alreadyUndone ?? false, waiverRunSince: over.waiverRunSince ?? false, current })

describe('what an undo restores', () => {
  it('reads the replaced value of a FAAB, waiver-order and standings edit', () => {
    expect(planUndo(row({}))).toEqual({ kind: 'faab', rosterId: 'r1', before: 100, after: 60 })
    expect(planUndo(row({ actionType: 'commissioner_edit_waiver_priority', beforeState: { waiverPriority: 1 }, afterState: { waiverPriority: 8 } })))
      .toEqual({ kind: 'waiver_priority', rosterId: 'r1', before: 1, after: 8 })
    expect(planUndo(standingRow({ wins: 4, losses: 3, ties: 0, pointsFor: 690, pointsAgainst: 660 }))).toEqual({
      kind: 'standings', standingId: 's1', before: { wins: 4, losses: 3, ties: 0, pointsFor: 690, pointsAgainst: 660 },
      after: { wins: 5, losses: 2, ties: 0, pointsFor: 700.5, pointsAgainst: 650 }, afterUpdatedAt: standingAfter.updatedAt,
    })
  })

  it('treats a standings edit that created the row as "remove it", and an unreadable row as not restorable', () => {
    expect(planUndo(standingRow(null))).toMatchObject({ kind: 'standings', before: null })
    expect(planUndo(row({ beforeState: null }))).toBeNull()
    expect(planUndo(standingRow({ wins: 'four' }))).toBeNull()
    expect(planUndo(row({ actionType: 'settings_patch' }))).toBeNull()
  })
})

describe('when an undo is refused', () => {
  it('allows a fresh edit whose value is untouched', () => {
    expect(block(row({}), roster(60))).toBeNull()
    expect(block(standingRow(null), standingNow())).toBeNull()
  })

  it('refuses another kind of action, an undone one, and one older than 24 hours', () => {
    expect(block(row({ actionType: 'settings_patch' }), roster(60))).toBe('not_undoable')
    expect(block(row({}), roster(60), { alreadyUndone: true })).toBe('already_undone')
    expect(block(row({}), roster(60), { now: AT.getTime() + UNDO_WINDOW_MS + 1 })).toBe('too_old')
  })

  it('refuses once the value moved on — a claim spent the FAAB, or the row is gone', () => {
    expect(block(row({}), roster(45))).toBe('changed_since')
    expect(block(row({}), null)).toBe('changed_since')
  })

  it('refuses FAAB and waiver order once waivers have run, even if the value is unchanged', () => {
    expect(block(row({}), roster(60), { waiverRunSince: true })).toBe('waiver_run_since')
    const prio = row({ actionType: 'commissioner_edit_waiver_priority', beforeState: { waiverPriority: 1 }, afterState: { waiverPriority: 8 } })
    expect(block(prio, roster(null, 8), { waiverRunSince: true })).toBe('waiver_run_since')
  })

  it('refuses standings once anything else wrote the row, even back to the same numbers', () => {
    expect(block(standingRow(null), standingNow({ wins: 6 }))).toBe('changed_since')
    expect(block(standingRow(null), standingNow({ updatedAt: '2026-10-25T13:00:00.000Z' }))).toBe('changed_since')
    // A waiver run says nothing about standings.
    expect(block(standingRow(null), standingNow(), { waiverRunSince: true })).toBeNull()
  })

  it('refuses a row that never saved what it replaced', () => {
    expect(block(row({ beforeState: null }), roster(60))).toBe('no_before_state')
  })
})
