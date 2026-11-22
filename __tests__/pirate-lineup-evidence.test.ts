import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assessPirateLineupEvidence, capturePirateLineupEvidence, evaluatePirateEvidencePair, type PirateLineupEvidence } from '@/lib/pirate/lineupEvidence'
import { buildWeekKickoffMap } from '@/lib/redraft/lineupLock'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { loadLeagueWaiverPlayerPool } from '@/lib/waiver-wire/current-nba-player-pool'
import { certifyPirateWaiverWitness } from '@/lib/pirate/waiverEvidence'

vi.mock('@/lib/redraft/lineupLock', async (original) => ({ ...await original<typeof import('@/lib/redraft/lineupLock')>(), buildWeekKickoffMap: vi.fn() }))
vi.mock('@/lib/redraft/lineupLockCurrentTeam', () => ({ resolveCurrentLockTeams: vi.fn() }))
vi.mock('@/lib/waiver-wire/current-nba-player-pool', () => ({ loadLeagueWaiverPlayerPool: vi.fn() }))
vi.mock('@/lib/pirate/waiverEvidence', () => ({ certifyPirateWaiverWitness: vi.fn() }))
vi.mock('@/lib/roster-lineup-engine/lineupService', () => ({ previewRosterLineupWithEngine: vi.fn().mockResolvedValue({ ok: false }) }))
vi.mock('@/lib/multi-sport/MultiSportRosterService', () => ({ getRosterTemplateForLeague: vi.fn().mockResolvedValue({
  slots: [{ slotName: 'QB', slotOrder: 1, starterCount: 1, allowedPositions: ['QB'], isFlexibleSlot: false }],
}) }))

const lockAt = '2026-10-26T00:20:00.000Z'

function evidence(phase: 'before' | 'after', extra: Partial<PirateLineupEvidence> = {}): PirateLineupEvidence {
  return { version: 2, week: 8, sport: 'NFL', eventAt: lockAt, scoringDay: null, phase,
    capturedAt: phase === 'before' ? '2026-10-26T00:18:00.000Z' : '2026-10-26T00:22:00.000Z',
    mode: 'per_player_kickoff', terminalEvent: true, lineupCertified: true, starterSlots: [['QB', 1]], rulesHash: 'same-rules',
    scheduleWarnings: [], injuryFeedFresh: true, injurySyncAt: '2026-10-26T00:15:00.000Z', injuryReports: [], waiverPoolCertified: false,
    waiverState: { type: 'faab', nextRunAt: null, processingLocked: false },
    waivers: [], players: [{ playerId: 'bench', playerName: 'Active replacement', position: 'QB', slotType: 'BENCH',
      team: 'KC', kickoffAt: lockAt, availabilityKnown: true, injuryStatus: null,
      addableBeforeLock: true, lockedAtSnapshot: phase === 'after' }], ...extra }
}

