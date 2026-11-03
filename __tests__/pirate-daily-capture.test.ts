import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capturePirateLineupEvidence, evaluatePirateEvidencePair } from '@/lib/pirate/lineupEvidence'
const h = vi.hoisted(() => ({ schedule: vi.fn(), teams: vi.fn(), template: vi.fn(), preview: vi.fn(), pool: vi.fn(), certify: vi.fn() }))
vi.mock('@/lib/redraft/lineupLock', async (original) => ({ ...await original<typeof import('@/lib/redraft/lineupLock')>(), buildWeekKickoffMap: h.schedule }))
vi.mock('@/lib/redraft/lineupLockCurrentTeam', () => ({ resolveCurrentLockTeams: h.teams }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: h.template }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ previewRosterLineupWithEngine: h.preview }))
vi.mock('@/lib/waiver-wire/current-nba-player-pool', () => ({ loadLeagueWaiverPlayerPool: h.pool }))
vi.mock('@/lib/pirate/waiverEvidence', () => ({ certifyPirateWaiverWitness: h.certify }))
const eventAt = '2026-10-26T00:20:00Z', day = '2026-10-25'
function fixture() {
  return {
    league: { findUnique: vi.fn().mockResolvedValue({ platform: 'manual', leagueType: 'pirate', sport: 'NBA', settings: {
      starter_slots: { PG: 1, BENCH: 1 }, sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true },
    }, lockAllMoves: false }) },
    redraftRoster: { findMany: vi.fn().mockResolvedValue([{ id: 'roster', ownerId: 'manager',
      legacyRoster: { id: 'af-roster', playerData: { players: ['p'], lineup_sections: { starters: [{ id: 'p', slotIndex: 0 }], bench: [] } } },
      players: [{ playerId: 'p', playerName: 'Daily player', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG' }],
    }]) },
    afRosterLineupAssignment: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'af-roster', playerId: 'p', section: 'starters', slotIndex: 0 }]) },
    redraftDailyLineup: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'roster', playerId: 'p', scoringDay: new Date(`${day}T00:00:00Z`), slotType: 'BENCH' }]) },
    sportsInjury: { findMany: vi.fn().mockResolvedValue([]) }, leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    leagueWaiverState: { findUnique: vi.fn().mockResolvedValue(null) },
    providerSyncState: { findFirst: vi.fn().mockResolvedValue({ lastSuccessAt: new Date('2026-10-26T00:15:00Z'), recordsSkipped: 0 }) },
    redraftLeagueTransaction: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
}
const capture = (db: ReturnType<typeof fixture>) => capturePirateLineupEvidence({ leagueId: 'L', seasonId: 'S', season: 2026,
  week: 1, now: new Date('2026-10-26T00:18:00Z') }, db as never)
const snapshot = (db: ReturnType<typeof fixture>) => db.redraftLeagueTransaction.createMany.mock.calls[0][0].data[0].metadata
beforeEach(() => {
  vi.resetAllMocks()
  h.template.mockResolvedValue({ slots: [{ slotName: 'PG', slotOrder: 1, starterCount: 1, allowedPositions: ['PG'], isFlexibleSlot: false }] })
  h.preview.mockResolvedValue({ ok: true }); h.pool.mockResolvedValue([]); h.certify.mockResolvedValue(true)
  h.teams.mockResolvedValue(new Map([['p', 'BOS']]))
  h.schedule.mockResolvedValue({ byTeam: new Map([['BOS', new Date('2026-10-24T00:20:00Z')]]),
    byTeamDay: new Map([['BOS', new Map([[day, new Date(eventAt)]])]]), firstKickoff: new Date('2026-10-24T00:20:00Z'), warnings: [] })
})

