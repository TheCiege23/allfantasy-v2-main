import { describe, expect, it, vi } from 'vitest'
import { carryOverImportedLeague } from '@/lib/league-creation/canonical/carryOverImportedLeague'
import fixture from './fixtures/fantrax/mlb-points-public.json'
import { consumeNativeFuturePicksForDraft } from '@/lib/league-trade-engine/nativeFuturePicks'

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
    expect(await carryOverImportedLeague(tx as never, { sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'MLB', teamCount: 2, acceptWeeklyLineups: true })).toBe(2)
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
  expect(await carryOverImportedLeague(tx as never,{sourceLeagueId:'source',targetLeagueId:'native',creatorUserId:'creator',sport:'MLB',teamCount:12,acceptWeeklyLineups:true})).toBe(395)
  expect(tx.roster.update).toHaveBeenCalledTimes(12)
  expect(tx.draftPick.createMany.mock.calls[0][0].data).toHaveLength(395)
  expect(tx.draftSession.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'completed',draftModeLabel:'imported_rosters'})}))
  expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({data:{settings:expect.objectContaining({scoring_mode:'h2h_category',category_preset_id:'mlb_5x5',category_record_mode:'most',roster:expect.objectContaining({irSlots:4,benchSlots:10})})}}))
})

it('requires explicit weekly-lineup acceptance before any native MLB roster writes', async () => {
  const tx = transaction()
  tx.league.findUnique.mockImplementation(({where}) => where.id === 'source' ? {platform:'espn',sport:'MLB',settings:{}} : {settings:{}})
  await expect(carryOverImportedLeague(tx as never,{sourceLeagueId:'source',targetLeagueId:'native',creatorUserId:'creator',sport:'MLB',teamCount:2})).rejects.toThrow('Confirm weekly lineups')
  expect(tx.roster.update).not.toHaveBeenCalled()
})

/**
 * A dynasty carryover used to drop every traded future pick: imported picks are keyed by provider
 * team ids, the native league reads the same table keyed by Roster.id, and nothing moved them across.
 */
