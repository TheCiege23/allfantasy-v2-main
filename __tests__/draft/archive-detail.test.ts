import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ gate: vi.fn(), commissioner: vi.fn(), catalog: vi.fn(), session: vi.fn(), audit: vi.fn(), events: vi.fn(), corrections: vi.fn(), picks: vi.fn(), trades: vi.fn(), executions: vi.fn(), raw: vi.fn(), teams: vi.fn(), any: vi.fn(async () => []), one: vi.fn(async () => null), results: vi.fn() }))
vi.mock('@/lib/draft-archive/importedResults', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/draft-archive/importedResults')>(), readImportedResults: db.results }))
vi.mock('@/server/services/permissionService', () => ({ canViewLeague: db.gate, isElevatedCommissioner: db.commissioner }))
vi.mock('@/lib/core-app/draftHq', () => ({ resolvePlayerNames: vi.fn(async () => new Map()) }))
vi.mock('@/lib/draft-archive/catalog', () => ({ draftArchiveCatalog: db.catalog }))
vi.mock('@/lib/draft-archive/ledger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/draft-archive/ledger')>();
  return { ...actual, archiveLedger: async (_db: unknown, _league: string, _session: string, options: { take?: number }) => {
    if (options.take === 101) return db.events(options);
    const row = await db.audit(options);
    return row ? [row] : [];
  } };
})
vi.mock('@/lib/prisma', () => ({ prisma: {
  draftSession: { findFirst: db.session }, leagueAuditLog: { findFirst: db.audit, findMany: db.events },
  draftPickAuditLog: { findMany: db.corrections }, draftPick: { findMany: db.picks }, draftPickTradeProposal: { findMany: db.trades },
  tradeExecutionSnapshot: { findMany: db.executions },
  $queryRaw: db.raw, leagueTeam: { findMany: db.teams }, transactionFact: { findMany: db.any }, league: { findUnique: db.one },
  leagueDynastySeason: { findFirst: db.one }, playerIdentityMap: { findMany: db.any }, weeklyScore: { findMany: db.any }, teamWeekResult: { findMany: db.any }, sportsGame: { findMany: db.any, findFirst: db.one },
} }))
import { draftArchiveDetail } from '@/lib/draft-archive/detail'
beforeEach(() => {
  vi.resetAllMocks()
  db.gate.mockResolvedValue(true)
  db.commissioner.mockResolvedValue(false)
  db.catalog.mockResolvedValue({ choices: [{ key: 'native:d', source: 'native', sourceId: 'd', format: 'snake', sport: 'NFL', season: 2026 }] })
  db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'pre_draft', startedAt: null })
  db.audit.mockResolvedValue(null)
  db.events.mockResolvedValue([])
  db.picks.mockResolvedValue([])
  db.trades.mockResolvedValue([])
  db.executions.mockResolvedValue([])
})
describe('draft archive authorization and attempt boundaries', () => {
  it('shows executed player packages in the draft window without exposing private metadata', async () => {
    const startedAt = new Date('2026-09-01'), completedAt = new Date('2026-09-02')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'completed', startedAt, completedAt })
    db.executions.mockResolvedValue([{ tradeId: 'trade', executedAt: startedAt, completeness: 'complete', reversal: null, assetSummary: { items: 1, assets: [{ itemType: 'player', itemReference: 'player-id', fromRosterId: 'a', toRosterId: 'b', metadata: { playerName: 'Recorded player', privateNote: 'secret' } }] } }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(db.executions.mock.calls[0][0].where).toEqual({ leagueId: 'l', executedAt: { gte: startedAt, lte: completedAt } })
    expect(result?.playerTrades).toMatchObject([{ assets: [{ assetType: 'player', playerId: 'player-id', playerName: 'Recorded player' }] }])
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('denies access before reading private archive data', async () => {
    db.gate.mockResolvedValue(false)
    expect(await draftArchiveDetail('l', 'stranger', 'native:d')).toBeNull()
    expect(db.catalog).not.toHaveBeenCalled()
    expect(db.session).not.toHaveBeenCalled()
  })
  it('a reset unstarted draft cannot inherit its previous attempt snapshot or clock', async () => {
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'pre_draft', startedAt: new Date('2025-09-01'), completedAt: new Date('2025-09-02') })
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(result?.startedAt).toBeNull()
    expect(result?.activeMs).toBeNull()
    expect(result?.endedAt).toBeNull()
    expect(db.audit).not.toHaveBeenCalled()
    expect(db.events).not.toHaveBeenCalled()
    expect(db.corrections).not.toHaveBeenCalled()
    expect(db.trades.mock.calls[0][0].where.respondedAt).toBeUndefined()
  })
  it('bounds timeline reads to the selected attempt and hides private correction notes', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'in_progress', startedAt })
    db.audit.mockResolvedValue({ createdAt: startedAt, afterState: { event: 'start', details: { secret: 'private-note' }, clock: { complete: true, totalActiveMs: 100 } } })
    db.events.mockResolvedValue([{ createdAt: startedAt, afterState: { event: 'pause', details: { reason: 'private-note' } } }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(db.audit.mock.calls[0][0].startAt).toEqual(startedAt.toISOString())
    expect(db.events.mock.calls[0][0].fromTime).toEqual(startedAt)
    expect(JSON.stringify(result)).not.toContain('private-note')
    expect(db.corrections).not.toHaveBeenCalled()
  })
  it('names the managers of an imported draft from the league, never by raw provider id', async () => {
    // Live /core 2026-11-06: Selected by read "100561289762" and the receiving team a bare roster number.
    db.catalog.mockResolvedValue({ choices: [{ key: 'imported:139', source: 'imported', sourceId: '139', format: 'snake', sport: 'NFL', season: 2026 }] })
    db.raw.mockResolvedValue([
      { draftId: 'f1', pickNumber: 1, round: 1, playerId: '4034', metadata: { provider: 'sleeper', selectionRosterId: '8', providerPickedBy: '100561289762', originalDraftSlot: 1, playerSnapshot: { name: 'Bijan Robinson', position: 'RB' }, archiveDraft: { slotToRosterId: { 1: 1 }, observedSeasonRosters: [{ roster_id: 8, owner_id: '100561289762' }, { roster_id: 1, owner_id: 'u1', metadata: { team_name: 'Recorded Sleeper name' } }] } } },
      { draftId: 'f2', pickNumber: 2, round: 1, playerId: '9', metadata: { provider: 'sleeper', selectionRosterId: '5', providerPickedBy: 'stranger', originalDraftSlot: 2, playerSnapshot: { name: 'Other', position: 'WR' } } },
    ])
    db.teams.mockResolvedValue([{ platformUserId: '100561289762', ownerName: 'GuapCiege', teamName: 'Maye Day' }, { platformUserId: 'u1', ownerName: 'One', teamName: 'Current name' }])
    const result = await draftArchiveDetail('l', 'viewer', 'imported:139')
    expect(db.teams).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'l', platformUserId: { not: null } } }))
    expect(result?.picks[0]).toMatchObject({ actor: '100561289762', actorName: 'GuapCiege', teamName: 'Maye Day', originalTeamName: 'Recorded Sleeper name' })
    expect(result?.picks[1]).toMatchObject({ actorName: null, teamName: null })
  })
  it('names the teams in stored results the same way, keeping a placeholder only where nobody is known', async () => {
    // Live /core 2026-11-06: Results to date listed "Team 8", "Team 5"… because ingestion stores 'Team ' + rosterId.
    db.catalog.mockResolvedValue({ choices: [{ key: 'imported:139', source: 'imported', sourceId: '139', format: 'snake', sport: 'NFL', season: 2026 }] })
    db.raw.mockResolvedValue([{ draftId: 'f1', pickNumber: 1, round: 1, playerId: '4034', metadata: { provider: 'sleeper', selectionRosterId: '8', playerSnapshot: { name: 'Bijan Robinson', position: 'RB' }, archiveDraft: { observedSeasonRosters: [{ roster_id: 8, owner_id: 'u8' }, { roster_id: 3, owner_id: 'u3' }] } } }])
    db.teams.mockResolvedValue([{ platformUserId: 'u8', ownerName: 'GuapCiege', teamName: 'Maye Day' }, { platformUserId: 'u3', ownerName: 'Three', teamName: 'Never used' }])
    const team = (rosterId: string, name: string) => ({ rosterId, name, rank: 1, points: 1, starterPoints: 1, starts: 1, weeks: [1], coveredPicks: 1 })
    db.results.mockResolvedValue({ observedAt: '2026-11-01T00:00:00.000Z', report: { state: 'ready', provisional: true, coverage: 'c', teams: [team('8', 'Team 8'), team('5', 'Team 5'), team('3', 'Recorded name')] } })
    const result = await draftArchiveDetail('l', 'viewer', 'imported:139')
    expect(result?.resultsReport?.teams.map(t => t.name)).toEqual(['Maye Day', 'Team 5', 'Recorded name'])
  })
  it('uses recorded team and actor names without loading current roster identities', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'completed', startedAt })
    db.audit.mockResolvedValue({ createdAt: startedAt, afterState: { snapshot: { session: { slotOrder: [{ rosterId: 'original', displayName: 'Original recorded team' }] }, teams: [{ claimedByUserId: 'actor', ownerName: 'Recorded manager' }] } } })
    db.picks.mockResolvedValue([{ id: 'p', overall: 1, round: 1, slot: 1, originalRosterId: 'original', rosterId: 'receiver', displayName: 'Receiving recorded team', ownerUserId: 'actor', playerName: 'Player', position: 'QB' }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(result?.picks[0]).toMatchObject({ originalTeamName: 'Original recorded team', actorName: 'Recorded manager', teamName: 'Receiving recorded team' })
    expect(db.teams).not.toHaveBeenCalled()
  })
  it('bounds a reset attempt by mutation sequence when its observed timestamp moved backward', async () => {
    const startedAt = new Date('2026-09-01T00:00:10Z');
    db.catalog.mockResolvedValue({ choices: [{ key: 'reset:r', source: 'reset', sourceId: 'r', format: 'snake', sport: 'NFL', season: 2026 }] });
    const start = { createdAt: startedAt, afterState: { sequence: 10, event: 'start' } };
    db.audit.mockImplementation(async options => options.where?.id === 'r'
      ? { createdAt: new Date('2026-09-01T00:00:09Z'), afterState: { sequence: 20, details: { priorSession: { id: 'd', status: 'in_progress', startedAt: startedAt.toISOString() }, archivedPicks: [] } } }
      : start);
    await draftArchiveDetail('l', 'viewer', 'reset:r');
    expect(db.audit.mock.calls[1][0]).toMatchObject({ event: 'start', startAt: startedAt.toISOString(), beforeSequence: 20 });
    expect(db.events.mock.calls[0][0]).toMatchObject({ fromSequence: 10, beforeSequence: 20 });
  })
})
