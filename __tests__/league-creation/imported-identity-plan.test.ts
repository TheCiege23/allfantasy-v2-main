import { describe, expect, it, vi } from 'vitest'
import {
  checkImportedSource,
  classifyImportedFuturePick,
  ImportedLeagueCarryoverError,
  planImportedPlayerIdentity,
  type ImportedRoster,
  type ImportedTeam,
} from '@/lib/league-creation/canonical/importedIdentityPlan'
import * as carryover from '@/lib/league-creation/canonical/carryOverImportedLeague'

const team = (n: number, extra: Partial<ImportedTeam> = {}): ImportedTeam => ({
  id: `team-${n}`, externalId: `seat-${n}`, platformUserId: `manager-${n}`, claimedByUserId: null,
  teamName: `Team ${n}`, ownerName: `Owner ${n}`, avatarUrl: null, isCommissioner: n === 1, ...extra,
})
const roster = (n: number, players: string[], seat = `seat-${n}`): ImportedRoster => ({
  id: `roster-${n}`, platformUserId: `manager-${n}`, playerData: { source_team_id: seat, players }, faabRemaining: null, waiverPriority: null,
})
const tx = (identities: Array<Record<string, string>>) => ({
  playerIdentityMap: { findMany: vi.fn().mockResolvedValue(identities) },
  player: { findMany: vi.fn().mockResolvedValue([]) },
}) as never

describe('classifyImportedFuturePick', () => {
  const map = new Map([['seat-1', 'r1'], ['seat-2', 'r2']])
  it('maps a traded pick to roster ids', () => {
    expect(classifyImportedFuturePick({ pickSeason: 2028, originalRosterId: 'seat-1', currentOwnerId: 'seat-2' }, map, 2027))
      .toEqual({ kind: 'traded', originalRosterId: 'r1', currentOwnerId: 'r2' })
  })
  it('checks unmapped, then untraded, then past season — first match wins', () => {
    expect(classifyImportedFuturePick({ pickSeason: 2020, originalRosterId: 'seat-9', currentOwnerId: 'seat-9' }, map, 2027).kind).toBe('unmapped')
    expect(classifyImportedFuturePick({ pickSeason: 2020, originalRosterId: 'seat-1', currentOwnerId: 'seat-1' }, map, 2027).kind).toBe('notTraded')
    expect(classifyImportedFuturePick({ pickSeason: 2026, originalRosterId: 'seat-1', currentOwnerId: 'seat-2' }, map, 2027).kind).toBe('pastSeason')
    expect(classifyImportedFuturePick({ pickSeason: 2030, originalRosterId: 'seat-1', currentOwnerId: 'seat-2' }, map, null).kind).toBe('pastSeason')
  })
  it('still returns mapped ids for skipped rows, so an applier rewriting every row can use them', () => {
    expect(classifyImportedFuturePick({ pickSeason: 2026, originalRosterId: 'seat-1', currentOwnerId: 'seat-1' }, map, 2027))
      .toEqual({ kind: 'notTraded', originalRosterId: 'r1', currentOwnerId: 'r1' })
  })
})

describe('checkImportedSource', () => {
  it('refuses a native source, a missing source and a sport mismatch with one message', () => {
    for (const source of [null, { platform: 'manual', sport: 'NFL', settings: {}, season: 2026 }, { platform: 'sleeper', sport: 'NBA', settings: {}, season: 2026 }]) {
      expect(() => checkImportedSource(source, { sport: 'NFL' })).toThrow(/sport must match/)
    }
  })
  it('refuses MLB without the weekly-lineup confirmation', () => {
    expect(() => checkImportedSource({ platform: 'fantrax', sport: 'MLB', settings: {}, season: 2026 }, { sport: 'MLB' }))
      .toThrow(/Confirm weekly lineups/)
  })
})

describe('planImportedPlayerIdentity', () => {
  it('returns rosters and players index-aligned with the teams it was given', async () => {
    const plan = await planImportedPlayerIdentity(tx([
      { sleeperId: 's1', canonicalName: 'One', position: 'QB', currentTeam: 'BUF' },
      { sleeperId: 's2', canonicalName: 'Two', position: 'RB', currentTeam: 'NYG' },
    ]), { sport: 'NFL', platform: 'sleeper', teams: [team(2), team(1)], rosters: [roster(1, ['s1']), roster(2, ['s2'])] })
    expect(plan.sourceRosters.map((r) => r.id)).toEqual(['roster-2', 'roster-1'])
    expect(plan.sourcePlayerIdsByRoster).toEqual([['s2'], ['s1']])
    expect(plan.idMap.get('s1')).toBe('s1')
    expect(plan.playerDetails.get('s2')).toEqual({ name: 'Two', position: 'RB', team: 'NYG' })
  })
  it('refuses duplicate ownership and unverifiable players with the carryover error class', async () => {
    const dup = planImportedPlayerIdentity(tx([]), { sport: 'NFL', platform: 'sleeper', teams: [team(1), team(2)], rosters: [roster(1, ['s1']), roster(2, ['s1'])] })
    await expect(dup).rejects.toThrow(/duplicate player ownership/)
    await expect(dup).rejects.toBeInstanceOf(ImportedLeagueCarryoverError)
    await expect(planImportedPlayerIdentity(tx([]), { sport: 'NFL', platform: 'sleeper', teams: [team(1)], rosters: [roster(1, ['s9'])] }))
      .rejects.toThrow(/1 imported player IDs cannot be verified/)
  })
})

describe('carryOverImportedLeague keeps its refusal order and its exports', () => {
  it('re-exports the shared error class, so the creation route still recognises a refusal', () => {
    expect(carryover.ImportedLeagueCarryoverError).toBe(ImportedLeagueCarryoverError)
  })
  it('reports a team-count mismatch before it ever looks up a player', async () => {
    const t = {
      league: { findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === 'source' ? { platform: 'sleeper', sport: 'NFL', settings: {}, season: 2025 } : { settings: {}, season: 2026 }) },
      leagueTeam: { findMany: vi.fn().mockResolvedValue([team(1, { claimedByUserId: 'creator' }), team(2)]) },
      roster: { findMany: vi.fn().mockResolvedValue([roster(1, ['s1']), roster(2, ['s2'])]) },
      leagueEntrySlot: { findMany: vi.fn().mockResolvedValue([{ slotNumber: 1, rosterId: 'n1' }, { slotNumber: 2, rosterId: 'n2' }]) },
      draftSession: { findFirst: vi.fn().mockResolvedValue({ id: 'd' }) },
      playerIdentityMap: { findMany: vi.fn().mockResolvedValue([]) },
      player: { findMany: vi.fn().mockResolvedValue([]) },
    }
    await expect(carryover.carryOverImportedLeague(t as never, {
      sourceLeagueId: 'source', targetLeagueId: 'target', creatorUserId: 'creator', sport: 'NFL', teamCount: 3,
    })).rejects.toThrow(/Team count must match/)
    expect(t.playerIdentityMap.findMany).not.toHaveBeenCalled()
  })
})
