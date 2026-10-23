/**
 * @vitest-environment node
 *
 * The change-aware writers behind the league sync: a re-sync that finds nothing new must write
 * nothing, and one that finds something must write exactly that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  executeRaw: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    teamPerformance: { findMany: db.findMany, createMany: db.createMany, upsert: db.upsert },
    $executeRaw: (...a: unknown[]) => db.executeRaw(...a),
  },
}))

import {
  changedTeamPerformances,
  collapseTeamPerformanceWrites,
  writeTeamPerformances,
  type TeamPerformanceWrite,
} from '@/lib/league-import/teamPerformanceWrites'
import { importedPlayerDataEquivalent, importedRosterUnchanged, stableJson } from '@/lib/league-import/rosterWriteEquivalence'
import { changeAwareWritesEnabled } from '@/lib/league-import/changeAwareWrites'

const inserted = (): TeamPerformanceWrite[] => db.createMany.mock.calls.flatMap((c) => (c[0] as { data: TeamPerformanceWrite[] }).data)
const updated = (): TeamPerformanceWrite[] =>
  db.executeRaw.mock.calls.flatMap((call) => {
    const payload = (call.slice(1) as unknown[]).find((v) => typeof v === 'string' && v.startsWith('['))
    return payload ? (JSON.parse(payload as string) as TeamPerformanceWrite[]) : []
  })
const sent = () => [...inserted(), ...updated()]
const sqlText = () => (db.executeRaw.mock.calls[0]?.[0] as string[] | undefined)?.join('$') ?? ''

const row = (teamId: string, week: number, points: number, over: Partial<TeamPerformanceWrite> = {}): TeamPerformanceWrite => ({
  teamId, week, points, opponent: 'opp', result: 'W', ...over,
})
const storedOf = (rows: TeamPerformanceWrite[]) => rows.map(({ teamId, week, points, opponent, result }) => ({ teamId, week, points, opponent, result }))

describe('team_performances', () => {
  beforeEach(() => {
    db.findMany.mockReset().mockResolvedValue([])
    db.upsert.mockReset().mockResolvedValue({})
    db.createMany.mockReset().mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
    db.executeRaw.mockReset().mockImplementation(async (_s: unknown, ...values: unknown[]) => {
      const payload = values.find((v) => typeof v === 'string' && v.startsWith('['))
      return payload ? (JSON.parse(payload as string) as unknown[]).length : 0
    })
  })

  const schedule = [row('t1', 1, 100), row('t2', 1, 90, { result: 'L' }), row('t1', 2, 80, { result: 'L' }), row('t2', 2, 85)]

  it('writes nothing when the schedule is identical to what is stored', async () => {
    db.findMany.mockResolvedValue(storedOf(schedule))
    const out = await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(db.executeRaw).not.toHaveBeenCalled()
    expect(db.createMany).not.toHaveBeenCalled()
    expect(db.upsert).not.toHaveBeenCalled()
    expect(out).toMatchObject({ processed: 4, changed: 0, written: 0 })
  })

  it('sends only the rows whose score changed, in one statement', async () => {
    db.findMany.mockResolvedValue(storedOf(schedule))
    const next = schedule.map((r) => (r.teamId === 't1' && r.week === 2 ? { ...r, points: 82.5 } : r))
    const out = await writeTeamPerformances({ season: 2026, rows: next })
    expect(db.executeRaw).toHaveBeenCalledOnce()
    expect(sent()).toEqual([expect.objectContaining({ teamId: 't1', week: 2, points: 82.5 })])
    expect(out).toMatchObject({ changed: 1, written: 1, fellBack: false })
  })

  it('inserts weeks that are not stored yet through Prisma, without supplying ids', async () => {
    db.findMany.mockResolvedValue(storedOf(schedule.slice(0, 2)))
    await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(inserted().map((r) => `${r.teamId}:${r.week}`).sort()).toEqual(['t1:2', 't2:2'])
    expect(inserted().every((r) => !('id' in r))).toBe(true)
    expect(db.createMany.mock.calls[0][0].skipDuplicates).toBe(true)
    expect(db.executeRaw).not.toHaveBeenCalled()
  })

  it('a row another writer inserted after the read is settled by the guarded update', async () => {
    db.findMany.mockResolvedValue([])
    db.createMany.mockResolvedValue({ count: 3 })
    db.executeRaw.mockResolvedValue(0)
    await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(updated()).toHaveLength(4)
  })

  it('reads the season once, scoped to this league\'s teams', async () => {
    await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(db.findMany).toHaveBeenCalledOnce()
    expect(db.findMany.mock.calls[0][0].where).toEqual({ teamId: { in: ['t1', 't2'] }, season: 2026 })
  })

  /*
   * The old upsert wrote `opponent: tid ?? undefined` and `result: undefined` on update, so an
   * unresolved opponent or an opponent with no points yet never erased a stored value.
   */
  it('a missing opponent or result keeps the stored value and is not a change', async () => {
    const stored = [row('t1', 1, 100, { opponent: 't2', result: 'W' })]
    expect(changedTeamPerformances([row('t1', 1, 100, { opponent: null, result: null })], stored)).toEqual([])
    expect(changedTeamPerformances([row('t1', 1, 100, { opponent: 't3', result: null })], stored)).toHaveLength(1)
    expect(changedTeamPerformances([row('t1', 1, 100, { opponent: null, result: 'L' })], stored)).toHaveLength(1)
  })

  it('keeps stored opponent/result in the SQL too, and re-checks distinctness at write time', async () => {
    db.findMany.mockResolvedValue(storedOf(schedule).map((r) => ({ ...r, points: r.points + 1 })))
    await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(sqlText()).toMatch(/opponent = COALESCE\(r\.opponent, t\.opponent\)/)
    expect(sqlText()).toMatch(/result = COALESCE\(r\.result, t\.result\)/)
    expect(sqlText()).toMatch(/IS DISTINCT FROM/)
  })

  it('collapses a repeated team-week the way sequential upserts did', () => {
    const rows = collapseTeamPerformanceWrites([
      row('t1', 1, 10, { opponent: 't2', result: 'W' }),
      row('t1', 1, 12, { opponent: null, result: null }),
    ])
    expect(rows).toEqual([row('t1', 1, 12, { opponent: 't2', result: 'W' })])
  })

  it('falls back to per-row upserts, ignoring failures, when the batch fails', async () => {
    db.createMany.mockRejectedValue(new Error('batch failed'))
    db.upsert.mockRejectedValueOnce(new Error('fk')).mockResolvedValue({})
    const out = await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(out.fellBack).toBe(true)
    expect(db.upsert).toHaveBeenCalledTimes(4)
    expect(out.written).toBe(3)
    expect(db.upsert.mock.calls[0][0]).toMatchObject({
      where: { teamId_season_week: { teamId: 't1', season: 2026, week: 1 } },
      update: { points: 100, opponent: 'opp', result: 'W' },
    })
  })

  it('takes the per-row path when the stored season cannot be read', async () => {
    db.findMany.mockRejectedValue(new Error('read failed'))
    const out = await writeTeamPerformances({ season: 2026, rows: schedule })
    expect(db.executeRaw).not.toHaveBeenCalled()
    expect(db.upsert).toHaveBeenCalledTimes(4)
    expect(out).toMatchObject({ changed: 4, written: 4, fellBack: true })
  })

  it('kill switch "team-performances" restores the per-row upsert of every row', async () => {
    process.env.AF_CHANGE_AWARE_WRITES_OFF = 'team-performances'
    try {
      db.findMany.mockResolvedValue(storedOf(schedule))
      const out = await writeTeamPerformances({ season: 2026, rows: schedule })
      expect(db.findMany).not.toHaveBeenCalled()
      expect(db.createMany).not.toHaveBeenCalled()
      expect(db.upsert).toHaveBeenCalledTimes(4)
      expect(out).toMatchObject({ written: 4, fellBack: true })
    } finally {
      delete process.env.AF_CHANGE_AWARE_WRITES_OFF
    }
  })

  it('does nothing at all for an empty schedule', async () => {
    const out = await writeTeamPerformances({ season: 2026, rows: [] })
    expect(db.findMany).not.toHaveBeenCalled()
    expect(out.processed).toBe(0)
  })
})