describe('standalone carryover of traded future picks', () => {
  type PickRow = { leagueId: string; pickSeason: number; round: number; originalRosterId: string; currentOwnerId: string; status: string; traded: boolean; tradedAt: Date | null; id?: string }
  const sourceRows: PickRow[] = [
    { leagueId: 'source', pickSeason: 2027, round: 1, originalRosterId: 'seat-1', currentOwnerId: 'seat-2', status: 'active', traded: true, tradedAt: null },
    { leagueId: 'source', pickSeason: 2028, round: 2, originalRosterId: 'seat-2', currentOwnerId: 'seat-1', status: 'active', traded: true, tradedAt: null },
    // Unmappable: a team that is not in the carried league.
    { leagueId: 'source', pickSeason: 2027, round: 3, originalRosterId: 'seat-9', currentOwnerId: 'seat-1', status: 'active', traded: true, tradedAt: null },
    // Holder is the original team: not a trade.
    { leagueId: 'source', pickSeason: 2027, round: 2, originalRosterId: 'seat-1', currentOwnerId: 'seat-1', status: 'active', traded: true, tradedAt: null },
    // The carried season's own draft is the imported roster snapshot: no native draft will consume it.
    { leagueId: 'source', pickSeason: 2026, round: 1, originalRosterId: 'seat-2', currentOwnerId: 'seat-1', status: 'active', traded: true, tradedAt: null },
    // Already used by the source league's own draft.
    { leagueId: 'source', pickSeason: 2028, round: 1, originalRosterId: 'seat-2', currentOwnerId: 'seat-1', status: 'used', traded: true, tradedAt: null },
  ]

  function withPicks(target: { platform: string; leagueType: string; isDynasty: boolean }) {
    const tx = transaction() as ReturnType<typeof transaction> & Record<string, any>
    const store: PickRow[] = sourceRows.map((row) => ({ ...row }))
    tx.league.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === 'source' ? { platform: 'sleeper', sport: 'NFL', season: 2026 } : { ...target, season: 2026, settings: { existing: true } })
    // The carried draft is completed by the time the horizon is read, so no draft is open.
    tx.draftSession.findFirst.mockImplementation((args: { where?: { status?: unknown } }) => args?.where?.status ? null : { id: 'native-draft' })
    tx.redraftSeason = { findFirst: vi.fn().mockResolvedValue(null) }
    const matches = (where: Record<string, unknown>, row: PickRow) =>
      Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
    tx.futureDraftPick = {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        store.filter((row) => matches(where, row)).map((row, i) => ({ id: row.id ?? `row-${i}`, ...row }))),
      createMany: vi.fn(async ({ data }: { data: PickRow[] }) => {
        for (const row of data) store.push({ ...row, id: `native-${store.length}` })
        return { count: data.length }
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    }
    return { tx, store }
  }
  const carry = (tx: unknown) => carryOverImportedLeague(tx as never, { sourceLeagueId: 'source', targetLeagueId: 'native', creatorUserId: 'creator', sport: 'NFL', teamCount: 2 })

  it('copies traded picks into the native league with roster ids remapped', async () => {
    const { tx } = withPicks({ platform: 'manual', leagueType: 'dynasty', isDynasty: true })
    await carry(tx)
    expect(tx.futureDraftPick.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'source', status: 'active' } }))
    expect(tx.futureDraftPick.createMany).toHaveBeenCalledTimes(1)
    const [{ data, skipDuplicates }] = tx.futureDraftPick.createMany.mock.calls[0]
    expect(skipDuplicates).toBe(true)
    expect(data).toEqual([
      { leagueId: 'native', pickSeason: 2027, round: 1, originalRosterId: 'native-roster-1', currentOwnerId: 'native-roster-2', traded: true, status: 'active', sourceTradeId: null, tradedAt: null },
      { leagueId: 'native', pickSeason: 2028, round: 2, originalRosterId: 'native-roster-2', currentOwnerId: 'native-roster-1', traded: true, status: 'active', sourceTradeId: null, tradedAt: null },
    ])
    expect(tx.league.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settings: expect.objectContaining({
      importCarryover: expect.objectContaining({ futurePickCount: 2, futurePicksSkipped: 3 }),
    }) } }))
  })

  it('skips unmappable, untraded and already-drafted-season rows rather than inventing picks', async () => {
    const { tx } = withPicks({ platform: 'manual', leagueType: 'dynasty', isDynasty: true })
    await carry(tx)
    const data = tx.futureDraftPick.createMany.mock.calls[0][0].data as PickRow[]
    expect(data).toHaveLength(2)
    expect(data.some((row) => row.round === 3)).toBe(false)
    expect(data.some((row) => row.originalRosterId === row.currentOwnerId)).toBe(false)
    expect(data.some((row) => row.pickSeason === 2026)).toBe(false)
    expect(data.every((row) => row.originalRosterId.startsWith('native-roster-') && row.currentOwnerId.startsWith('native-roster-'))).toBe(true)
  })

  it('copies no picks into a redraft carryover', async () => {
    const { tx } = withPicks({ platform: 'manual', leagueType: 'redraft', isDynasty: false })
    await carry(tx)
    expect(tx.futureDraftPick.findMany).not.toHaveBeenCalled()
    expect(tx.futureDraftPick.createMany).not.toHaveBeenCalled()
    // Guard against the vacuous pass: the carryover itself ran to completion.
    expect(tx.league.update).toHaveBeenCalledTimes(1)
    expect(tx.league.update.mock.calls[0][0].data.settings.importCarryover).not.toHaveProperty('futurePickCount')
  })

  it('writes rows the native rookie draft consumes for their new holders', async () => {
    const { tx } = withPicks({ platform: 'manual', leagueType: 'dynasty', isDynasty: true })
    await carry(tx)
    const slotOrder = [
      { slot: 1, rosterId: 'native-roster-1', userId: null, displayName: 'Aces' },
      { slot: 2, rosterId: 'native-roster-2', userId: null, displayName: 'Bears' },
    ]
    const traded = await consumeNativeFuturePicksForDraft(tx as never, { leagueId: 'native', season: 2027, draftSessionId: 'rookie-2027', rounds: 4, slotOrder: slotOrder as never })
    expect(traded).toEqual([
      { round: 1, originalRosterId: 'native-roster-1', previousOwnerName: 'Aces', newRosterId: 'native-roster-2', newOwnerName: 'Bears', season: '2027' },
    ])
  })
})
