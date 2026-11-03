// @vitest-environment node
/**
 * PATCH /api/devy — the commissioner editor for a league's older `DevyLeague` record.
 * Allowlist + ranges, the live-state locks, the league chat notice, and the routes it sits beside.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  commissioner: vi.fn(),
  member: vi.fn(),
  notify: vi.fn(),
  state: { startupStarted: false, running: false },
  db: {
    devyLeague: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    devyTaxiSlot: { findMany: vi.fn() },
    devyDevySlot: { findMany: vi.fn() },
    devyPlayerState: { findMany: vi.fn() },
    devyDraftPick: { findMany: vi.fn() },
    draftSession: { count: vi.fn() },
    league: { findUnique: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: m.commissioner, assertLeagueMember: m.member }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: m.notify }))

import { GET, PATCH } from '@/app/api/devy/route'

const BASE = {
  id: 'dl1',
  leagueId: 'L1',
  isDynastyOnly: true,
  createdByTheCiege: true,
  startupDraftFormat: 'combined',
  futureDraftFormat: 'combined',
  activeRosterSize: 20,
  benchSlots: 6,
  irSlots: 2,
  taxiSlots: 5,
  devySlots: 10,
  maxDevyPerTeam: 10,
  taxiRookieOnly: true,
  taxiAllowNonRookies: false,
  taxiMaxExperienceYears: 1,
  taxiLockDeadline: null as Date | null,
  devyGradBehavior: 'move_to_taxi',
  rookiePickTradingEnabled: true,
  devyPickTradingEnabled: true,
  season: 2026,
}

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/devy', { method: 'PATCH', body: JSON.stringify(body) }))

const rows = (perRoster: Record<string, number>, extra: Record<string, unknown> = {}) =>
  Object.entries(perRoster).flatMap(([rosterId, n]) => Array.from({ length: n }, () => ({ rosterId, ...extra })))

beforeEach(() => {
  vi.clearAllMocks()
  m.state.startupStarted = false
  m.state.running = false
  m.session.mockResolvedValue({ user: { id: 'comm' } })
  m.commissioner.mockResolvedValue({ ok: true, league: { id: 'L1', settings: {} } })
  m.member.mockResolvedValue({ ok: true, league: { id: 'L1', settings: {} } })
  m.notify.mockResolvedValue(undefined)
  m.db.devyLeague.findUnique.mockResolvedValue({ ...BASE })
  m.db.devyLeague.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...BASE, ...data }))
  m.db.devyTaxiSlot.findMany.mockResolvedValue([])
  m.db.devyDevySlot.findMany.mockResolvedValue([])
  m.db.devyPlayerState.findMany.mockResolvedValue([])
  m.db.devyDraftPick.findMany.mockResolvedValue([])
  m.db.draftSession.count.mockImplementation(async ({ where }: { where: { OR?: unknown; status?: { in: string[] } } }) => {
    if (where.OR) return m.state.startupStarted ? 1 : 0
    return m.state.running ? 1 : 0
  })
})

describe('PATCH /api/devy — who may edit', () => {
  it('401 without a session', async () => {
    m.session.mockResolvedValue(null)
    expect((await patch({ leagueId: 'L1', taxiSlots: 4 })).status).toBe(401)
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
  })

  it('403 for a member who is not the commissioner, and nothing is written', async () => {
    m.commissioner.mockResolvedValue({ ok: false, status: 403 })
    const res = await patch({ leagueId: 'L1', taxiSlots: 4 })
    expect(res.status).toBe(403)
    expect(m.commissioner).toHaveBeenCalledWith('L1', 'comm')
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('404 when the league has no older Devy record', async () => {
    m.db.devyLeague.findUnique.mockResolvedValue(null)
    expect((await patch({ leagueId: 'L1', taxiSlots: 4 })).status).toBe(404)
  })

  it('400 without a leagueId', async () => {
    expect((await patch({ taxiSlots: 4 })).status).toBe(400)
  })
})

describe('PATCH /api/devy — allowlist and ranges', () => {
  it('400 lists every unknown field by name and writes nothing', async () => {
    const res = await patch({ leagueId: 'L1', taxiSlots: 4, superflex: true, draftClockSeconds: 90 })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('UNKNOWN_FIELDS')
    expect(j.unknown).toEqual(['superflex', 'draftClockSeconds'])
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
  })

  it('409 for season, createdByTheCiege and ids, each with its reason', async () => {
    const res = await patch({ leagueId: 'L1', season: 2025, createdByTheCiege: false, id: 'x', taxiPointsCountToward: true })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.code).toBe('FIELD_LOCKED')
    expect(j.locked.map((l: { field: string }) => l.field)).toEqual(['season', 'createdByTheCiege', 'id', 'taxiPointsCountToward'])
    for (const l of j.locked) expect(l.reason.length).toBeGreaterThan(10)
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
  })

  it.each([
    ['taxiSlots', 21],
    ['taxiSlots', -1],
    ['activeRosterSize', 0],
    ['irSlots', 1.5],
    ['taxiMaxExperienceYears', 6],
    ['startupDraftFormat', 'snake'],
    ['futureDraftFormat', 'split_vets_first'],
    ['devyGradBehavior', 'release'],
    ['taxiRookieOnly', 'yes'],
    ['taxiLockDeadline', 'not a date'],
  ])('400 for %s = %j', async (field, value) => {
    const res = await patch({ leagueId: 'L1', [field]: value })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('INVALID_FIELDS')
    expect(j.invalid[0].field).toBe(field)
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
  })

  it('accepts the edges of each range', async () => {
    const res = await patch({ leagueId: 'L1', taxiSlots: 20, irSlots: 0, taxiMaxExperienceYears: 5 })
    expect(res.status).toBe(200)
    expect(m.db.devyLeague.update.mock.calls[0][0].data).toEqual({ taxiSlots: 20, irSlots: 0, taxiMaxExperienceYears: 5 })
  })

  it('stores a taxi deadline as a Date and clears it with null', async () => {
    await patch({ leagueId: 'L1', taxiLockDeadline: '2026-09-01T16:00:00.000Z' })
    const d = m.db.devyLeague.update.mock.calls[0][0].data.taxiLockDeadline
    expect(d).toBeInstanceOf(Date)
    expect(d.toISOString()).toBe('2026-09-01T16:00:00.000Z')
    m.db.devyLeague.findUnique.mockResolvedValue({ ...BASE, taxiLockDeadline: new Date('2026-09-01T16:00:00.000Z') })
    await patch({ leagueId: 'L1', taxiLockDeadline: null })
    expect(m.db.devyLeague.update.mock.calls[1][0].data).toEqual({ taxiLockDeadline: null })
  })
})

describe('PATCH /api/devy — slot counts never drop below what a team holds', () => {
  it('taxi: the team holding the most decides (two teams, 3 and 1)', async () => {
    m.db.devyTaxiSlot.findMany.mockResolvedValue(rows({ r1: 3, r2: 1 }))
    const bad = await patch({ leagueId: 'L1', taxiSlots: 2 })
    expect(bad.status).toBe(409)
    const j = await bad.json()
    expect(j.code).toBe('SLOT_BELOW_HELD')
    expect(j.conflicts).toEqual([{ field: 'taxiSlots', held: 3, requested: 2 }])
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
    expect((await patch({ leagueId: 'L1', taxiSlots: 3 })).status).toBe(200)
  })

  it('devy slots and max devy per team both check devy_devy_slots', async () => {
    m.db.devyDevySlot.findMany.mockResolvedValue(rows({ r1: 4, r2: 6 }))
    const res = await patch({ leagueId: 'L1', devySlots: 5, maxDevyPerTeam: 5 })
    expect(res.status).toBe(409)
    expect((await res.json()).conflicts.map((c: { field: string }) => c.field)).toEqual(['devySlots', 'maxDevyPerTeam'])
    expect((await patch({ leagueId: 'L1', devySlots: 6 })).status).toBe(200)
  })

  it('active + bench + IR together against the active buckets, as assertActiveCapacity counts them', async () => {
    m.db.devyPlayerState.findMany.mockResolvedValue([
      ...rows({ r1: 25 }, { bucketState: 'active_starter' }),
      ...rows({ r1: 2 }, { bucketState: 'ir' }),
      // taxi and devy rows are not active capacity
      ...rows({ r1: 9 }, { bucketState: 'taxi' }),
      ...rows({ r2: 10 }, { bucketState: 'active_bench' }),
    ])
    const bad = await patch({ leagueId: 'L1', benchSlots: 4 }) // 20 + 4 + 2 = 26 < 27
    expect(bad.status).toBe(409)
    expect((await bad.json()).conflicts).toEqual([{ field: 'activeCapacity', held: 27, requested: 26 }])
    expect((await patch({ leagueId: 'L1', benchSlots: 5 })).status).toBe(200) // 27
  })

  it('raising a count never needs the holdings and is not blocked by them', async () => {
    m.db.devyTaxiSlot.findMany.mockResolvedValue(rows({ r1: 5 }))
    expect((await patch({ leagueId: 'L1', taxiSlots: 8 })).status).toBe(200)
  })
})

describe('PATCH /api/devy — draft formats', () => {
  it('startup format is frozen once a live draft has started', async () => {
    m.state.startupStarted = true
    const res = await patch({ leagueId: 'L1', startupDraftFormat: 'split_devy_first' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DRAFT_STARTED')
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
    const where = m.db.draftSession.count.mock.calls[0][0].where
    expect(where.sessionKind).toBe('live')
  })

  it('startup format changes before any draft starts', async () => {
    const res = await patch({ leagueId: 'L1', startupDraftFormat: 'split_devy_first' })
    expect(res.status).toBe(200)
    expect((await res.json()).config.startupDraftFormat).toBe('split_devy_first')
  })

  it('future format is frozen while a draft runs', async () => {
    m.state.running = true
    const res = await patch({ leagueId: 'L1', futureDraftFormat: 'separate' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DRAFT_IN_PROGRESS')
  })

  it('future format is frozen while a season’s picks are part used', async () => {
    m.db.devyDraftPick.findMany.mockResolvedValue([
      { season: 2026, isUsed: true },
      { season: 2026, isUsed: false },
    ])
    expect((await patch({ leagueId: 'L1', futureDraftFormat: 'separate' })).status).toBe(409)
    // A season that is entirely used (finished) or entirely open does not lock it.
    m.db.devyDraftPick.findMany.mockResolvedValue([
      { season: 2026, isUsed: true },
      { season: 2027, isUsed: false },
    ])
    expect((await patch({ leagueId: 'L1', futureDraftFormat: 'separate' })).status).toBe(200)
  })

  it('re-sending the current format is not a change, so no lock applies', async () => {
    m.state.startupStarted = true
    const res = await patch({ leagueId: 'L1', startupDraftFormat: 'combined' })
    expect(res.status).toBe(200)
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/devy — result and league chat', () => {
  it('returns the updated record and posts one notice listing old → new', async () => {
    const res = await patch({ leagueId: 'L1', taxiSlots: 6, devyGradBehavior: 'commissioner_review', taxiRookieOnly: false })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.config).toMatchObject({ taxiSlots: 6, devyGradBehavior: 'commissioner_review', taxiRookieOnly: false, season: 2026 })
    expect(j.changed).toEqual(['taxiSlots', 'devyGradBehavior', 'taxiRookieOnly'])
    expect(m.notify).toHaveBeenCalledTimes(1)
    const [leagueId, userId, category, changes] = m.notify.mock.calls[0]
    expect([leagueId, userId, category]).toEqual(['L1', 'comm', 'Devy Settings'])
    expect(changes).toEqual([
      { field: 'Taxi slots', oldValue: '5', newValue: '6' },
      { field: 'When a devy player enters the NFL', oldValue: 'move_to_taxi', newValue: 'commissioner_review' },
      { field: 'Rookie-only taxi', oldValue: 'on', newValue: 'off' },
    ])
  })

  it('an unchanged value writes nothing and posts nothing', async () => {
    const res = await patch({ leagueId: 'L1', taxiSlots: 5 })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toEqual([])
    expect(m.db.devyLeague.update).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('a failed chat notice does not fail the save', async () => {
    m.notify.mockRejectedValue(new Error('chat down'))
    expect((await patch({ leagueId: 'L1', taxiSlots: 6 })).status).toBe(200)
  })
})

describe('the routes beside it are unchanged', () => {
  it('GET still returns { config } to any member', async () => {
    const res = await GET(new NextRequest('http://localhost/api/devy?leagueId=L1'))
    expect(res.status).toBe(200)
    expect((await res.json()).config).toMatchObject({ leagueId: 'L1', taxiSlots: 5 })
    expect(m.commissioner).not.toHaveBeenCalled()
  })
})
