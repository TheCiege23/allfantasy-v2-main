import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => {
  const state = {
    audit: [] as Array<Record<string, unknown>>,
    rosters: [] as Array<{ id: string; leagueId: string; faabRemaining: number | null; waiverPriority: number | null }>,
    standings: [] as Array<Record<string, unknown> & { id: string; leagueId: string; updatedAt: Date }>,
    runs: [] as Array<{ leagueId: string; runAt: Date }>,
  }
  const prisma = {
    leagueAuditLog: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.audit.find((a) => Object.entries(where).every(([k, v]) => a[k] === v)) ?? null),
    },
    waiverRun: {
      findFirst: vi.fn(async ({ where }: { where: { leagueId: string; runAt: { gt: Date } } }) =>
        state.runs.find((r) => r.leagueId === where.leagueId && r.runAt > where.runAt.gt) ?? null),
    },
    roster: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; leagueId: string } }) => state.rosters.find((r) => r.id === where.id && r.leagueId === where.leagueId) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = state.rosters.filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
        for (const r of hit) Object.assign(r, data)
        return { count: hit.length }
      }),
    },
    fantasyStanding: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; leagueId: string } }) => state.standings.find((s) => s.id === where.id && s.leagueId === where.leagueId) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; leagueId: string; updatedAt: Date }; data: Record<string, unknown> }) => {
        const hit = state.standings.filter((s) => s.id === where.id && s.leagueId === where.leagueId && s.updatedAt.getTime() === where.updatedAt.getTime())
        for (const s of hit) Object.assign(s, data, { updatedAt: new Date() })
        return { count: hit.length }
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string; leagueId: string; updatedAt: Date } }) => {
        const before = state.standings.length
        state.standings = state.standings.filter((s) => !(s.id === where.id && s.leagueId === where.leagueId && s.updatedAt.getTime() === where.updatedAt.getTime()))
        return { count: before - state.standings.length }
      }),
    },
  }
  return { state, prisma }
})
const elevated = vi.hoisted(() => vi.fn(async () => true))
const gate = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
const logAction = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => { db.state.audit.push({ id: `log-${db.state.audit.length}`, ...input }); return { id: 'x' } }))
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: elevated }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: gate }))
vi.mock('@/server/services/auditService', () => ({ logAction }))

import { readUndoStatus, undoCommissionerAction } from '@/lib/commissioner-undo/commissionerUndoService'

const AT = new Date('2026-10-25T12:00:00.000Z')
const NOW = AT.getTime() + 60_000
const EDITED = new Date('2026-10-25T11:59:59.500Z')

const faabEdit = { id: 'a1', leagueId: 'L', actionType: 'commissioner_edit_faab', entityId: 'r1', beforeState: { id: 'r1', faabRemaining: 100 }, afterState: { faabRemaining: 60 }, createdAt: AT }
const standingsEdit = {
  id: 'a2', leagueId: 'L', actionType: 'commissioner_edit_standings', entityId: 's1',
  beforeState: { id: 's1', wins: 4, losses: 3, ties: 0, pointsFor: 690, pointsAgainst: 660 },
  afterState: { id: 's1', wins: 5, losses: 2, ties: 0, pointsFor: 700, pointsAgainst: 650, updatedAt: EDITED.toISOString() },
  createdAt: AT,
}

beforeEach(() => {
  vi.clearAllMocks()
  elevated.mockResolvedValue(true)
  gate.mockResolvedValue({ ok: true })
  db.state.audit = [{ ...faabEdit }, { ...standingsEdit }]
  db.state.rosters = [{ id: 'r1', leagueId: 'L', faabRemaining: 60, waiverPriority: 4 }]
  db.state.standings = [{ id: 's1', leagueId: 'L', wins: 5, losses: 2, ties: 0, pointsFor: 700, pointsAgainst: 650, updatedAt: EDITED }]
  db.state.runs = []
})

