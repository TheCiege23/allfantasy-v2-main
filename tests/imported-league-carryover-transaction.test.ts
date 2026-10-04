import { describe, expect, it, vi } from 'vitest'
import { carryOverImportedLeague } from '@/lib/league-creation/canonical/carryOverImportedLeague'
import fixture from './fixtures/fantrax/mlb-points-public.json'

export function transaction() {
  const teams = [
    { id: 'source-team-1', externalId: 'seat-1', platformUserId: 'manager-1', claimedByUserId: 'creator', teamName: 'Aces', ownerName: 'Alice', avatarUrl: null, isCommissioner: true },
    { id: 'source-team-2', externalId: 'seat-2', platformUserId: 'manager-2', claimedByUserId: 'friend', teamName: 'Bears', ownerName: 'Bob', avatarUrl: null, isCommissioner: false },
  ]
  const rosters = [
    { id: 'source-roster-1', platformUserId: 'manager-1', playerData: { source_team_id: 'seat-1', players: ['sleeper-1'] }, faabRemaining: 50, waiverPriority: 1 },
    { id: 'source-roster-2', platformUserId: 'manager-2', playerData: { source_team_id: 'seat-2', players: ['sleeper-2'] }, faabRemaining: 75, waiverPriority: 2 },
  ]
  return {
    league: {
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) =>
        where.id === 'source' ? { platform: 'sleeper', sport: 'NFL' } : { settings: { existing: true } }),
      update: vi.fn(),
    },
    leagueTeam: { findMany: vi.fn().mockResolvedValue(teams), update: vi.fn().mockResolvedValue({ id: 'native-team' }) },
    leagueSeason: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    matchupFact: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    draftFact: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    transactionFact: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    seasonStandingFact: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    leagueDynastySeason: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    rosterSnapshot: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    seasonResult: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    leagueRosterConfig: { upsert: vi.fn() },
    leagueScoringOverride: { deleteMany: vi.fn(), createMany: vi.fn() },
    scoringSettingsSnapshot: { updateMany: vi.fn() },
    roster: {
      findMany: vi.fn().mockResolvedValue(rosters),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => ({ id: where.id, platformUserId: where.id })),
      update: vi.fn(),
    },
    leagueEntrySlot: {
      findMany: vi.fn().mockResolvedValue([{ slotNumber: 1, rosterId: 'native-roster-1' }, { slotNumber: 2, rosterId: 'native-roster-2' }]),
      updateMany: vi.fn(),
    },
    draftSession: { findFirst: vi.fn().mockResolvedValue({ id: 'native-draft' }), update: vi.fn() },
    draftPick: { createMany: vi.fn() },
    redraftLeagueMember: { create: vi.fn() },
    playerIdentityMap: { findMany: vi.fn().mockResolvedValue([
      { sleeperId: 'sleeper-1', canonicalName: 'First Player', position: 'QB', currentTeam: 'BUF' },
      { sleeperId: 'sleeper-2', canonicalName: 'Second Player', position: 'RB', currentTeam: 'NYG' },
    ]) },
    player: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

