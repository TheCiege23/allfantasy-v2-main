import { describe, expect, it, vi } from 'vitest'
import { isPirateLeague, protectedIds, readPirateRules } from '@/lib/pirate/rules'
import { assertPirateTradeAllowed } from '@/lib/pirate/tradeGuard'
import { nativeCreationRoster } from '@/lib/redraft/nativeCreationRoster'
import { runsStandardWeeklySeason } from '@/lib/season-week/standardSeasonScope'
import { assertNotReservedByPirateClaim } from '@/lib/pirate/claimReservation'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { commissionerRetryPirateClaim, commissionerRulePirateLineup, commissionerSelectPirateClaim, commissionerVoidPirateClaim, queuePirateClaimReminders, savePirateProtections } from '@/lib/pirate/service'

const now = new Date('2026-10-27T18:00:00.000Z')

function tradeDb(startTime: Date) {
  return {
    league: { findUnique: vi.fn().mockResolvedValue({ leagueType: 'pirate', leagueVariant: null, sport: 'NFL', season: 2026 }) },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue({ id: 'season', season: 2026, currentWeek: 8 }) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValue([{ status: 'in_progress' }]) },
    gameSchedule: { findFirst: vi.fn().mockResolvedValue({ startTime }) },
    fantasyScheduleGame: { findFirst: vi.fn().mockResolvedValue(null) },
    pirateProtectionSet: { findMany: vi.fn().mockResolvedValue([
      { rosterId: 'winner', status: 'active', playerIds: ['safe-a'] },
      { rosterId: 'loser', status: 'active', playerIds: ['safe-b'] },
    ]) },
  }
}

function protectionDb(existing: { status: string; playerIds: string[]; lockAt: Date } | null = null) {
  return {
    league: { findUnique: vi.fn().mockResolvedValue({ id: 'league', platform: 'manual', leagueType: 'pirate', leagueVariant: null, sport: 'NFL', season: 2026, settings: null, playoffStartWeek: 15 }) },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue({ id: 'season', season: 2026, currentWeek: 8, totalWeeks: 18, playoffStartWeek: 15 }) },
    redraftMatchup: { findMany: vi.fn().mockResolvedValue([{ status: 'scheduled' }]) },
    gameSchedule: { findFirst: vi.fn().mockResolvedValue({ startTime: new Date('2026-10-28T18:00:00.000Z') }) },
    fantasyScheduleGame: { findFirst: vi.fn().mockResolvedValue(null) },
    redraftRoster: { findFirst: vi.fn().mockResolvedValue({ id: 'roster' }) },
    pirateProtectionSet: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn().mockImplementation(async (args) => ({ ...args.create, ...args.update })),
    },
    redraftRosterPlayer: { findMany: vi.fn().mockImplementation(async (args) => args.where.playerId.in.map((playerId: string) => ({ playerId }))) },
  }
}