describe('immutable Pirate lineup evidence', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([['NFL', 'QB'], ['NBA', 'PG'], ['MLB', '1B'], ['NHL', 'C']])('rules a proven roster replacement for %s', (sport, slot) => {
    const before = evidence('before', { sport, starterSlots: [[slot, 1]] })
    before.players[0].position = slot
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after)).toMatchObject({ decision: 'forfeit', replacementIds: ['bench'] })
  })

  it('keeps protections for review when historical addable waivers are unknown', () => {
    expect(evaluatePirateEvidencePair(evidence('before', { players: [] }), evidence('after', { players: [] })).decision).toBe('review')
  })

  it.each([['NBA', 'PG'], ['MLB', '1B'], ['NHL', 'C']])('uses an exact-day daily snapshot for %s', (sport, slot) => {
    const before = evidence('before', { version: 3, sport, mode: 'daily', scoringDay: '2026-10-25', starterSlots: [[slot, 1]] })
    before.players[0] = { ...before.players[0], position: slot, hasGameOnScoringDay: true }
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('forfeit')
    expect(evaluatePirateEvidencePair(before, { ...after, scoringDay: '2026-10-26' }).decision).toBe('review')
    expect(evaluatePirateEvidencePair({ ...before, lineupCertified: false }, after).decision).toBe('review')
    expect(evaluatePirateEvidencePair({ ...before, version: 2 }, { ...after, version: 2 }).decision).toBe('review')
  })

  it('does not use an off-day player or another day’s later evidence as a daily replacement', () => {
    const before = evidence('before', { version: 3, sport: 'NBA', mode: 'daily', scoringDay: '2026-10-25', starterSlots: [['PG', 1]] })
    before.players[0] = { ...before.players[0], position: 'PG', hasGameOnScoringDay: false, kickoffAt: null }
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
    const futureAt = '2026-10-26T02:20:00.000Z'
    before.players[0] = { ...before.players[0], hasGameOnScoringDay: true, kickoffAt: futureAt }
    after.players = structuredClone(before.players)
    const later = evidence('after', { ...after, eventAt: futureAt, capturedAt: '2026-10-26T02:22:00.000Z', scoringDay: '2026-10-26' })
    expect(evaluatePirateEvidencePair(before, after, [later]).decision).toBe('review')
    expect(evaluatePirateEvidencePair(before, after, [{ ...later, scoringDay: '2026-10-25' }]).decision).toBe('forfeit')
  })

  it('accepts combined pickups only with the same joint proof on both sides of lock', () => {
    const waivers = ['QB', 'WR'].map((position) => ({ ...evidence('before').players[0], playerId: position,
      playerName: position, position, slotType: 'WAIVER', jointPlanOnly: true,
      certifiedEventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z' }))
    const plan = { eventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z', steps: [
      { kind: 'pickup' as const, playerId: 'QB' }, { kind: 'pickup' as const, playerId: 'WR' }],
      assignment: [{ playerId: 'QB', slotType: 'QB', slotIndex: 0 }, { playerId: 'WR', slotType: 'WR', slotIndex: 1 }] }
    const before = evidence('before', { version: 3, starterSlots: [['QB', 1], ['WR', 1]], players: [], waivers, plans: [plan] })
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('forfeit')
    expect(evaluatePirateEvidencePair(before, { ...after, plans: [] }).decision).toBe('review')
    expect(evaluatePirateEvidencePair(before, { ...after, plans: [{ ...plan, checkedAt: after.capturedAt }] }).decision).toBe('review')
  })

  it.each(['IR', 'TAXI'])('requires a joint canonical proof for %s activation', (slotType) => {
    const before = evidence('before', { version: 3 })
    before.players[0] = { ...before.players[0], slotType, addableBeforeLock: false, activationBeforeLock: true }
    const plan = { eventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z', steps: [
      { kind: 'activate' as const, playerId: 'bench', fromSlot: slotType }], assignment: [{ playerId: 'bench', slotType: 'QB', slotIndex: 0 }] }
    before.plans = [plan]
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('forfeit')
    expect(evaluatePirateEvidencePair({ ...before, plans: [] }, after).decision).toBe('review')
    expect(evaluatePirateEvidencePair({ ...before, players: [{ ...before.players[0], activationBeforeLock: false }] }, after).decision).toBe('review')
  })

  it('verifies the same saved daily lineup when assessing the completed week', async () => {
    const before = evidence('before', { version: 3, sport: 'NBA', mode: 'daily', scoringDay: '2026-10-25', starterSlots: [['PG', 1]] })
    before.players[0].position = 'PG'
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    const db = { redraftLeagueTransaction: { findMany: vi.fn().mockResolvedValue([
      { id: 'before', metadata: before }, { id: 'after', metadata: after },
    ]) }, redraftDailyLineup: { findMany: vi.fn().mockResolvedValue([{ playerId: 'bench', slotType: 'BENCH' }]) } }
    const input = { leagueId: 'L', seasonId: 'S', rosterId: 'R', week: 8 }
    expect((await assessPirateLineupEvidence(input, db as never))?.decision).toBe('forfeit')
    expect(db.redraftDailyLineup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      scoringDay: new Date('2026-10-25T00:00:00Z'), week: 8, rosterId: 'R', leagueId: 'L',
    }) }))
    db.redraftDailyLineup.findMany.mockResolvedValue([{ playerId: 'bench', slotType: 'PG' }])
    expect((await assessPirateLineupEvidence(input, db as never))?.decision).toBe('review')
  })

  it('keeps older snapshots for review because they lack provider agreement checks', () => {
    expect(evaluatePirateEvidencePair(evidence('before', { version: 1 }), evidence('after', { version: 1 })).decision).toBe('review')
  })

  it('uses a certified single-drop plan without counting the dropped player in its legal lineup', () => {
    const drop = { ...evidence('before').players[0], playerId: 'drop', playerName: 'Bench receiver', position: 'WR' }
    const waiver = { ...drop, playerId: 'waiver', playerName: 'Available quarterback', position: 'QB', slotType: 'WAIVER',
      dropPlayerId: 'drop', certifiedEventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z' }
    const before = evidence('before', { players: [drop], waivers: [waiver] })
    const after = evidence('after', { players: [{ ...drop, lockedAtSnapshot: true }], waivers: [{ ...waiver }] })
    expect(evaluatePirateEvidencePair(before, after)).toMatchObject({ decision: 'forfeit', replacementIds: ['waiver'] })
    after.waivers[0].dropPlayerId = 'another-drop'
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
    after.waivers[0].dropPlayerId = 'drop'
    before.players[0].lockedAtSnapshot = true
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
  })

  it('does not drop a needed flex replacement or combine separate single-drop plans', () => {
    const drop = { ...evidence('before').players[0], playerId: 'only-wr', playerName: 'Only active receiver', position: 'WR' }
    const waiver = { ...drop, playerId: 'waiver-qb', position: 'QB', slotType: 'WAIVER', dropPlayerId: 'only-wr',
      certifiedEventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z' }
    const before = evidence('before', { starterSlots: [['QB', 1], ['WR', 1]], players: [drop], waivers: [waiver,
      { ...waiver, playerId: 'waiver-wr', position: 'WR' }] })
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
  })

  it('uses one proven no-drop waiver pickup and rejects a held or previously checked candidate', () => {
    const witness = { ...evidence('before').players[0], playerId: 'waiver-qb', slotType: 'WAIVER',
      certifiedEventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z' }
    const before = evidence('before', { players: [], waivers: [witness] })
    const after = evidence('after', { players: [], waivers: [{ ...witness }] })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('forfeit')
    after.waivers[0].addableBeforeLock = false
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
    after.waivers[0].addableBeforeLock = true
    before.waivers[0].certifiedEventAt = '2026-10-25T17:00:00.000Z'
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
  })

  it.each([
    { injuryFeedFresh: false }, { lineupCertified: false }, { rulesHash: 'changed-rules' },
    { scheduleWarnings: ['Incomplete schedule'] }, { terminalEvent: false }, { mode: 'daily' },
  ])('does not forfeit when the evidence is uncertain: %j', (changes) => {
    expect(evaluatePirateEvidencePair(evidence('before'), evidence('after', changes)).decision).toBe('review')
  })

  it('refuses stale, reversed, and mismatched boundary snapshots', () => {
    expect(evaluatePirateEvidencePair(evidence('before', { capturedAt: '2026-10-26T00:00:00Z' }), evidence('after')).decision).toBe('review')
    expect(evaluatePirateEvidencePair(evidence('before', { capturedAt: '2026-10-26T00:21:00Z' }), evidence('after')).decision).toBe('review')
    expect(evaluatePirateEvidencePair(evidence('before'), evidence('after', { week: 9 })).decision).toBe('review')
  })

  it('does not infer availability from a missing player identity or a roster change', () => {
    const after = evidence('after')
    after.players[0].availabilityKnown = false
    expect(evaluatePirateEvidencePair(evidence('before'), after).decision).toBe('review')
    after.players[0].playerId = 'added-after-lock'
    expect(evaluatePirateEvidencePair(evidence('before'), after).decision).toBe('review')
  })

  it('requires a future replacement to remain active at his own game lock', () => {
    const futureAt = '2026-10-27T00:20:00.000Z'
    const before = evidence('before', { mode: 'first_game_of_week' })
    before.players[0].kickoffAt = futureAt
    const after = evidence('after', { ...before, phase: 'after', capturedAt: '2026-10-26T00:22:00.000Z' })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
    const later = evidence('after', { mode: 'first_game_of_week', eventAt: futureAt, capturedAt: '2026-10-27T00:22:00.000Z' })
    later.players[0].kickoffAt = futureAt
    expect(evaluatePirateEvidencePair(before, after, [later]).decision).toBe('forfeit')
    later.players[0].injuryStatus = 'OUT'
    expect(evaluatePirateEvidencePair(before, after, [later]).decision).toBe('review')
  })

  it('does not remove an already locked inactive starter to fit a late bench replacement', () => {
    const before = evidence('before')
    before.players.push({ ...before.players[0], playerId: 'out', playerName: 'Locked inactive QB', slotType: 'QB',
      kickoffAt: '2026-10-25T17:00:00.000Z', injuryStatus: 'OUT', lockedAtSnapshot: true, addableBeforeLock: false })
    const after = evidence('after', { players: before.players.map((p) => ({ ...p })) })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('review')
  })

  it('does not penalize a possible secondary-position starter based on the stored primary position', () => {
    const before = evidence('before', { sport: 'MLB', starterSlots: [['3B', 1]] })
    before.players[0].position = '3B'
    before.players.push({ ...before.players[0], playerId: 'multi', playerName: 'Multi-position starter',
      position: '1B', slotType: '3B', lockedAtSnapshot: false })
    const after = evidence('after', { sport: 'MLB', starterSlots: [['3B', 1]], players: before.players.map((p) => ({ ...p, lockedAtSnapshot: true })) })
    expect(evaluatePirateEvidencePair(before, after)).toMatchObject({ decision: 'review', reason: expect.stringContaining('secondary positions') })
  })

  it('can rule an inactive starter frozen at an earlier game, while an empty future slot still waits', () => {
    const before = evidence('before', { terminalEvent: false })
    before.players.push({ ...before.players[0], playerId: 'out', playerName: 'Inactive QB', slotType: 'QB',
      injuryStatus: 'OUT', lockedAtSnapshot: false })
    const after = evidence('after', { terminalEvent: false, players: before.players.map((p) => ({ ...p, lockedAtSnapshot: true })) })
    expect(evaluatePirateEvidencePair(before, after).decision).toBe('forfeit')
    expect(evaluatePirateEvidencePair(evidence('before', { terminalEvent: false }), evidence('after', { terminalEvent: false })).decision).toBe('review')
  })

  it('requires the final saved week lineup to confirm an empty slot, even if a partial schedule looked complete', async () => {
    const saved = vi.fn().mockResolvedValue([{ playerId: 'bench', section: 'bench', slotIndex: 0 }])
    const db = { redraftLeagueTransaction: { findMany: vi.fn().mockResolvedValue([
      { id: 'before', metadata: evidence('before') }, { id: 'after', metadata: evidence('after') },
    ]) }, redraftRoster: { findFirst: vi.fn().mockResolvedValue({ legacyRoster: { id: 'af' }, season: { season: 2026 } }) },
    afRosterLineupAssignment: { findMany: saved } }
    const input = { leagueId: 'league', seasonId: 'season', rosterId: 'roster', week: 8 }
    expect((await assessPirateLineupEvidence(input, db as never))?.decision).toBe('forfeit')
    saved.mockResolvedValue([{ playerId: 'later-active-qb', section: 'starters', slotIndex: 0 }])
    expect((await assessPirateLineupEvidence(input, db as never))?.decision).toBe('review')
    saved.mockResolvedValue([])
    expect((await assessPirateLineupEvidence(input, db as never))?.decision).toBe('review')
  })

  it('writes one immutable record per roster, week, event, and side of lock even on repeated ticks', async () => {
    const kickoff = new Date(lockAt)
    vi.mocked(buildWeekKickoffMap).mockResolvedValue({ byTeam: new Map([['KC', kickoff]]), firstKickoff: kickoff, warnings: [] })
    vi.mocked(resolveCurrentLockTeams).mockResolvedValue(new Map([['bench', 'KC']]))
    const ids = new Set<string>()
    const createMany = vi.fn().mockImplementation(async ({ data }) => {
      const count = data.filter((row: { id: string }) => !ids.has(row.id)).length
      data.forEach((row: { id: string }) => ids.add(row.id))
      return { count }
    })
    const db = {
      league: { findUnique: vi.fn().mockResolvedValue({ platform: 'manual', leagueType: 'pirate', sport: 'NFL',
        settings: { starter_slots: { QB: 1 } }, lockAllMoves: false }) },
      leagueTeam: { findMany: vi.fn().mockResolvedValue([{ externalId: 'af-roster', platformUserId: 'manager', claimedByUserId: 'manager' }]) },
      redraftRoster: { findMany: vi.fn().mockResolvedValue([{ id: 'roster',
        legacyRoster: { id: 'af-roster', playerData: { lineup_sections: { starters: [], bench: [{ id: 'bench', position: 'QB' }] } } },
        players: [{ playerId: 'bench', playerName: 'Bench QB', position: 'QB', team: 'KC', sport: 'NFL', slotType: 'BENCH', byeWeek: null }],
      }]) },
      sportsInjury: { findMany: vi.fn().mockResolvedValue([]) },
      leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      leagueWaiverState: { findUnique: vi.fn().mockResolvedValue(null) },
      providerSyncState: { findFirst: vi.fn().mockResolvedValue({ lastSuccessAt: new Date('2026-10-26T00:15:00Z'), recordsSkipped: 0 }) },
      afRosterLineupAssignment: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'af-roster', playerId: 'bench', section: 'bench', slotIndex: 0 }]) },
      redraftLeagueTransaction: { findMany: vi.fn().mockResolvedValue([]), createMany },
    }
    const input = { leagueId: 'league', seasonId: 'season', season: 2026, week: 8, now: new Date('2026-10-26T00:18:00Z') }
    expect(await capturePirateLineupEvidence(input, db as never)).toBe(1)
    expect(await capturePirateLineupEvidence(input, db as never)).toBe(0)
    expect(await capturePirateLineupEvidence({ ...input, now: new Date('2026-10-26T00:22:00Z') }, db as never)).toBe(1)
    const metadata = createMany.mock.calls[0][0].data[0].metadata
    expect(metadata).toMatchObject({ phase: 'before', lineupCertified: true, injuryFeedFresh: true, waiverPoolCertified: false })
    expect(metadata.players[0]).toMatchObject({ availabilityKnown: true, addableBeforeLock: true })
    expect(db.providerSyncState.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ key: 'lineup-evidence-v2' }) }))
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true)
    db.sportsInjury.findMany.mockResolvedValue([{ playerId: 'other-person', playerName: 'Bench QB', team: 'DEN', position: 'QB',
      sport: 'NFL', status: 'OUT', fetchedAt: new Date('2026-10-26T00:15:00Z'), date: null, source: 'fixture' }] as never)
    await capturePirateLineupEvidence({ ...input, week: 9 }, db as never)
    expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0].availabilityKnown).toBe(false)
    const report = { playerId: 'bench', playerName: 'Bench QB', team: 'KC', position: 'QB', sport: 'NFL',
      fetchedAt: new Date('2026-10-26T00:15:00Z'), date: new Date('2026-10-26T00:15:00Z'), source: 'fixture' }
    for (const [week, reports, known] of [
      [15, [{ ...report, playerName: 'Unrelated Player', status: null }], true],
      [16, [{ ...report, status: 'Active' }, { ...report, status: null }], false],
      [17, [{ ...report, status: 'Active' }, { ...report, status: 'OUT' }], false],
    ] as const) {
      db.sportsInjury.findMany.mockResolvedValue(reports as never)
      await capturePirateLineupEvidence({ ...input, week }, db as never)
      expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0].availabilityKnown).toBe(known)
    }
    db.sportsInjury.findMany.mockResolvedValue([])
    db.league.findUnique.mockResolvedValue({ platform: 'manual', leagueType: 'pirate', sport: 'NFL',
      settings: { starter_slots: { QB: 1 }, commissionerRosterLocks: { team: true } }, lockAllMoves: false } as never)
    await capturePirateLineupEvidence({ ...input, week: 10 }, db as never)
    expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.scheduleWarnings).toContain('Commissioner locked this roster.')
    expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0].addableBeforeLock).toBe(false)
    db.league.findUnique.mockResolvedValue({ platform: 'manual', leagueType: 'pirate', sport: 'NFL',
      settings: { starter_slots: { QB: 1 } }, lockAllMoves: false } as never)
    db.afRosterLineupAssignment.findMany.mockResolvedValue([{ rosterId: 'af-roster', playerId: 'bench', section: 'ir', slotIndex: 0 }])
    await capturePirateLineupEvidence({ ...input, week: 11 }, db as never)
    expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0]).toMatchObject({ slotType: 'ir', addableBeforeLock: false })
    db.afRosterLineupAssignment.findMany.mockResolvedValue([{ rosterId: 'af-roster', playerId: 'bench', section: 'bench', slotIndex: 0 }])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster',
      legacyRoster: { id: 'af-roster', playerData: { lineup_sections: { starters: [], bench: [{ id: 'bench', position: 'QB' }] } } },
      players: [{ playerId: 'bench', playerName: 'Bench QB', position: 'QB', team: 'KC', sport: 'NFL', slotType: 'BENCH', byeWeek: 12 }],
    }] as never)
    await capturePirateLineupEvidence({ ...input, week: 12 }, db as never)
    expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0].availabilityKnown).toBe(false)
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster',
      legacyRoster: { id: 'af-roster', playerData: { lineup_sections: { starters: [], bench: [{ id: 'bench', position: 'QB' }] } } },
      players: [{ playerId: 'bench', playerName: 'Bench QB', position: 'QB', team: 'KC', sport: 'NFL', slotType: 'BENCH', byeWeek: null }],
    }] as never)
    for (const [week, status, expectedKnown] of [[13, 'OUT', false], [14, 'IR', true]] as const) {
      db.sportsInjury.findMany.mockResolvedValue([{ playerId: 'bench', playerName: 'Bench QB', team: 'KC', position: 'QB', sport: 'NFL',
        status, fetchedAt: new Date('2026-10-26T00:15:00Z'), date: new Date('2026-10-01T00:00:00Z'), source: 'fixture' }] as never)
      await capturePirateLineupEvidence({ ...input, week }, db as never)
      expect(createMany.mock.calls.at(-1)?.[0].data[0].metadata.players[0].availabilityKnown).toBe(expectedKnown)
    }
  })

  it.each([false, true])('captures a waiver witness only after manager-specific checks (full roster: %s)', async (full) => {
    const kickoff = new Date(lockAt)
    vi.mocked(buildWeekKickoffMap).mockResolvedValue({ byTeam: new Map([['KC', kickoff]]), firstKickoff: kickoff, warnings: [] })
    vi.mocked(resolveCurrentLockTeams).mockResolvedValue(new Map([['receiver', 'KC']]))
    vi.mocked(loadLeagueWaiverPlayerPool).mockResolvedValue(['held', 'free'].map((id) => ({
      player_id: id, external_source_id: null, sport_type: 'NFL', full_name: `${id} QB`, position: 'QB',
      team_id: null, team_abbreviation: 'KC', team: 'KC', status: 'Active', injury_status: null,
    })) as never)
    vi.mocked(certifyPirateWaiverWitness).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      league: { findUnique: vi.fn().mockResolvedValue({ platform: 'manual', leagueType: 'pirate', sport: 'NFL', settings: { starter_slots: { QB: 1, BENCH: full ? 0 : 1 } }, lockAllMoves: false }) },
      redraftRoster: { findMany: vi.fn().mockResolvedValue([{ id: 'roster', ownerId: 'manager',
        legacyRoster: { id: 'af-roster', playerData: { players: ['receiver'], lineup_sections: { starters: [], bench: [{ id: 'receiver', position: 'WR' }] } } },
        players: [{ playerId: 'receiver', playerName: 'Receiver', position: 'WR', team: 'KC', sport: 'NFL', slotType: 'BENCH', byeWeek: null }],
      }]) },
      sportsInjury: { findMany: vi.fn().mockResolvedValue([]) },
      leagueWaiverSettings: { findUnique: vi.fn().mockResolvedValue(null) },
      leagueWaiverState: { findUnique: vi.fn().mockResolvedValue(null) },
      providerSyncState: { findFirst: vi.fn().mockResolvedValue({ lastSuccessAt: new Date('2026-10-26T00:15:00Z'), recordsSkipped: 0 }) },
      afRosterLineupAssignment: { findMany: vi.fn().mockResolvedValue([{ rosterId: 'af-roster', playerId: 'receiver', section: 'bench', slotIndex: 0 }]) },
      redraftLeagueTransaction: { findMany: vi.fn().mockResolvedValue([]), createMany },
    }
    await capturePirateLineupEvidence({ leagueId: 'league', seasonId: 'season', season: 2026, week: 8,
      now: new Date('2026-10-26T00:18:00Z') }, db as never)
    expect(certifyPirateWaiverWitness).toHaveBeenCalledTimes(2)
    expect(certifyPirateWaiverWitness).toHaveBeenLastCalledWith(expect.objectContaining({ actorUserId: 'manager', rosterId: 'af-roster', dropPlayerId: full ? 'receiver' : null }))
    expect(createMany.mock.calls[0][0].data[0].metadata.waivers).toEqual([expect.objectContaining({
      playerName: 'free QB', addableBeforeLock: true, certifiedEventAt: lockAt, checkedAt: '2026-10-26T00:18:00.000Z',
    })])
  })
})