describe('imported roster equivalence', () => {
  const base = {
    players: ['a', 'b'],
    starters: ['a'],
    reserve: [],
    taxi: [],
    lineup_sections: { starters: ['a'], bench: ['b'], ir: [], taxi: [], devy: [] },
    source_team_id: '3',
    imported_at: '2026-10-23T10:00:00.000Z',
    import_batch_id: 'batch-1',
  }

  it('ignores only the run-scoped keys and key order', () => {
    const reordered = { taxi: [], imported_at: '2026-10-23T10:05:00.000Z', import_batch_id: 'batch-2', ...base }
    delete (reordered as Record<string, unknown>).imported_at
    expect(importedPlayerDataEquivalent(base, { ...reordered, imported_at: 'later', import_batch_id: 'b2' })).toBe(true)
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe(stableJson({ a: { c: 2, d: 1 }, b: 1 }))
  })

  it('sees a roster change, a lineup change and a section move', () => {
    expect(importedPlayerDataEquivalent(base, { ...base, players: ['a', 'b', 'c'] })).toBe(false)
    expect(importedPlayerDataEquivalent(base, { ...base, starters: ['b'] })).toBe(false)
    expect(importedPlayerDataEquivalent(base, {
      ...base, lineup_sections: { ...base.lineup_sections, bench: [], ir: ['b'] },
    })).toBe(false)
  })

  it('treats array order as data', () => {
    expect(importedPlayerDataEquivalent(base, { ...base, players: ['b', 'a'] })).toBe(false)
  })

  it('compares owner key, FAAB and waiver priority too', () => {
    const stored = { platformUserId: 'mgr', playerData: base, faabRemaining: 100, waiverPriority: 3 }
    expect(importedRosterUnchanged(stored, { ...stored, playerData: { ...base, imported_at: 'x' } })).toBe(true)
    expect(importedRosterUnchanged(stored, { ...stored, platformUserId: 'mgr-2' })).toBe(false)
    expect(importedRosterUnchanged(stored, { ...stored, faabRemaining: 90 })).toBe(false)
    expect(importedRosterUnchanged(stored, { ...stored, waiverPriority: 1 })).toBe(false)
    expect(importedRosterUnchanged({ ...stored, faabRemaining: null }, { ...stored, faabRemaining: null })).toBe(true)
  })

  it('treats a key another writer added as a change, as the unconditional write did', () => {
    expect(importedPlayerDataEquivalent({ ...base, co_owners: ['x'] }, base)).toBe(false)
  })
})

describe('AF_CHANGE_AWARE_WRITES_OFF parsing', () => {
  it('is ON for every writer when unset or blank', () => {
    for (const w of ['weekly-scores', 'team-performances', 'rosters', 'matchups'] as const) {
      expect(changeAwareWritesEnabled(w, {})).toBe(true)
      expect(changeAwareWritesEnabled(w, { AF_CHANGE_AWARE_WRITES_OFF: '  ' })).toBe(true)
    }
  })
  it('turns off only the named writers, case- and spacing-insensitively', () => {
    const env = { AF_CHANGE_AWARE_WRITES_OFF: ' Rosters , MATCHUPS ' }
    expect(changeAwareWritesEnabled('rosters', env)).toBe(false)
    expect(changeAwareWritesEnabled('matchups', env)).toBe(false)
    expect(changeAwareWritesEnabled('weekly-scores', env)).toBe(true)
  })
  it('"all" turns every writer off', () => {
    expect(changeAwareWritesEnabled('team-performances', { AF_CHANGE_AWARE_WRITES_OFF: 'all' })).toBe(false)
  })
})