describe('standalone carryover transaction', () => {
  it('preserves source starter and bench placement without retaining the source draft marker', async () => {
    const tx = transaction()
    const sourceRosters = await tx.roster.findMany()
    tx.roster.findMany.mockResolvedValue(sourceRosters.map((roster, index) => ({ ...roster, playerData: {
      ...roster.playerData,
      starters: index === 0 ? ['sleeper-1'] : [],
      reserve: index === 1 ? ['sleeper-2'] : [],
      lineup_draft_session_id: 'source-draft',
    } })))
    await carryOverImportedLeague(tx as never, { sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2 })
    const carried = tx.roster.update.mock.calls.map(([args]) => args.data.playerData)
    expect(carried[0].starters).toEqual(['sleeper-1'])
    expect(carried[1].reserve).toEqual(['sleeper-2'])
    expect(carried.every(data => !('lineup_draft_session_id' in data))).toBe(true)
  })
  it('preserves MLB rules and history while translating owned players into native IDs', async () => {
    const tx = transaction()
    tx.league.findUnique.mockImplementation(({ where }) => where.id === 'source' ? {
      platform: 'fantrax', sport: 'MLB', season: 2026,
      settings: { scoringSettings: { format: 'points', rules: { hr: 1 } }, fantrax_settings: fixture.info },
    } : { settings: { existing: true } })
    tx.playerIdentityMap.findMany.mockResolvedValue([
      { fantraxId: 'sleeper-1', rollingInsightsId: 'native-1', canonicalName: 'First Player', position: 'OF', currentTeam: 'NYM' },
      { fantraxId: 'sleeper-2', rollingInsightsId: 'native-2', canonicalName: 'Second Player', position: 'SP', currentTeam: 'NYY' },
    ] as never)
    tx.matchupFact.findMany.mockResolvedValue([{ matchupId: 'old-matchup', leagueId: 'source', sport: 'MLB', season: 2026, weekOrPeriod: 12, teamA: 'seat-1', teamB: 'seat-2', scoreA: 10, scoreB: 8, winnerTeamId: 'seat-1' }] as never)
    tx.seasonResult.findMany.mockResolvedValue([{ id: 'source-result', leagueId: 'source', season: '2026', rosterId: 'seat-1', wins: 10, champion: true }] as never)
    expect(await carryOverImportedLeague(tx as never, { sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'MLB', teamCount: 2 })).toBe(2)
    expect(tx.roster.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerData: expect.objectContaining({ players: ['native-1'] }) }) }))
    expect(tx.leagueScoringOverride.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ statKey: 'home_run', pointsValue: 1 }),
      expect.objectContaining({ statKey: 'hold', pointsValue: 0 }),
    ]) })
    expect(tx.matchupFact.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ leagueId: 'native', season: 2026, scoreA: 10, scoreB: 8 })] })
    expect(tx.seasonResult.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ leagueId: 'native', season: '2026', rosterId: 'native-roster-1', wins: 10, champion: true })] })
    expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settings: expect.objectContaining({
      mlb_scoring_config: expect.objectContaining({ presetKey: 'custom', rules: expect.objectContaining({ home_runs: 1, holds: 0 }) }),
      mlb_roster_config: expect.objectContaining({ slots: expect.objectContaining({ UTIL: 1, P: 9, BN: 8 }) }),
      importCarryover: expect.objectContaining({ sourceSeason: 2026, history: expect.objectContaining({ matchups: 1 }) }),
    }) } }))
  })
  it('carries claimed manager seats and produces a completed native draft snapshot', async () => {
    const tx = transaction()
    const count = await carryOverImportedLeague(tx as never, {
      sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2,
    })
    expect(count).toBe(2)
    expect(tx.roster.update).toHaveBeenCalledTimes(2)
    expect(tx.leagueTeam.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ claimedByUserId: 'friend', teamName: 'Bears' }),
    }))
    expect(tx.redraftLeagueMember.create).toHaveBeenCalledWith({ data: {
      leagueId: 'native', userId: 'friend', role: 'MEMBER', teamNumber: 2,
    } })
    expect(tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', draftModeLabel: 'imported_rosters' }),
    }))
    expect(tx.draftPick.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ rosterId: 'native-roster-1', playerId: 'sleeper-1', source: 'import' }),
      expect.objectContaining({ rosterId: 'native-roster-2', playerId: 'sleeper-2', source: 'import' }),
    ] })
    expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { settings: expect.objectContaining({ existing: true, importCarryover: expect.objectContaining({ playerCount: 2, teamCount: 2 }) }) },
    }))
  })

  it('refuses an unmapped player before writing any target roster', async () => {
    const tx = transaction()
    tx.playerIdentityMap.findMany.mockResolvedValue([])
    await expect(carryOverImportedLeague(tx as never, {
      sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2,
    })).rejects.toThrow(/cannot be verified/)
    expect(tx.roster.update).not.toHaveBeenCalled()
    expect(tx.draftPick.createMany).not.toHaveBeenCalled()
  })

  it('does not reassign a commissioner seat claimed by a different manager', async () => {
    const tx = transaction()
    tx.leagueTeam.findMany.mockResolvedValue([
      { id: 'source-team-1', externalId: 'seat-1', platformUserId: 'manager-1', claimedByUserId: 'other-user', teamName: 'Aces', ownerName: 'Alice', avatarUrl: null, isCommissioner: true },
      { id: 'source-team-2', externalId: 'seat-2', platformUserId: 'manager-2', claimedByUserId: 'friend', teamName: 'Bears', ownerName: 'Bob', avatarUrl: null, isCommissioner: false },
    ])
    await expect(carryOverImportedLeague(tx as never, {
      sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2,
    })).rejects.toThrow(/Claim your commissioner team/)
    expect(tx.roster.update).not.toHaveBeenCalled()
  })
})

