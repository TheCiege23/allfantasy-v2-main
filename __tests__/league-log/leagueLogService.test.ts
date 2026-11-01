import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  membership: vi.fn(),
  role: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    leagueAuditLog: { findMany: vi.fn() },
    appUser: { findMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
    roster: { findMany: vi.fn() },
    leagueTeam: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: m.membership }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
const undoStatus = vi.hoisted(() => vi.fn(async () => new Map()))
vi.mock('@/lib/commissioner-undo/commissionerUndoService', () => ({ readUndoStatus: undoStatus }))

import { readLeagueLog } from '@/lib/league-log/leagueLogService'
import { MEMBER_LOG_ACTION_TYPES } from '@/lib/league-log/leagueLog'

const ROWS = [
  {
    id: 'r-2', actionType: 'commissioner_edit_faab', entityId: 'ros-1', userId: 'c1',
    beforeState: { faabRemaining: 100 }, afterState: { faabRemaining: 60 }, metadata: null, createdAt: new Date('2026-10-21T00:00:00Z'),
  },
  {
    id: 'r-1', actionType: 'score_adjustment_added', entityId: 'adj', userId: 'c1',
    beforeState: null, afterState: { points: 3, reason: 'Stat fix' }, metadata: { rosterId: 'rr-1', week: 4 }, createdAt: new Date('2026-10-20T00:00:00Z'),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.membership.mockResolvedValue({ ok: true, access: { isMember: true } })
  m.role.mockResolvedValue('member')
  m.prisma.league.findUnique.mockResolvedValue({ settings: {} })
  m.prisma.leagueAuditLog.findMany.mockResolvedValue(ROWS)
  m.prisma.appUser.findMany.mockResolvedValue([{ id: 'c1', displayName: 'Coach Dee', username: 'dee' }])
  m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'rr-1', teamName: 'Taco Tuesday', ownerName: 'Sam' }])
  // A `Roster` with no redraft link is named through its league team.
  m.prisma.roster.findMany.mockResolvedValue([{ id: 'ros-1', platformUserId: 'p-7', redraftRoster: null }])
  m.prisma.leagueTeam.findMany.mockResolvedValue([{ platformUserId: 'p-7', teamName: 'Gridiron Goats', ownerName: 'Jo' }])
  undoStatus.mockResolvedValue(new Map())
})

describe('readLeagueLog', () => {
  it('refuses someone outside the league with the membership status', async () => {
    m.membership.mockResolvedValue({ ok: false, status: 403 })
    expect(await readLeagueLog('L', 'x')).toEqual({ ok: false, status: 403 })
    expect(m.prisma.leagueAuditLog.findMany).not.toHaveBeenCalled()
  })

  it('a member asks only for member-visible types and gets sentences without raw rows', async () => {
    const res = await readLeagueLog('L', 'm1')
    const where = m.prisma.leagueAuditLog.findMany.mock.calls[0][0].where
    expect(where).toEqual({ leagueId: 'L', actionType: { in: [...MEMBER_LOG_ACTION_TYPES] } })
    expect(res).toMatchObject({ ok: true, canManage: false, visibility: 'league', hidden: false })
    if (!res.ok) throw new Error('expected ok')
    expect(res.entries.map((e) => e.title)).toEqual([
      "Set Gridiron Goats's FAAB to $60",
      "Adjusted Taco Tuesday's score by +3 in week 4",
    ])
    expect(res.entries.every((e) => e.raw === undefined)).toBe(true)
  })

  it('a member of a commish-only league sees that it is hidden, and nothing is read', async () => {
    m.prisma.league.findUnique.mockResolvedValue({ settings: { league_log_visibility: 'commish_only' } })
    const res = await readLeagueLog('L', 'm1')
    expect(res).toEqual({ ok: true, canManage: false, visibility: 'commish_only', hidden: true, entries: [], nextCursor: null })
    expect(m.prisma.leagueAuditLog.findMany).not.toHaveBeenCalled()
  })

  it('a commissioner reads every type, even when the log is commish only, with raw rows', async () => {
    m.role.mockResolvedValue('co_commissioner')
    m.prisma.league.findUnique.mockResolvedValue({ settings: { league_log_visibility: 'commish_only' } })
    const res = await readLeagueLog('L', 'c1')
    expect(m.prisma.leagueAuditLog.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.canManage).toBe(true)
    expect(res.hidden).toBe(false)
    expect(res.entries[0].raw?.beforeState).toEqual({ faabRemaining: 100 })
  })

  it('tells a commissioner which recent edits can still be undone, and why not', async () => {
    m.role.mockResolvedValue('commissioner')
    undoStatus.mockResolvedValue(new Map([['r-2', { available: false, reason: 'waiver_run_since' }]]))
    const res = await readLeagueLog('L', 'c1')
    if (!res.ok) throw new Error('expected ok')
    expect(undoStatus).toHaveBeenCalledWith('L', ROWS)
    expect(res.entries[0].undo).toEqual({ available: false, reason: 'Waivers have run since, and they used this value.' })
    expect(res.entries[1].undo).toBeUndefined()
  })

  it('never looks up undo for a member', async () => {
    const res = await readLeagueLog('L', 'm1')
    if (!res.ok) throw new Error('expected ok')
    expect(undoStatus).not.toHaveBeenCalled()
    expect(res.entries.every((e) => e.undo === undefined)).toBe(true)
  })

  it('a category narrows the query to that category, inside the member list', async () => {
    await readLeagueLog('L', 'm1', { category: 'scoring' })
    const types: string[] = m.prisma.leagueAuditLog.findMany.mock.calls[0][0].where.actionType.in
    expect(types).toContain('score_adjustment_added')
    expect(types).not.toContain('commissioner_edit_faab')
    expect(types.every((t) => MEMBER_LOG_ACTION_TYPES.includes(t))).toBe(true)
  })

  it('pages by cursor and reports the next one only when there is more', async () => {
    const res = await readLeagueLog('L', 'm1', { limit: 1, cursor: 'r-9' })
    const args = m.prisma.leagueAuditLog.findMany.mock.calls[0][0]
    expect(args).toMatchObject({ take: 2, cursor: { id: 'r-9' }, skip: 1 })
    if (!res.ok) throw new Error('expected ok')
    expect(res.entries).toHaveLength(1)
    expect(res.nextCursor).toBe('r-2')

    m.prisma.leagueAuditLog.findMany.mockResolvedValue(ROWS.slice(0, 1))
    const last = await readLeagueLog('L', 'm1', { limit: 1 })
    if (!last.ok) throw new Error('expected ok')
    expect(last.nextCursor).toBeNull()
  })
})