describe('daily Pirate lock capture', () => {
  it('uses the exact day’s saved slot and that day’s game instead of weekly fallbacks', async () => {
    const db = fixture(); await capture(db)
    expect(snapshot(db)).toMatchObject({ version: 3, scoringDay: day, lineupCertified: true,
      players: [expect.objectContaining({ slotType: 'BENCH', kickoffAt: new Date(eventAt).toISOString(), hasGameOnScoringDay: true })] })
  })
  it('does not certify a missing or carried-forward day as historical evidence', async () => {
    const db = fixture()
    db.redraftDailyLineup.findMany.mockResolvedValue([{ rosterId: 'roster', playerId: 'p', scoringDay: new Date('2026-10-24T00:00:00Z'), slotType: 'BENCH' }])
    await capture(db)
    expect(snapshot(db).lineupCertified).toBe(false)
  })
  it('hashes daily schedule changes even when the earliest weekly game is unchanged', async () => {
    const before = fixture(); await capture(before)
    const schedule = await h.schedule()
    h.schedule.mockResolvedValue({ ...schedule, byTeamDay: new Map([['BOS', new Map([[day, new Date('2026-10-26T00:21:00Z')]])]]) })
    const after = fixture(); await capture(after)
    expect(snapshot(before).rulesHash).not.toBe(snapshot(after).rulesHash)
  })
  it('records a reserve activation only after a successful read-only canonical save preview', async () => {
    const db = fixture()
    const roster = (await db.redraftRoster.findMany())[0]
    roster.players[0].slotType = 'TAXI'
    roster.legacyRoster.playerData = { players: ['p'], lineup_sections: { starters: [], bench: [], taxi: [{ id: 'p', position: 'PG' }] } } as never
    db.afRosterLineupAssignment.findMany.mockResolvedValue([{ rosterId: 'af-roster', playerId: 'p', section: 'taxi', slotIndex: 0 }])
    db.redraftDailyLineup.findMany.mockResolvedValue([{ rosterId: 'roster', playerId: 'p', scoringDay: new Date(`${day}T00:00:00Z`), slotType: 'TAXI' }])
    await capture(db)
    const before = snapshot(db)
    expect(before.plans[0].steps).toEqual([{ kind: 'activate', playerId: 'p', fromSlot: 'TAXI' }])
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({ nextPlayerData: expect.objectContaining({ starters: ['p'], taxi: [] }) }))
    db.redraftLeagueTransaction.findMany.mockResolvedValue([{ rosterId: 'roster', metadata: before }] as never)
    await capturePirateLineupEvidence({ leagueId: 'L', seasonId: 'S', season: 2026, week: 1, now: new Date('2026-10-26T00:22:00Z') }, db as never)
    const after = db.redraftLeagueTransaction.createMany.mock.calls[1][0].data[0].metadata
    const finding = evaluatePirateEvidencePair(before, after)
    expect(finding.decision, finding.reason).toBe('forfeit')
    expect(roster.players[0].slotType).toBe('TAXI')
  })
  it('certifies both acquisitions in one virtual sequence and carries the exact plan across lock', async () => {
    const db = fixture()
    const league = await db.league.findUnique()
    league.settings.starter_slots = { PG: 2, BENCH: 0 }
    h.template.mockResolvedValue({ slots: [{ slotName: 'PG', slotOrder: 1, starterCount: 2, allowedPositions: ['PG'], isFlexibleSlot: false }] })
    const roster = (await db.redraftRoster.findMany())[0]
    roster.players = ['drop-1', 'drop-2'].map((id) => ({ playerId: id, playerName: id, position: 'C', team: 'BOS', sport: 'NBA', slotType: 'BENCH' }))
    roster.legacyRoster.playerData = { players: ['drop-1', 'drop-2'], lineup_sections: { starters: [], bench: [{ id: 'drop-1', position: 'C' }, { id: 'drop-2', position: 'C' }] } } as never
    db.afRosterLineupAssignment.findMany.mockResolvedValue(['drop-1', 'drop-2'].map((id, i) => ({ rosterId: 'af-roster', playerId: id, section: 'bench', slotIndex: i })))
    db.redraftDailyLineup.findMany.mockResolvedValue(['drop-1', 'drop-2'].map((id) => ({ rosterId: 'roster', playerId: id, scoringDay: new Date(`${day}T00:00:00Z`), slotType: 'BENCH' })))
    h.teams.mockResolvedValue(new Map([['drop-1', 'BOS'], ['drop-2', 'BOS']]))
    h.pool.mockResolvedValue(['add-1', 'add-2'].map((id) => ({ player_id: id, sport_type: 'NBA', full_name: id,
      position: 'PG', team: 'BOS', team_abbreviation: 'BOS', status: 'Active' })))
    await capture(db)
    const before = snapshot(db)
    expect(before.plans[0].steps).toHaveLength(2)
    expect(before.waivers.every((p: { jointPlanOnly: boolean }) => p.jointPlanOnly)).toBe(true)
    expect(h.certify.mock.calls.map((call) => call[1].priorDrops)).toEqual([0, 1])
    expect(h.certify.mock.calls[1][1].playerData.players).toContain(h.certify.mock.calls[0][0].playerId)
    db.redraftLeagueTransaction.findMany.mockResolvedValue([{ rosterId: 'roster', metadata: before }] as never)
    await capturePirateLineupEvidence({ leagueId: 'L', seasonId: 'S', season: 2026, week: 1, now: new Date('2026-10-26T00:22:00Z') }, db as never)
    const after = db.redraftLeagueTransaction.createMany.mock.calls[1][0].data[0].metadata
    const finding = evaluatePirateEvidencePair(before, after)
    expect(finding.decision, finding.reason).toBe('forfeit')
    expect(roster.legacyRoster.playerData.players).toEqual(['drop-1', 'drop-2'])
  })
})