describe('Pirate League rules', () => {
  it('audits a commissioner lineup forfeiture, preserves locks for reversal, and can excuse it before selection', async () => {
    const claim = { id: 'claim', leagueId: 'league', seasonId: 'season', week: 8, matchupId: 'matchup', playoffMatchupId: null,
      loserRosterId: 'loser', winnerRosterId: 'winner', status: 'awaiting_selection' }
    const set = { id: 'set', status: 'active', voidReason: null as string | null, playerIds: ['star'] }
    const update = vi.fn().mockImplementation(async ({ data }) => { Object.assign(set, data); return set })
    const create = vi.fn().mockResolvedValue({ id: 'audit' })
    const db = {
      league: { findUnique: vi.fn().mockResolvedValue({ id: 'league', platform: 'manual', leagueType: 'pirate', sport: 'NFL', settings: null }) },
      redraftSeason: { findUnique: vi.fn().mockResolvedValue({ season: 2026 }) },
      redraftMatchup: { findUnique: vi.fn().mockResolvedValue({ status: 'final', homeRosterId: 'winner', awayRosterId: 'loser', homeScore: 100, awayScore: 90 }) },
      gameSchedule: { findFirst: vi.fn().mockResolvedValue({ startTime: new Date('2026-10-25T17:00:00Z') }) },
      fantasyScheduleGame: { findFirst: vi.fn().mockResolvedValue(null) },
      pirateClaim: { findFirst: vi.fn().mockResolvedValue(claim), findUnique: vi.fn().mockResolvedValue(claim) },
      pirateProtectionSet: { findUnique: vi.fn().mockImplementation(async () => set), update },
      redraftLeagueTransaction: { create },
      $transaction: vi.fn().mockImplementation(async (fn) => fn(db)),
    }
    const base = { leagueId: 'league', claimId: 'claim', actorUserId: 'commish', reason: 'The QB was out, and an active bench QB could start before kickoff.' }
    await commissionerRulePirateLineup({ ...base, decision: 'forfeit' }, db as never)
    expect(set).toMatchObject({ status: 'void', voidReason: 'illegal_lineup', playerIds: ['star'] })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'pirate_lineup_ruling', metadata: expect.objectContaining({ decision: 'forfeit', claimId: 'claim' }) }) }))
    await commissionerRulePirateLineup({ ...base, decision: 'excused', reason: 'No eligible QB was available from the roster or addable waivers.' }, db as never)
    expect(set).toMatchObject({ status: 'active', voidReason: null, playerIds: ['star'] })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('reopens an active claim when an excused ruling restores the selected player', async () => {
    const claim = { id: 'claim', leagueId: 'league', seasonId: 'season', week: 8, matchupId: 'matchup', playoffMatchupId: null,
      loserRosterId: 'loser', winnerRosterId: 'winner', status: 'pending', playerId: 'star', resolutionNote: null }
    const set = { id: 'set', status: 'void', voidReason: 'illegal_lineup', playerIds: ['star'] }
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      league: { findUnique: vi.fn().mockResolvedValue({ id: 'league', platform: 'manual', leagueType: 'pirate', sport: 'NFL', settings: null }) },
      redraftSeason: { findUnique: vi.fn().mockResolvedValue({ season: 2026 }) },
      redraftMatchup: { findUnique: vi.fn().mockResolvedValue({ status: 'final', homeRosterId: 'winner', awayRosterId: 'loser', homeScore: 100, awayScore: 90 }) },
      gameSchedule: { findFirst: vi.fn().mockResolvedValue({ startTime: new Date('2026-10-25T17:00:00Z') }) },
      fantasyScheduleGame: { findFirst: vi.fn().mockResolvedValue(null) },
      pirateClaim: { findFirst: vi.fn().mockResolvedValue(claim), findUnique: vi.fn().mockResolvedValue(claim), updateMany },
      pirateProtectionSet: { findUnique: vi.fn().mockResolvedValue(set), update: vi.fn().mockResolvedValue({ ...set, status: 'active' }) },
      redraftLeagueTransaction: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
      $transaction: vi.fn().mockImplementation(async (fn) => fn(db)),
    }
    const result = await commissionerRulePirateLineup({ leagueId: 'league', claimId: 'claim', actorUserId: 'commish',
      decision: 'excused', reason: 'There was no addable active replacement before the slot lock.', now }, db as never)
    expect(result.reopenedSelection).toBe(true)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'claim', status: 'pending' },
      data: expect.objectContaining({ status: 'awaiting_selection', playerId: null, deadlineAt: null,
        selectionDeadlineAt: new Date('2026-10-28T18:00:00.000Z') }),
    }))
  })

  it('tags claim reminders so push respects league notification preferences', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 })
    const db = {
      pirateClaim: { findMany: vi.fn().mockResolvedValue([{
        id: 'claim', status: 'awaiting_selection', winnerRosterId: 'winner', loserRosterId: 'loser',
        selectionDeadlineAt: new Date('2026-10-28T18:00:00.000Z'), deadlineAt: null,
      }]) },
      redraftRoster: { findMany: vi.fn().mockResolvedValue([{ id: 'winner', ownerId: 'manager' }]) },
      notificationOutbox: { createMany },
    }
    await queuePirateClaimReminders('league', db as never)
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0]![0].data).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'push', metadata: expect.objectContaining({ notificationCategory: 'league_announcements' }) }),
      expect.objectContaining({ channel: 'in_app', metadata: expect.objectContaining({ notificationCategory: 'league_announcements' }) }),
    ]))
  })

  it.each(['NFL', 'NBA', 'MLB', 'NHL'])('uses native %s rosters and a weekly season', (sport) => {
    expect(nativeCreationRoster(sport, 'pirate')).not.toBeNull()
    expect(runsStandardWeeklySeason(sport, 'pirate')).toBe(true)
  })
  it('accepts Pirate as a first-class league creation concept', () => {
    expect(normalizeConceptToFormat('pirate')?.formatId).toBe('pirate')
    expect(normalizeConceptToFormat('PIRATE')?.formatId).toBe('pirate')
  })
  it('recognizes the native format and keeps a partial set of locks', () => {
    expect(isPirateLeague({ leagueType: 'pirate' })).toBe(true)
    expect(readPirateRules({ conceptSetup: { pirate: { protectionLimit: 3, claimHours: 24 } } })).toMatchObject({
      protectionLimit: 3, claimHours: 24, playoffClaims: false,
    })
    expect(protectedIds({ status: 'active', playerIds: ['one', 'two'] })).toEqual(['one', 'two'])
    expect(protectedIds({ status: 'void', playerIds: ['one'] })).toEqual([])
  })

  it('allows ordinary trades before the first game', async () => {
    const db = tradeDb(new Date('2026-10-28T18:00:00.000Z'))
    await expect(assertPirateTradeAllowed('league', [
      { fromRosterId: 'winner', assetType: 'player', playerId: 'unsafe-a' },
      { fromRosterId: 'loser', assetType: 'player', playerId: 'unsafe-b' },
    ], db as never, now)).resolves.toBeUndefined()
    expect(db.pirateProtectionSet.findMany).not.toHaveBeenCalled()
  })

  it('blocks unprotected players once games start, but allows protected for protected', async () => {
    const db = tradeDb(new Date('2026-10-27T16:00:00.000Z'))
    await expect(assertPirateTradeAllowed('league', [
      { fromRosterId: 'winner', assetType: 'player', playerId: 'safe-a' },
      { fromRosterId: 'loser', assetType: 'player', playerId: 'unsafe-b' },
    ], db as never, now)).rejects.toThrow('protected-for-protected')
    await expect(assertPirateTradeAllowed('league', [
      { fromRosterId: 'winner', assetType: 'player', playerId: 'safe-a' },
      { fromRosterId: 'loser', assetType: 'player', playerId: 'safe-b' },
    ], db as never, now)).resolves.toBeUndefined()
  })

  it('reserves a selected player from waiver drops until the claim settles', async () => {
    const db = { pirateClaim: { findFirst: vi.fn().mockResolvedValue({ id: 'claim' }) } }
    await expect(assertNotReservedByPirateClaim(db as never, 'loser', 'star')).rejects.toThrow('reserved by a Pirate claim')
    db.pirateClaim.findFirst.mockResolvedValue(null)
    await expect(assertNotReservedByPirateClaim(db as never, 'loser', 'star')).resolves.toBeUndefined()
  })

  it('keeps fewer than three locks, but voids an oversized declaration', async () => {
    const db = protectionDb()
    const base = { leagueId: 'league', rosterId: 'roster', actorUserId: 'manager', week: 8, now }
    const partial = await savePirateProtections({ ...base, playerIds: ['one', 'two'] }, db as never)
    expect(partial.set.playerIds).toEqual(['one', 'two'])
    const oversized = await savePirateProtections({ ...base, playerIds: ['one', 'two', 'three', 'four'] }, db as never)
    expect(oversized.set.status).toBe('void')
    expect(oversized.set.playerIds).toEqual([])
  })

  it('voids a changed post-lock declaration and preserves an identical retry', async () => {
    const existing = { status: 'active', playerIds: ['one'], lockAt: new Date('2026-10-27T16:00:00.000Z') }
    const db = protectionDb(existing)
    const base = { leagueId: 'league', rosterId: 'roster', actorUserId: 'manager', week: 8, now }
    const same = await savePirateProtections({ ...base, playerIds: ['one'] }, db as never)
    expect(same.set).toBe(existing)
    expect(db.pirateProtectionSet.upsert).not.toHaveBeenCalled()
    const changed = await savePirateProtections({ ...base, playerIds: ['two'] }, db as never)
    expect(changed.set.status).toBe('void')
    expect(changed.set.voidReason).toBe('late_change')
  })

  it('lets a commissioner select for an overdue winner and starts a full response window', async () => {
    const selectedAt = new Date('2026-10-30T12:00:00.000Z')
    const db = {
      league: { findUnique: vi.fn().mockResolvedValue({ id: 'league', platform: 'manual', leagueType: 'pirate', leagueVariant: null, sport: 'NFL', season: 2026, settings: null }) },
      pirateClaim: {
        findFirst: vi.fn().mockResolvedValue({ id: 'claim' }),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'claim', leagueId: 'league', seasonId: 'season', week: 8, matchupId: 'matchup', playoffMatchupId: null, loserRosterId: 'loser', winnerRosterId: 'winner', status: 'awaiting_selection' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'claim', status: 'pending' }),
      },
      redraftSeason: { findUnique: vi.fn().mockResolvedValue({ season: 2026 }) },
      redraftMatchup: { findUnique: vi.fn().mockResolvedValue({ status: 'final', homeRosterId: 'winner', awayRosterId: 'loser', homeScore: 100, awayScore: 80 }) },
      gameSchedule: { findFirst: vi.fn().mockResolvedValue({ startTime: new Date('2026-10-29T16:00:00.000Z') }) },
      fantasyScheduleGame: { findFirst: vi.fn().mockResolvedValue(null) },
      redraftRosterPlayer: { findFirst: vi.fn().mockResolvedValue({ id: 'player', playerName: 'Star' }) },
      pirateProtectionSet: { findUnique: vi.fn().mockResolvedValue({ status: 'active', playerIds: ['safe'] }) },
    }
    await commissionerSelectPirateClaim({ leagueId: 'league', claimId: 'claim', actorUserId: 'commissioner', playerId: 'star', now: selectedAt }, db as never)
    expect(db.pirateClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending', deadlineAt: new Date('2026-10-31T12:00:00.000Z') }),
    }))
  })

  it('records a reason when a commissioner voids a claim and refuses early retry', async () => {
    const db = {
      pirateClaim: {
        findFirst: vi.fn().mockResolvedValue({ resolutionNote: 'Commissioner selected the player.' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'claim', status: 'void' }),
      },
    }
    await expect(commissionerVoidPirateClaim({ leagueId: 'league', claimId: 'claim', actorUserId: 'commissioner', reason: 'Score correction' }, db as never)).resolves.toMatchObject({ status: 'void' })
    expect(db.pirateClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolutionNote: expect.stringContaining('Commissioner selected the player. Commissioner commissioner voided the claim: Score correction') }),
    }))
    db.pirateClaim.findFirst.mockResolvedValue({ deadlineAt: new Date('2026-10-28T00:00:00.000Z') })
    await expect(commissionerRetryPirateClaim({ leagueId: 'league', claimId: 'claim', actorUserId: 'commissioner', now }, db as never)).rejects.toThrow('response window has not ended')
  })
})