describe('undoCommissionerAction', () => {
  it('puts the FAAB back, logs the undo against the original row, and refuses a second undo', async () => {
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toEqual({ ok: true, actionType: 'commissioner_edit_faab' })
    expect(db.state.rosters[0].faabRemaining).toBe(100)
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'commissioner_undo', entityType: 'audit_log', entityId: 'a1', userId: 'c1',
      beforeState: { faabRemaining: 60 }, afterState: { id: 'r1', faabRemaining: 100 },
      metadata: { undoneActionType: 'commissioner_edit_faab', rosterId: 'r1' },
    }))
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toMatchObject({ ok: false, error: 'already_undone', status: 409 })
  })

  it('refuses after a waiver run, and when a claim already spent the FAAB', async () => {
    db.state.runs = [{ leagueId: 'L', runAt: new Date(AT.getTime() + 1000) }]
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toMatchObject({ ok: false, error: 'waiver_run_since' })
    db.state.runs = [{ leagueId: 'L', runAt: new Date(AT.getTime() - 1000) }]
    db.state.rosters[0].faabRemaining = 45
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toMatchObject({ ok: false, error: 'changed_since' })
    expect(db.state.rosters[0].faabRemaining).toBe(45)
    expect(logAction).not.toHaveBeenCalled()
  })

  it('does not overwrite a value that moves between the check and the write', async () => {
    db.prisma.roster.findFirst.mockResolvedValueOnce({ id: 'r1', leagueId: 'L', faabRemaining: 60, waiverPriority: 4 })
    db.state.rosters[0].faabRemaining = 30 // a claim lands after the check read 60
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toMatchObject({ ok: false, error: 'changed_since' })
    expect(db.state.rosters[0].faabRemaining).toBe(30)
    expect(logAction).not.toHaveBeenCalled()
  })

  it('restores a standings row, and removes one the edit created', async () => {
    expect(await undoCommissionerAction('L', 'c1', 'a2', NOW)).toMatchObject({ ok: true })
    expect(db.state.standings[0]).toMatchObject({ wins: 4, losses: 3, pointsFor: 690, pointsAgainst: 660 })

    db.state.audit = [{ ...standingsEdit, beforeState: null }]
    db.state.standings = [{ id: 's1', leagueId: 'L', wins: 5, losses: 2, ties: 0, pointsFor: 700, pointsAgainst: 650, updatedAt: EDITED }]
    expect(await undoCommissionerAction('L', 'c1', 'a2', NOW)).toMatchObject({ ok: true })
    expect(db.state.standings).toHaveLength(0)
  })

  it('refuses standings once a recompute rewrote the row', async () => {
    db.state.standings[0].updatedAt = new Date(AT.getTime() + 5000)
    expect(await undoCommissionerAction('L', 'c1', 'a2', NOW)).toMatchObject({ ok: false, error: 'changed_since' })
    expect(db.state.standings[0].wins).toBe(5)
  })

  it('is for commissioners and co-commissioners only, and respects the league lifecycle gate', async () => {
    elevated.mockResolvedValueOnce(false)
    expect(await undoCommissionerAction('L', 'm1', 'a1', NOW)).toMatchObject({ ok: false, error: 'forbidden', status: 403 })
    gate.mockResolvedValueOnce({ ok: false, err: { status: 409, error: 'League is archived' } })
    expect(await undoCommissionerAction('L', 'c1', 'a1', NOW)).toMatchObject({ ok: false, status: 409, message: 'League is archived' })
    expect(db.state.rosters[0].faabRemaining).toBe(60)
  })

  it('cannot reach another league’s row', async () => {
    expect(await undoCommissionerAction('OTHER', 'c1', 'a1', NOW)).toMatchObject({ ok: false, error: 'not_found', status: 404 })
  })
})

describe('readUndoStatus', () => {
  it('reports each undoable row and leaves other actions out', async () => {
    const rows = [faabEdit, standingsEdit, { ...faabEdit, id: 'a3', actionType: 'settings_patch' }]
    db.state.rosters[0].faabRemaining = 45
    const status = await readUndoStatus('L', rows, NOW)
    expect([...status.keys()]).toEqual(['a1', 'a2'])
    expect(status.get('a1')).toEqual({ available: false, reason: 'changed_since' })
    expect(status.get('a2')).toEqual({ available: true, reason: null })
  })
})
