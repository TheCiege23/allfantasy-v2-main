import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 2026-11-24 audit fixes:
 *  - a league member could move players on ANY team through the C2C and devy roster routes;
 *  - a C2C league made in the create wizard (C2CLeagueConfig, no legacy C2CLeague row) answered
 *    "C2C not configured" in chat, Chimmy and the status chips.
 */

const { db, resolveActingRoster, commissionerAccess, getC2CConfig, movePlayer, canMove } = vi.hoisted(() => ({
  db: {
    c2CLeague: { findUnique: vi.fn() },
    league: { findUnique: vi.fn() },
  },
  resolveActingRoster: vi.fn(),
  commissionerAccess: vi.fn(),
  getC2CConfig: vi.fn(),
  movePlayer: vi.fn(),
  canMove: { value: true },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db, default: db }))
vi.mock('@/lib/league/viewerTeams', () => ({ resolveActingRoster }))
vi.mock('@/lib/league/commissionerAccess', () => ({ commissionerAccess }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig }))

import { canMoveRosterPlayers } from '@/lib/league/rosterMoveAccess'
import { loadC2CLeagueSettings, nativeScoringMode } from '@/lib/c2c/c2cLeagueSettings'

beforeEach(() => {
  vi.clearAllMocks()
  canMove.value = true
})

describe('canMoveRosterPlayers', () => {
  it('allows the manager who runs the team', async () => {
    resolveActingRoster.mockResolvedValue({ ok: true, rosterId: 'R1' })
    await expect(canMoveRosterPlayers('L1', 'u1', 'R1')).resolves.toBe(true)
    expect(commissionerAccess).not.toHaveBeenCalled()
  })

  it('refuses another manager’s team', async () => {
    resolveActingRoster.mockResolvedValue({ ok: false, code: 'NOT_YOUR_TEAM', status: 403, message: 'no', rosterIds: ['R2'] })
    commissionerAccess.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    await expect(canMoveRosterPlayers('L1', 'u1', 'R1')).resolves.toBe(false)
    expect(commissionerAccess).toHaveBeenCalledWith('L1', 'u1', 'rosters')
  })

  it('allows a commissioner with roster rights to move any team', async () => {
    resolveActingRoster.mockResolvedValue({ ok: false, code: 'NO_TEAM', status: 403, message: 'no', rosterIds: [] })
    commissionerAccess.mockResolvedValue({ ok: true, role: 'head', scopes: [] })
    await expect(canMoveRosterPlayers('L1', 'u1', 'R9')).resolves.toBe(true)
  })

  it('refuses when the acting team resolves to a different roster', async () => {
    resolveActingRoster.mockResolvedValue({ ok: true, rosterId: 'R2' })
    commissionerAccess.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    await expect(canMoveRosterPlayers('L1', 'u1', 'R1')).resolves.toBe(false)
  })
})

describe('loadC2CLeagueSettings', () => {
  it('returns the legacy row when one exists', async () => {
    db.c2CLeague.findUnique.mockResolvedValue({
      sportPair: 'NFL_CFB', scoringMode: 'weighted_combined', campusScoreWeight: 0.4, cantonScoreWeight: 0.6,
      campusStarterSlots: 8, cantonStarterSlots: 8, benchSlots: 8, taxiSlots: 4, devySlots: 6, irSlots: 2,
      devyScoringEnabled: false, startupDraftFormat: 'split_campus_canton', futureDraftFormat: 'combined',
      taxiRookieOnly: true, taxiMaxExperienceYears: 1, taxiLockDeadline: null, taxiPointsVisible: true,
      basketballLineupFreq: 'weekly', season: 2026,
    })
    const s = await loadC2CLeagueSettings('L1')
    expect(s?.source).toBe('legacy')
    expect(s?.scoringMode).toBe('weighted_combined')
    expect(getC2CConfig).not.toHaveBeenCalled()
  })

  it('answers a native league from its C2CLeagueConfig', async () => {
    db.c2CLeague.findUnique.mockResolvedValue(null)
    db.league.findUnique.mockResolvedValue({ season: 2026 })
    getC2CConfig.mockResolvedValue({
      sport: 'NFL', standingsModel: 'unified', hybridProWeight: 60,
      collegeActiveLineupSlots: { QB: 1, RB: 2, WR: 2, FLEX: 1 }, proLineupSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 3, SUPER_FLEX: 1 },
      proBenchSize: 25, taxiSize: 15, collegeRosterSize: 20, proIRSize: 4, startupFormat: 'separate', mergedRookieCollegeDraft: false,
    })
    const s = await loadC2CLeagueSettings('L1')
    expect(s).toMatchObject({
      source: 'native', sportPair: 'NFL_CFB', scoringMode: 'combined_total',
      campusStarterSlots: 6, cantonStarterSlots: 10, benchSlots: 25, taxiSlots: 15, devySlots: 20, irSlots: 4,
      startupDraftFormat: 'split_campus_canton', season: 2026,
    })
    expect(s?.cantonScoreWeight).toBeCloseTo(0.6)
  })

  it('is null for a league that is neither', async () => {
    db.c2CLeague.findUnique.mockResolvedValue(null)
    getC2CConfig.mockResolvedValue(null)
    await expect(loadC2CLeagueSettings('L1')).resolves.toBeNull()
  })

  it('names native standings models in the C2C copy’s vocabulary', () => {
    expect(nativeScoringMode('unified')).toBe('combined_total')
    expect(nativeScoringMode('separate')).toBe('dual_track')
    expect(nativeScoringMode('hybrid')).toBe('weighted_combined')
    expect(nativeScoringMode(undefined)).toBe('combined_total')
  })
})

describe('C2C roster PATCH refuses another team', () => {
  it('returns 403 and never moves the player', async () => {
    vi.resetModules()
    vi.doMock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
    vi.doMock('@/lib/league/rosterMoveAccess', () => ({ canMoveRosterPlayers: vi.fn(async () => canMove.value) }))
    vi.doMock('@/lib/c2c/rosterEngine', () => ({ movePlayer }))
    vi.doMock('@/lib/c2c/playerWeekPoints', () => ({ c2cPlayerWeekPoints: vi.fn() }))
    const { PATCH } = await import('@/app/api/c2c/roster/route')
    const req = (body: unknown) => ({ json: async () => body }) as never

    canMove.value = false
    const refused = await PATCH(req({ leagueId: 'L1', rosterId: 'R2', playerId: 'p1', targetBucket: 'bench' }))
    expect(refused.status).toBe(403)
    expect(movePlayer).not.toHaveBeenCalled()

    canMove.value = true
    movePlayer.mockResolvedValue({ playerId: 'p1' })
    const allowed = await PATCH(req({ leagueId: 'L1', rosterId: 'R1', playerId: 'p1', targetBucket: 'bench' }))
    expect(allowed.status).toBe(200)
    expect(movePlayer).toHaveBeenCalledWith('L1', 'R1', 'p1', 'bench')
  })
})
