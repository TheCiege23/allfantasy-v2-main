// @vitest-environment node
/**
 * PATCH /api/c2c/settings — extended from `devyScoringEnabled` + `taxiLockMode` to the fields the
 * legacy C2C tabs show. Allowlist + ranges, weights that always sum to 1, slot and draft locks,
 * the league chat notice, and the two original callers still working the way they did.
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
    c2CLeague: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    c2CPlayerState: { findMany: vi.fn() },
    c2CDraftPick: { findMany: vi.fn() },
    draftSession: { count: vi.fn() },
    league: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: m.commissioner, assertLeagueMember: m.member }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: m.notify }))

import { PATCH } from '@/app/api/c2c/settings/route'
import { GET } from '@/app/api/c2c/route'

const BASE = {
  id: 'c1',
  leagueId: 'L1',
  isDynastyOnly: true,
  createdByTheCiege: true,
  sportPair: 'NFL_CFB',
  scoringMode: 'combined_total',
  campusScoreWeight: 0.4,
  cantonScoreWeight: 0.6,
  campusStarterSlots: 8,
  cantonStarterSlots: 8,
  benchSlots: 8,
  taxiSlots: 4,
  devySlots: 6,
  irSlots: 2,
  taxiRookieOnly: true,
  taxiMaxExperienceYears: 1,
  taxiLockDeadline: null,
  taxiPointsVisible: true,
  devyScoringEnabled: false,
  startupDraftFormat: 'split_campus_canton',
  futureDraftFormat: 'combined',
  footballCampusLockDay: 'saturday_kickoff',
  footballCantonLockDay: 'sunday_kickoff_per_player',
  basketballLineupFreq: 'weekly',
  season: 2026,
}

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/c2c/settings', { method: 'PATCH', body: JSON.stringify(body) }))

const states = (rosterId: string, n: number, bucketState: string, playerSide = 'campus') =>
  Array.from({ length: n }, () => ({ rosterId, bucketState, playerSide }))

beforeEach(() => {
  vi.clearAllMocks()
  m.state.startupStarted = false
  m.state.running = false
  m.session.mockResolvedValue({ user: { id: 'comm' } })
  m.commissioner.mockResolvedValue({ ok: true, league: { id: 'L1', settings: { other: 1 } } })
  m.member.mockResolvedValue({ ok: true, league: { id: 'L1', settings: { c2cTaxiLockMode: 'preseason' } } })
  m.notify.mockResolvedValue(undefined)
  m.db.c2CLeague.findUnique.mockResolvedValue({ ...BASE })
  m.db.c2CLeague.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...BASE, ...data }))
  m.db.c2CPlayerState.findMany.mockResolvedValue([])
  m.db.c2CDraftPick.findMany.mockResolvedValue([])
  m.db.league.update.mockResolvedValue({})
  m.db.draftSession.count.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => {
    if (where.OR) return m.state.startupStarted ? 1 : 0
    return m.state.running ? 1 : 0
  })
})

describe('PATCH /api/c2c/settings — who may edit', () => {
  it('401 without a session, 403 for a non-commissioner, 404 without a C2C record', async () => {
    m.session.mockResolvedValueOnce(null)
    expect((await patch({ leagueId: 'L1', benchSlots: 9 })).status).toBe(401)
    m.commissioner.mockResolvedValueOnce({ ok: false, status: 403 })
    expect((await patch({ leagueId: 'L1', benchSlots: 9 })).status).toBe(403)
    m.db.c2CLeague.findUnique.mockResolvedValueOnce(null)
    expect((await patch({ leagueId: 'L1', benchSlots: 9 })).status).toBe(404)
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
    expect(m.db.league.update).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/c2c/settings — allowlist and ranges', () => {
  it('400 lists unknown fields, including the fake controls the old panels showed', async () => {
    const res = await patch({ leagueId: 'L1', superflexCampus: true, statCorrectionHours: 24, pickClockSeconds: 90 })
    expect(res.status).toBe(400)
    const j = await res.json()
    expect(j.code).toBe('UNKNOWN_FIELDS')
    expect(j.unknown).toEqual(['superflexCampus', 'statCorrectionHours', 'pickClockSeconds'])
  })

  it('409 for sportPair, season, createdByTheCiege and ids', async () => {
    const res = await patch({ leagueId: 'L1', sportPair: 'NBA_CBB', season: 2025, createdByTheCiege: false, id: 'z' })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.code).toBe('FIELD_LOCKED')
    expect(j.locked.map((l: { field: string }) => l.field)).toEqual(['sportPair', 'season', 'createdByTheCiege', 'id'])
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
  })

  it.each([
    ['scoringMode', 'ppr'],
    ['campusScoreWeight', 0.8],
    ['campusScoreWeight', 0.2],
    ['campusStarterSlots', 0],
    ['benchSlots', 31],
    ['taxiLockMode', 'midseason'],
    ['startupDraftFormat', 'auction'],
    ['basketballLineupFreq', 'hourly'],
    ['devyScoringEnabled', 1],
  ])('400 for %s = %j', async (field, value) => {
    const res = await patch({ leagueId: 'L1', [field]: value })
    expect(res.status).toBe(400)
    expect((await res.json()).invalid[0].field).toBe(field)
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/c2c/settings — scoring weights', () => {
  it('campus weight alone sets canton to the rest', async () => {
    const res = await patch({ leagueId: 'L1', scoringMode: 'weighted_combined', campusScoreWeight: 0.55 })
    expect(res.status).toBe(200)
    expect(m.db.c2CLeague.update.mock.calls[0][0].data).toEqual({
      scoringMode: 'weighted_combined',
      campusScoreWeight: 0.55,
      cantonScoreWeight: 0.45,
    })
  })

  it('both weights must add up to 1', async () => {
    const res = await patch({ leagueId: 'L1', campusScoreWeight: 0.5, cantonScoreWeight: 0.6 })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_FIELDS')
    expect((await patch({ leagueId: 'L1', campusScoreWeight: 0.3, cantonScoreWeight: 0.7 })).status).toBe(200)
  })
})

describe('PATCH /api/c2c/settings — slot counts never drop below what a team holds', () => {
  it.each([
    ['campusStarterSlots', 'campus_starter', 'campus'],
    ['cantonStarterSlots', 'canton_starter', 'canton'],
    ['benchSlots', 'bench', 'canton'],
    ['taxiSlots', 'taxi', 'campus'],
    ['irSlots', 'ir', 'canton'],
  ])('%s against %s rows (two teams: 5 and 3)', async (field, bucket, side) => {
    m.db.c2CPlayerState.findMany.mockResolvedValue([...states('r1', 5, bucket, side), ...states('r2', 3, bucket, side)])
    const res = await patch({ leagueId: 'L1', [field]: 3 })
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.code).toBe('SLOT_BELOW_HELD')
    expect(j.conflicts).toEqual([{ field, held: 5, requested: 3 }])
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
    const ok = await patch({ leagueId: 'L1', [field]: 5 })
    expect(ok.status).toBe(200)
    expect(m.db.c2CLeague.update.mock.calls[0][0].data).toEqual({ [field]: 5 })
  })

  it('college slots count devy rows plus campus starters, as movePlayer does', async () => {
    m.db.c2CPlayerState.findMany.mockResolvedValue([
      ...states('r1', 3, 'devy'),
      ...states('r1', 2, 'campus_starter'),
      ...states('r1', 4, 'bench', 'canton'),
    ])
    const res = await patch({ leagueId: 'L1', devySlots: 4 })
    expect(res.status).toBe(409)
    expect((await res.json()).conflicts).toEqual([{ field: 'devySlots', held: 5, requested: 4 }])
    expect((await patch({ leagueId: 'L1', devySlots: 5 })).status).toBe(200)
  })
})

describe('PATCH /api/c2c/settings — draft formats', () => {
  it('startup format is frozen once a live draft has started', async () => {
    m.state.startupStarted = true
    const res = await patch({ leagueId: 'L1', startupDraftFormat: 'combined' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DRAFT_STARTED')
    m.state.startupStarted = false
    expect((await patch({ leagueId: 'L1', startupDraftFormat: 'combined' })).status).toBe(200)
  })

  it('future format is frozen while a draft runs or a season’s picks are part used', async () => {
    m.state.running = true
    expect((await patch({ leagueId: 'L1', futureDraftFormat: 'campus_first' })).status).toBe(409)
    m.state.running = false
    m.db.c2CDraftPick.findMany.mockResolvedValue([{ season: 2027, isUsed: true }, { season: 2027, isUsed: false }])
    const res = await patch({ leagueId: 'L1', futureDraftFormat: 'campus_first' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DRAFT_IN_PROGRESS')
    m.db.c2CDraftPick.findMany.mockResolvedValue([])
    expect((await patch({ leagueId: 'L1', futureDraftFormat: 'campus_first' })).status).toBe(200)
  })
})

describe('PATCH /api/c2c/settings — the two original callers', () => {
  it('devyScoringEnabled alone still saves (C2CDevyPanel) and returns the record', async () => {
    const res = await patch({ leagueId: 'L1', devyScoringEnabled: true })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.config).toMatchObject({ leagueId: 'L1', devyScoringEnabled: true })
    expect(j.c2c).toMatchObject({ devyScoringEnabled: true, taxiLockMode: 'no_limit' })
    expect(m.db.league.update).not.toHaveBeenCalled()
  })

  it('taxiLockMode alone still goes to League.settings and keeps the other settings', async () => {
    const res = await patch({ leagueId: 'L1', taxiLockMode: 'start_of_season' })
    expect(res.status).toBe(200)
    expect(m.db.league.update).toHaveBeenCalledWith({
      where: { id: 'L1' },
      data: { settings: { other: 1, c2cTaxiLockMode: 'start_of_season' } },
    })
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
    const j = await res.json()
    expect(j.taxiLockMode).toBe('start_of_season')
    expect(j.c2c.taxiLockMode).toBe('start_of_season')
  })
})

describe('PATCH /api/c2c/settings — league chat', () => {
  it('posts one notice with every change, the taxi lock included', async () => {
    await patch({ leagueId: 'L1', benchSlots: 10, taxiLockMode: 'preseason', taxiRookieOnly: false })
    expect(m.notify).toHaveBeenCalledTimes(1)
    const [leagueId, userId, category, changes] = m.notify.mock.calls[0]
    expect([leagueId, userId, category]).toEqual(['L1', 'comm', 'C2C Settings'])
    expect(changes).toEqual([
      { field: 'Bench slots', oldValue: '8', newValue: '10' },
      { field: 'Rookie-only taxi', oldValue: 'on', newValue: 'off' },
      { field: 'Taxi lock', oldValue: 'no_limit', newValue: 'preseason' },
    ])
  })

  it('nothing changed: no write, no notice', async () => {
    const res = await patch({ leagueId: 'L1', benchSlots: 8, taxiLockMode: 'no_limit' })
    expect(res.status).toBe(200)
    expect(m.db.c2CLeague.update).not.toHaveBeenCalled()
    expect(m.db.league.update).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
  })
})

describe('GET /api/c2c', () => {
  it('adds the taxi lock mode from League.settings to the record', async () => {
    const res = await GET(new NextRequest('http://localhost/api/c2c?leagueId=L1'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.c2c).toMatchObject({ leagueId: 'L1', benchSlots: 8, taxiLockMode: 'preseason' })
  })
})