import espnFixture from '../contracts/espn/fixtures/fantasy-league.MLB.2026.json'
import { parseEspnMlbPayload } from '@/lib/league-import/espn/EspnMlbLeagueFetchService'
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn() }))
it('converts a fixture-based ESPN MLB category league with all teams and claimed managers', async () => {
  const raw = structuredClone(espnFixture) as any
  // Synthetic representable settings. The real captured custom league remains blocked.
  raw.settings.scoringSettings.scoringItems = [20,5,21,23,2,53,57,48,47,41].map(statId=>({statId,points:1,isReverseItem:[47,41].includes(statId)}))
  raw.settings.scoringSettings.matchupTieRule='NONE'
  delete raw.settings.scoringSettings.statQualificationMinimum
  delete raw.settings.rosterSettings.lineupSlotStatLimits
  raw.settings.rosterSettings.isBenchUnlimited=false
  const payload=parseEspnMlbPayload(raw,'MLB:2026:13262','fixture-manager-1')
  const tx=transaction()
  tx.league.findUnique.mockImplementation(({where})=>where.id==='source' ? {platform:'espn',sport:'MLB',season:2026,settings:{espn_settings:raw.settings,scoringSettings:{format:'H2H_MOST_CATEGORIES',rules:{}}}} as never : {season:2027,settings:{}})
  tx.leagueTeam.findMany.mockResolvedValue(payload.teams.map((t,i)=>({id:`source-${i}`,externalId:t.teamId,platformUserId:t.managerId,claimedByUserId:i===0?'creator':null,teamName:t.teamName,ownerName:t.managerName,avatarUrl:t.logoUrl,isCommissioner:i===0})) as never)
  tx.roster.findMany.mockResolvedValue(payload.teams.map((t,i)=>({id:`sr-${i}`,platformUserId:t.managerId,playerData:{source_team_id:t.teamId,players:t.rosterPlayerIds,starters:t.starterPlayerIds,reserve:t.reservePlayerIds},faabRemaining:t.faabRemaining,waiverPriority:t.waiverPriority})) as never)
  tx.leagueEntrySlot.findMany.mockResolvedValue(payload.teams.map((t,i)=>({slotNumber:i+1,rosterId:`native-${i}`})))
  tx.playerIdentityMap.findMany.mockResolvedValue(payload.teams.flatMap(t=>Object.entries(t.playerMap).map(([id,p])=>({espnId:id,rollingInsightsId:`ri-${id}`,canonicalName:p.name,position:p.position,currentTeam:p.team}))) as never)
  expect(await carryOverImportedLeague(tx as never,{sourceLeagueId:'source',targetLeagueId:'native',creatorUserId:'creator',sport:'MLB',teamCount:12})).toBe(395)
  expect(tx.roster.update).toHaveBeenCalledTimes(12)
  expect(tx.draftPick.createMany.mock.calls[0][0].data).toHaveLength(395)
  expect(tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'completed',draftModeLabel:'imported_rosters'})}))
  expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({data:{settings:expect.objectContaining({scoring_mode:'h2h_category',category_preset_id:'mlb_5x5',category_record_mode:'most',roster:expect.objectContaining({irSlots:4,benchSlots:10})})}}))
})
