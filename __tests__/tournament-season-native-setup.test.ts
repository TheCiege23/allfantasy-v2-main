vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: () => {}, recordAnalyticsEvent: async () => {}, recordAnalyticsEventAsync: () => {} }))
vi.mock('@/lib/player-trend/signal-integration', () => ({ recordTrendSignalByPlayerId: async () => {} }))
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: async () => {} }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: async () => null }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { assertLifecycleActionAllowed } from '@/server/services/leagueLifecycleService'
import { resolveBestAvailableAutopickCandidate } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { tryQueueAutoPick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { requireCommissionerRole } from '@/lib/league/permissions'
import { completeConfig } from './helpers/seasonTournamentFixture'
const mock = vi.hoisted(() => ({ db: {} as any, transaction: vi.fn(), pool: vi.fn(), lockDepth: 0 }))
vi.mock('@/lib/automation/locks', () => ({ acquireAutomationLock: vi.fn(async () => ({ ok: true, backend: 'postgres' })), releaseAutomationLock: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({ prisma: mock.db }))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ getResolvedDraftPoolForLeague: mock.pool }))
vi.mock('@/lib/draft/draftLock', () => ({ withPickLock: async (_id: string, run: any) => ({ acquired: true, value: await run() }), withControlLock: async (_id: string, run: any) => ({ acquired: true, value: await run() }), withAuctionLock: async (_id: string, run: any) => { mock.lockDepth++; try { return { acquired: true, value: await run() } } finally { mock.lockDepth-- } } }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: async () => ({ autoPickEnabled: true, auctionAutoNominationEnabled: true, orphanTeamAiManagerEnabled: false }) }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', async original => ({ ...await original<typeof import('@/lib/live-draft-engine/RosterAssignmentService')>(), appendPickToRosterDraftSnapshot: async () => {} }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: async () => true }))
vi.mock('@/lib/domain/db', () => ({ withTenant: mock.transaction }))
import { buildOpeningField } from '@/lib/tournament/seasonOpeningField'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { readOpeningManifest } from '@/lib/tournament/seasonNativeContract'
import { provisionNextSeasonLeague, loadSeasonNativeSetup } from '@/lib/tournament/seasonNativeProvisioning'
import { checkSeasonDraftReadiness } from '@/lib/tournament/seasonDraftReadiness'
import { validateSeasonDraftPlayer, loadSeasonDraftPlayers, readSeasonDraftSnapshot } from '@/lib/tournament/seasonDraftRuntime'
import { refreshSeasonDraftPool } from '@/lib/tournament/seasonDraftRefresh'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
let rows: Record<string, any[]>, shell: any, sequence: number
const clone = <T,>(v: T): T => structuredClone(v)
const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([k, v]: any) => v && typeof v === 'object' && 'equals' in v ? JSON.stringify(row[k]) === JSON.stringify(v.equals) : v?.in ? v.in.includes(row[k]) : v?.gt instanceof Date ? row[k] > v.gt : v?.lte instanceof Date ? row[k] <= v.lte : v instanceof Date ? row[k]?.getTime() === v.getTime() : row[k] === v)
const config = () => completeConfig()
function freeze() {
  const c = config()
  const entries = Array.from({ length: c.participants }, (_, i) => ({ id: 'p' + i, userId: 'u' + i, displayName: 'Team ' + i, avatarUrl: null }))
  const data = { ...buildOpeningField(c, entries, n => n - 1), hashAlgorithm: 'canonical_sha256_v1', publicationId: 'pub1', rulesHash: 'rules-hash', config: c }
  return { ...data, manifestHash: seasonContractHash(data) }
}
beforeEach(() => {
  vi.restoreAllMocks(); mock.lockDepth = 0; vi.stubEnv('COMMISH_TENANT_ID', 'tenant-test')
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:00:00Z'))
  mock.pool.mockReset().mockResolvedValue({ sport: 'NBA', rosterConfigurationIncomplete: false, entries: Array.from({ length: 300 }, (_, i) => ({ playerId: 'player-' + i, name: 'Player ' + i, position: ['PG', 'SG', 'SF', 'PF', 'C'][i % 5], team: 'TEST', adp: i + 1 })) })
  shell = { id: 't1', commissionerId: 'owner', status: 'rules_published', updatedAt: new Date('2026-10-12T12:00:00Z') }; sequence = 0
  rows = {}
  for (const name of ['playerProviderIdentity', 'gameProviderIdentity', 'sportsPlayer', 'leagueAuditLog', 'league', 'roster', 'leagueSettings', 'leagueTeam', 'leagueEntrySlot', 'redraftLeagueMember', 'leagueWaiverSettings', 'leagueWaiverState', 'leagueScoringOverride', 'draftSession', 'draftPick', 'tournamentRound', 'tournamentLeague', 'tournamentLeagueParticipant', 'tournamentParticipant', 'tournamentAuditLog']) {
    rows[name] = []
    mock.db[name] = {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        const result = rows[name]!.filter(row => matches(row, where))
        if (orderBy?.waiverPriority === 'desc') result.sort((a, b) => b.waiverPriority - a.waiverPriority)
        return clone(result)
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const result = rows[name]!.filter(row => matches(row, where))
        for (const order of (Array.isArray(orderBy) ? [...orderBy].reverse() : [orderBy])) {
          if (!order) continue
          const [key, direction] = Object.entries(order)[0] as [string, string]
          result.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'desc' ? -1 : 1))
        }
        return clone(result[0] ?? null)
      }),
      findUnique: vi.fn(async ({ where }: any) => clone(rows[name]!.find(row => matches(row, where)) ?? null)),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: 'auto-' + ++sequence, createdAt: new Date(Date.now()), ...(name === 'draftSession' ? { version: 1 } : {}), ...data }
        if (rows[name]!.some(r => r.id === row.id)) throw new Error('duplicate id')
        rows[name]!.push(clone(row)); if (name === 'draftPick') rows.draftSession!.find(s => s.id === row.sessionId)?.picks.push(clone(row)); return clone(row)
      }),
      createMany: vi.fn(async ({ data }: any) => { rows[name]!.push(...clone(data)); return { count: data.length } }),
      update: vi.fn(async ({ where, data }: any) => { const row = rows[name]!.find(row => matches(row, where)); if (!row) throw new Error('missing row'); for (const [key, value] of Object.entries(data) as any) row[key] = value?.increment ? row[key] + value.increment : clone(value); return clone(row) }),
      updateMany: vi.fn(async ({ where, data }: any) => { const matching = rows[name]!.filter(r => matches(r, where)); for (const row of matching) for (const [key, value] of Object.entries(data) as any) row[key] = value?.increment ? row[key] + value.increment : clone(value); return { count: matching.length } }),
      upsert: vi.fn(async ({ create }: any) => { const existing = rows[name]!.find(row => row.tournamentId === create.tournamentId && row.roundNumber === create.roundNumber); if (existing) return clone(existing); rows[name]!.push(clone(create)); return clone(create) }),
    }
  }
  const manifest = freeze()
  rows.tournamentAuditLog = [{ id: 'f1', tournamentId: 't1', action: 'season_opening_field_frozen', data: manifest }, { id: 'pub1', tournamentId: 't1', action: 'season_rules_published', data: { hash: 'rules-hash', config: config() } }]
  rows.tournamentParticipant = manifest.leagues.flatMap(l => l.members).map(m => ({ ...m, tournamentId: 't1', status: 'registered' }))
  mock.db.tournamentShell = { findUnique: vi.fn(async ({ where }: any) => where.id === 't1' ? clone(shell) : null), updateMany: vi.fn(async ({ where, data }: any) => { if (!matches(shell, where)) return { count: 0 }; Object.assign(shell, data); return { count: 1 } }) }
  mock.db.$queryRaw = vi.fn(async () => [])
  mock.db.$transaction = (run: any) => mock.transaction('tenant-test', run)
  let tail = Promise.resolve()
  mock.transaction.mockReset().mockImplementation(async (_tenant: string, run: any) => {
    const prior = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve }); await prior
    const snapshot = clone({ rows, shell })
    try { return await run(mock.db) } catch (e) { rows = snapshot.rows; shell = snapshot.shell; throw e } finally { release() }
  })
})
const provision = (key?: string) => provisionNextSeasonLeague('owner', 't1', 'f1', key)
describe('native opening setup', () => {
  it('creates exactly the frozen teams, exact scoring and blocked drafts without an organizer team', async () => {
    expect(await provision()).toMatchObject({ created: true, completed: 1, total: 8, launchReady: false })
    const manifest = readOpeningManifest(rows.tournamentAuditLog![0].data), pool = manifest.leagues[0]!
    expect(rows.league![0]).toMatchObject({ tenantId: 'tenant-test', userId: 'owner', sport: 'NBA', locked: true })
    expect(rows.roster).toHaveLength(pool.slots)
    expect(rows.roster!.some(r => r.platformUserId === 'owner')).toBe(false)
    expect(rows.redraftLeagueMember!.find(m => m.userId === 'owner')).toMatchObject({ role: 'COMMISSIONER' })
    expect(rows.redraftLeagueMember!.find(m => m.userId === 'owner').teamNumber).toBeUndefined()
    expect(rows.draftSession![0]).toMatchObject({ status: 'tournament_setup_blocked', rounds: 12, teamCount: pool.slots, sportType: 'NBA', timerSeconds: 90 })
    for (const weight of config().rules.weights) expect(rows.leagueScoringOverride!.find(w => w.statKey === weight.statKey)?.pointsValue).toBe(weight.points)
    expect(rows.leagueWaiverState![0].processingLocked).toBe(true)
    expect(rows.roster![0]).toMatchObject({ faabRemaining: 100, waiverPriority: pool.slots })
    expect(rows.league![0].settings.nba_roster_config.slots).toMatchObject({ PG: 1, UTIL: 1, BN: 4, IR: 2 })
    expect((await loadSeasonNativeSetup('owner', 't1'))?.scoringSource).toMatchObject({ source: 'Rolling Insights NBA box', boxContractReady: false, launchReady: false, missing: ['technical_foul', 'flagrant_foul'] })
  })
  it('resumes all pools and reconciles repeated requests without duplicating records', async () => {
    for (let i = 0; i < 8; i++) await provision()
    const before = rows.roster!.length
    expect(await provision()).toMatchObject({ complete: true, created: false, completed: 8 })
    expect(await provision('stage-1-league-1')).toMatchObject({ created: false })
    expect(rows.roster).toHaveLength(before)
    expect(rows.league).toHaveLength(8)
    expect(rows.tournamentRound).toHaveLength(1)
    expect((await loadSeasonNativeSetup('owner', 't1'))?.leagues.every(l => l.state === 'created')).toBe(true)
  })
  it('rolls back a mid-league failure, saves a safe failure checkpoint and retries cleanly', async () => {
    mock.db.draftSession.create.mockRejectedValueOnce(new Error('database secret must not enter audit'))
    await expect(provision()).rejects.toThrow('database secret')
    expect(rows.league).toHaveLength(0); expect(rows.roster).toHaveLength(0); expect(rows.tournamentRound).toHaveLength(0)
    expect(JSON.stringify(rows.tournamentAuditLog)).not.toContain('database secret')
    expect((await loadSeasonNativeSetup('owner', 't1'))?.leagues[0]?.state).toBe('retry_needed')
    await provision()
    expect(rows.league).toHaveLength(1); expect(rows.roster).toHaveLength(8)
    expect(rows.league![0].id).toBe(seasonResourceId('f1', 'stage-1-league-1'))
  })
  it('serializes competing attempts for one pool', async () => {
    const results = await Promise.all([provision('stage-1-league-1'), provision('stage-1-league-1')])
    expect(results.map(r => r.created)).toEqual([true, false])
    expect(rows.league).toHaveLength(1)
  })
  it('blocks outsiders, unknown pools, forged freeze IDs and missing tenant identity', async () => {
    await expect(provisionNextSeasonLeague('other', 't1', 'f1')).rejects.toMatchObject({ status: 403 })
    await expect(provision('foreign-key')).rejects.toMatchObject({ status: 404 })
    await expect(provisionNextSeasonLeague('owner', 't1', 'foreign-freeze')).rejects.toMatchObject({ status: 409 })
    vi.stubEnv('COMMISH_TENANT_ID', '')
    await expect(provision()).rejects.toMatchObject({ status: 409 })
    expect(rows.league).toHaveLength(0)
  })
  it('checks hash independently of JSON key ordering and refuses tampering', async () => {
    const raw = rows.tournamentAuditLog![0].data
    rows.tournamentAuditLog![0].data = Object.fromEntries(Object.entries(raw).reverse())
    await provision()
    rows.tournamentAuditLog![0].data.leagues[1].members[0].userId = 'forged'
    await expect(provision()).rejects.toThrow('checksum')
    expect(rows.league).toHaveLength(1)
  })
  it('refuses contract mismatch and changes to frozen entrants', async () => {
    rows.tournamentParticipant![0].status = 'withdrawn'
    await expect(provision()).rejects.toThrow('entrant has changed')
    rows.tournamentParticipant![0].status = 'registered'
    rows.tournamentAuditLog![1].data.config.rules.bench = 5
    await expect(provision()).rejects.toThrow('published contract')
  })
  it('detects native draft and roster drift without overwriting it', async () => {
    await provision()
    rows.draftSession![0].timerSeconds = 1
    await expect(provision('stage-1-league-1')).rejects.toThrow('drifted')
    expect(rows.draftSession![0].timerSeconds).toBe(1)
  })
  it('retries CAS contention and refuses persistent contention', async () => {
    mock.db.tournamentShell.updateMany.mockResolvedValueOnce({ count: 0 })
    await provision()
    mock.db.tournamentShell.updateMany.mockResolvedValue({ count: 0 })
    await expect(provision()).rejects.toMatchObject({ status: 409 })
    expect(rows.league).toHaveLength(1)
  })
  it('allows reconciliation after the scheduled draft but blocks unfinished new creation', async () => {
    await provision()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'))
    await expect(provision('stage-1-league-1')).resolves.toMatchObject({ created: false })
    await expect(provision()).rejects.toThrow('window has started')
  })
})


describe('native variants and launch isolation', () => {
  function replaceContract(c: ReturnType<typeof completeConfig>) {
    const raw = rows.tournamentAuditLog![0].data
    raw.config = c
    const { manifestHash: _old, ...payload } = raw
    raw.manifestHash = seasonContractHash(payload)
    rows.tournamentAuditLog![1].data.config = clone(c)
  }
  it('maps NFL roster/scoring, auction terms and rolling waivers', async () => {
    const nba = completeConfig(), base = defaultSeasonBlueprint('NFL')
    const r = defaultSeasonRules('NFL', 'ppr')
    const periods = nba.rules.calendar.periods.slice(0, 17)
    r.calendar = { ...nba.rules.calendar, periods, drafts: [nba.rules.calendar.drafts[0]!, ...[6, 13].map((cut, index) => ({ stage: index + 2, startsAt: periods[cut - 1]!.finalizesAt, completeBy: new Date(Date.parse(periods[cut]!.startsAt) - 12 * 3600000).toISOString() }))] }
    const c = { ...base, name: 'NFL Pilot', rules: r, redraftBufferHours: 12, draftType: 'auction' as const }
    c.rules.waivers.mode = 'rolling_priority'; c.rules.draftPolicy!.auctionBudget = 300
    replaceContract(c as ReturnType<typeof completeConfig>)
    await provision()
    expect(rows.league![0]).toMatchObject({ sport: 'NFL', rosterSize: 15 })
    expect(rows.league![0].settings.nfl_roster_config.slots).toMatchObject({ QB: 1, RB: 2, BN: 6, IR: 2 })
    expect(rows.draftSession![0]).toMatchObject({ draftType: 'auction', auctionBudgetPerTeam: 300, rounds: 15, sportType: 'NFL' })
    expect(rows.leagueWaiverSettings![0]).toMatchObject({ waiverType: 'rolling', faabBudget: null })
    expect(rows.roster![0].faabRemaining).toBeNull()
  })
  it('does not inherit a default for an omitted published scoring weight', async () => {
    const c = completeConfig(), omitted = c.rules.weights.pop()!
    replaceContract(c); await provision()
    expect(rows.leagueScoringOverride!.find(w => w.statKey === omitted.statKey)?.pointsValue).toBe(0)
  })
  it('blocks commissioner lifecycle overrides and generic settings changes', async () => {
    await provision(); const leagueId = rows.league![0].id
    expect(await assertLifecycleActionAllowed(leagueId, 'draft_commissioner_control', 'owner', { commissionerOverride: true, isElevatedCommissioner: true })).toMatchObject({ ok: false, err: { code: 'SEASON_TOURNAMENT_SETUP_BLOCKED' } })
    expect(await assertLifecycleActionAllowed(leagueId, 'settings_edit_commissioner', 'owner', { commissionerOverride: true, isElevatedCommissioner: true })).toMatchObject({ ok: false })
    await expect(requireCommissionerRole(leagueId, 'owner')).rejects.toMatchObject({ status: 409 })
  })
  it.each(['scoring', 'waivers', 'draft order'])('detects %s drift in native rows', async kind => {
    await provision()
    if (kind === 'scoring') rows.leagueScoringOverride![0].pointsValue = 123456
    if (kind === 'waivers') rows.leagueWaiverSettings![0].faabBudget = 123456
    if (kind === 'draft order') rows.leagueSettings![0].draftOrderLocked = false
    await expect(provision('stage-1-league-1')).rejects.toThrow('drifted')
  })
})

it('refuses direct draft start even if another path resets the session status', async () => {
  await provision(); const leagueId = rows.league![0].id
  rows.draftSession![0].status = 'pre_draft'
  expect(await startDraftSession(leagueId)).toEqual({ ok: false, reason: 'session_not_ready' })
  expect(rows.draftSession![0].status).toBe('pre_draft')
})

it('creates only one membership when the organizer is a frozen entrant', async () => {
  const raw = rows.tournamentAuditLog![0].data, m = raw.leagues[0].members[0]
  rows.tournamentParticipant!.find(e => e.id === m.id).userId = 'owner'; m.userId = 'owner'
  const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
  await provision()
  expect(rows.roster!.filter(r => r.platformUserId === 'owner')).toHaveLength(1)
  expect(rows.redraftLeagueMember!.filter(r => r.userId === 'owner')).toHaveLength(1)
  expect(rows.roster).toHaveLength(8)
  await expect(provision('stage-1-league-1')).resolves.toMatchObject({ created: false })
})

it('binds all pools to the tenant of the first committed setup unit', async () => {
  await provision(); vi.stubEnv('COMMISH_TENANT_ID', 'other-tenant')
  await expect(provision()).rejects.toThrow('different frozen field or server tenant')
  expect(rows.league).toHaveLength(1)
})


describe('frozen player catalog and readiness', () => {
  it('checks only created leagues and records an expiring pool snapshot without enabling launch', async () => {
    await provision()
    const report = await checkSeasonDraftReadiness('owner', 't1', 'f1')
    expect(report.launchReady).toBe(false)
    expect(report.reports[0]).toMatchObject({ poolReady: true, players: 300 })
    expect(report.reports[1]?.blockers).toContain('Create this opening league first.')
    expect(rows.draftSession![0].status).toBe('tournament_setup_blocked')
    expect((await loadSeasonDraftPlayers(rows.league![0].id, 'NBA')).length).toBe(300)
  })
  it('freezes resolved draft ID source evidence and refuses a provenance change on refresh', async () => {
    const resolved=await mock.pool()
    resolved.entries[0].draftIdProvenance={namespace:'rolling_insights',sourceRecordId:'stored-player-0'}
    mock.pool.mockResolvedValue(resolved)
    await provision();await checkSeasonDraftReadiness('owner','t1','f1')
    const leagueId=rows.league![0].id
    const saved=await readSeasonDraftSnapshot(leagueId,rows.tournamentAuditLog![0].data.manifestHash)
    expect(saved?.players[0]?.draftIdProvenance).toEqual({namespace:'rolling_insights',sourceRecordId:'stored-player-0'})
    const changed=clone(resolved);changed.entries[0].draftIdProvenance={namespace:'unknown',sourceRecordId:null}
    mock.pool.mockResolvedValue(changed)
    vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-12T12:04:30Z'))
    expect((await refreshSeasonDraftPool(leagueId))?.blockers).toContain('Player identities changed since the verified pool. Commissioner review is required; the existing pool has not been replaced.')
    expect((await readSeasonDraftSnapshot(leagueId,rows.tournamentAuditLog![0].data.manifestHash))?.players[0]?.draftIdProvenance).toEqual(saved?.players[0]?.draftIdProvenance)
  },120000)
  it('requires owner access and the current freeze ID', async () => {
    await expect(checkSeasonDraftReadiness('other', 't1', 'f1')).rejects.toMatchObject({ status: 403 })
    await expect(checkSeasonDraftReadiness('owner', 't1', 'other')).rejects.toMatchObject({ status: 409 })
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it('blocks missing, expired or malformed snapshots without fetching the catalog under a draft lock', async () => {
    await provision(); const id = rows.league![0].id
    await expect(loadSeasonDraftPlayers(id, 'NBA')).rejects.toThrow('Refresh')
    await checkSeasonDraftReadiness('owner', 't1', 'f1')
    mock.pool.mockClear()
    const snapshot = rows.tournamentAuditLog!.find(e => e.action === 'season_draft_pool_checked')
    snapshot.data.expiresAt = 'invalid'
    await expect(loadSeasonDraftPlayers(id, 'NBA')).rejects.toThrow('Refresh')
    snapshot.data.expiresAt = '2026-10-12T12:05:00Z'
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:05:00Z'))
    await expect(loadSeasonDraftPlayers(id, 'NBA')).rejects.toThrow('Refresh')
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it('rejects forged identity/position/team, duplicates and foreign roster IDs', async () => {
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    const id = rows.league![0].id, rosterId = rows.roster![0].id
    const candidate = { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }
    expect(await validateSeasonDraftPlayer(id, rosterId, [], candidate)).toBeNull()
    expect(await validateSeasonDraftPlayer(id, rosterId, [], { ...candidate, position: 'QB' })).toContain('details')
    expect(await validateSeasonDraftPlayer(id, rosterId, [], { ...candidate, team: 'OTHER' })).toContain('details')
    expect(await validateSeasonDraftPlayer(id, rosterId, [], { ...candidate, playerId: 'unknown' })).toContain('identified')
    expect(await validateSeasonDraftPlayer(id, rosterId, [{ ...candidate, rosterId }], candidate)).toContain('already drafted')
    expect(await validateSeasonDraftPlayer(id, 'outside', [], candidate)).toContain('not in the frozen')
    expect(await validateSeasonDraftPlayer(id, rosterId, [{ rosterId, playerName: '', position: '' }], candidate)).toBeNull()
  })
  it('records provider/catalog failure safely and keeps the snapshot unusable', async () => {
    await provision(); mock.pool.mockRejectedValue(new Error('private provider token'))
    const report = await checkSeasonDraftReadiness('owner', 't1', 'f1')
    expect(report.reports[0]?.poolReady).toBe(false)
    expect(JSON.stringify(report)).not.toContain('private provider')
    await expect(loadSeasonDraftPlayers(rows.league![0].id, 'NBA')).rejects.toThrow('Refresh')
  })
  it('keeps ordinary native leagues outside the tournament adapter', async () => {
    rows.league!.push({ id: 'ordinary', sport: 'NBA', settings: {} })
    expect(await validateSeasonDraftPlayer('ordinary', 'roster', [], { playerId: null, playerName: 'Any', position: 'PG' })).toBeNull()
    expect(mock.pool).not.toHaveBeenCalled()
  })
  it('uses published auction clocks and extends late bids without shortening an early clock', async () => {
    const raw = rows.tournamentAuditLog![0].data
    raw.config.draftType = 'auction'; rows.tournamentAuditLog![1].data.config.draftType = 'auction'
    const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    const id = rows.league![0].id, session = rows.draftSession![0]
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    const cfg = await engine.getAuctionConfigForLeague(id, { auctionBudgetPerTeam: 999, timerSeconds: 999 })
    expect(cfg).toMatchObject({ budgetPerTeam: 200, minBid: 1, bidTimerSeconds: 30, bidExtensionSeconds: 10 })
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))
    try {
      session.status = 'in_progress'; session.picks = []
      await engine.initializeAuctionForSession(id)
      const a = session.slotOrder[0].rosterId, b = session.slotOrder[1].rosterId
      expect((await engine.nominatePlayer(id, { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }, a)).success).toBe(true)
      expect((await engine.placeBid(id, a, 1)).success).toBe(true)
      const earlyDeadline = session.timerEndAt.getTime()
      vi.setSystemTime(new Date('2026-10-12T12:00:25Z'))
      expect((await engine.placeBid(id, b, 2)).success).toBe(true)
      expect(session.timerEndAt.getTime()).toBe(earlyDeadline + 5000)
      expect((await engine.placeBid(id, a, 2.5)).success).toBe(false)
    } finally { vi.useRealTimers() }
  })
})

it('uses the checked tournament pool for timeout selection and bypasses personal queues', async () => {
  await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
  const id = rows.league![0].id, session = rows.draftSession![0]
  session.status = 'in_progress'; session.picks = []
  expect((await resolveBestAvailableAutopickCandidate(id, rows.roster![0].id))?.playerId).toBe('player-0')
  expect(await resolveBestAvailableAutopickCandidate(id, rows.roster![1].id)).toBeNull()
  expect(await tryQueueAutoPick(id, rows.roster![0].id)).toEqual({ success: false })
})


describe('tournament auction expiry and competing requests', () => {
  async function prepare() {
    const raw = rows.tournamentAuditLog![0].data
    raw.config.draftType = 'auction'; rows.tournamentAuditLog![1].data.config.draftType = 'auction'
    const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    const id = rows.league![0].id, session = rows.draftSession![0]
    session.status = 'in_progress'; session.picks = []
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    await engine.initializeAuctionForSession(id)
    return { id, session, engine, a: session.slotOrder[0].rosterId, b: session.slotOrder[1].rosterId }
  }
  const player = { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }
  it('allows only one competing nomination and bid even when the distributed lock passes through', async () => {
    const { id, session, engine, a, b } = await prepare()
    expect((await engine.nominatePlayer(id, player, a, { autoMinimumBid: true })).success).toBe(false)
    const nominations = await Promise.all([engine.nominatePlayer(id, player, a), engine.nominatePlayer(id, player, a)])
    expect(nominations.filter(r => r.success)).toHaveLength(1)
    const bids = await Promise.all([engine.placeBid(id, a, 1), engine.placeBid(id, b, 2)])
    expect(bids.filter(r => r.success)).toHaveLength(1)
    const budget = session.auctionBudgets[a]
    expect(await engine.initializeAuctionForSession(id)).toBe(true)
    expect(session.auctionBudgets[a]).toBe(budget)
    expect(session.auctionState.currentNomination.playerId).toBe('player-0')
  })
  it('does not sell early, rejects expired bids and settles a winning bid exactly once', async () => {
    const { id, session, engine, a } = await prepare()
    await engine.nominatePlayer(id, player, a)
    await engine.placeBid(id, a, 1)
    expect((await engine.resolveAuctionWin(id, { force: true })).success).toBe(false)
    session.timerEndAt = new Date(Date.now() - 1)
    expect((await engine.placeBid(id, a, 2)).success).toBe(false)
    const results = await Promise.all([engine.resolveAuctionWin(id), engine.resolveAuctionWin(id)])
    expect(results.filter(r => r.success)).toHaveLength(1)
    expect(rows.draftPick).toHaveLength(1)
    expect(session.auctionBudgets[a]).toBe(199)
    expect(session.auctionState.currentNomination).toBeNull()
  })
  it('returns a no-bid nomination to the pool without charging a team or inserting a pick', async () => {
    const { id, session, engine, a } = await prepare()
    await engine.nominatePlayer(id, player, a)
    session.timerEndAt = new Date(Date.now() - 1)
    expect(await engine.resolveAuctionWin(id)).toMatchObject({ success: true, sold: false })
    expect(rows.draftPick).toHaveLength(0)
    expect(session.auctionBudgets[a]).toBe(200)
    expect(session.auctionState.nominationOrderIndex).toBe(1)
  })
  it('auto-nominates a checked legal player at the minimum bid and resolves it without a late synthetic bid', async () => {
    const { id, session, a } = await prepare()
    session.timerEndAt = new Date(Date.now() - 1)
    const { runAuctionAutomationTick } = await import('@/lib/live-draft-engine/auction/AuctionAutomationService')
    expect((await runAuctionAutomationTick(id)).actions[0]?.type).toBe('auto_nominate')
    expect(session.auctionState).toMatchObject({ currentBid: 1, currentBidderRosterId: a })
    session.timerEndAt = new Date(Date.now() - 1)
    const tick = await runAuctionAutomationTick(id)
    expect(tick.actions).toEqual([expect.objectContaining({ type: 'auto_resolve', sold: true, amount: 1 })])
    expect(rows.draftPick).toHaveLength(1)
    expect(session.auctionBudgets[a]).toBe(199)
  })
  it('holds the last native auction sale for tournament completion without unlocking its league', async () => {
    const { id, session, engine, a } = await prepare()
    let index = 1
    for (const [rosterIndex, entry] of session.slotOrder.entries()) {
      for (let n = 0; n < session.rounds - (rosterIndex === 0 ? 1 : 0); n++) {
        const pick = { id: 'prior-' + index, sessionId: session.id, overall: index, rosterId: entry.rosterId, playerId: 'player-' + index, playerName: 'Player ' + index, position: ['PG', 'SG', 'SF', 'PF', 'C'][index % 5], team: 'TEST' }
        session.picks.push(pick); rows.draftPick!.push(clone(pick)); index++
      }
    }
    expect((await engine.nominatePlayer(id, player, a)).success).toBe(true)
    expect((await engine.placeBid(id, a, 1)).success).toBe(true)
    session.timerEndAt = new Date(Date.now() - 1)
    expect(await engine.resolveAuctionWin(id)).toMatchObject({ success: true, sold: true, amount: 1 })
    expect(rows.draftPick).toHaveLength(session.rounds * session.teamCount)
    expect(session).toMatchObject({ status: 'in_progress', timerEndAt: null })
    expect(session.auctionState.bidTimerEndAt).toBeNull()
    expect(rows.league![0]).toMatchObject({ locked: true, lifecycleState: 'setup' })
    expect(rows.leagueWaiverState![0].processingLocked).toBe(true)
    expect((await engine.resolveAuctionWin(id)).success).toBe(false)
  })
  it('rolls back a claimed resolution when pick insertion fails', async () => {
    const { id, session, engine, a } = await prepare()
    session.timerEndAt = new Date(Date.now() - 1)
    await engine.nominatePlayer(id, player, a, { autoMinimumBid: true })
    session.timerEndAt = new Date(Date.now() - 1)
    const version = session.version
    mock.db.draftPick.create.mockRejectedValueOnce(new Error('fixture insert failed'))
    await expect(engine.resolveAuctionWin(id)).rejects.toThrow('fixture insert failed')
    expect(rows.draftSession![0].version).toBe(version)
    expect(rows.draftSession![0].auctionBudgets[a]).toBe(200)
    expect((await engine.resolveAuctionWin(id)).success).toBe(true)
    expect(rows.draftPick).toHaveLength(1)
  })
})


describe('long-running draft catalog recovery', () => {
  const clock = (iso: string) => vi.spyOn(Date, 'now').mockReturnValue(Date.parse(iso))
  async function checked() {
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    mock.pool.mockClear()
    return rows.league![0].id as string
  }
  it('reuses fresh snapshots without provider calls or duplicate audits', async () => {
    const id = await checked()
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    expect(await refreshSeasonDraftPool(id)).toMatchObject({ ready: true, refreshed: false })
    expect(mock.pool).not.toHaveBeenCalled()
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_pool_checked')).toHaveLength(1)
  })
  it('recovers an expired active draft and accepts ranking changes without changing identities', async () => {
    const id = await checked(); rows.draftSession![0].status = 'in_progress'
    clock('2026-10-12T12:06:00Z')
    const source = await mock.pool()
    source.entries[0].adp = 999
    mock.pool.mockResolvedValue(source)
    const { prepareSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    expect(await prepareSeasonDraftPool(id)).toBeNull()
    expect((await loadSeasonDraftPlayers(id, 'NBA'))[0]).toMatchObject({ playerId: 'player-0', position: 'PG', adp: 999 })
    expect(rows.draftSession![0].status).toBe('in_progress')
    expect(rows.draftPick).toHaveLength(0)
  })
  it('blocks catalog identity drift without replacing the verified snapshot or draft state', async () => {
    const id = await checked(); clock('2026-10-12T12:06:00Z')
    const source = await mock.pool()
    source.entries[0].team = 'CHANGED'; mock.pool.mockResolvedValue(source)
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    const report = await refreshSeasonDraftPool(id)
    expect(report?.ready).toBe(false)
    expect(report?.blockers.join(' ')).toContain('identities changed')
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_pool_checked')).toHaveLength(1)
    expect(rows.draftSession![0].status).toBe('tournament_setup_blocked')
    await expect(loadSeasonDraftPlayers(id, 'NBA')).rejects.toThrow('Refresh')
  })
  it('keeps an unexpired verified pool during outage, backs off and refuses stale use', async () => {
    const id = await checked(); clock('2026-10-12T12:04:10Z')
    mock.pool.mockRejectedValue(new Error('secret token'))
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    const first = await refreshSeasonDraftPool(id)
    expect(first).toMatchObject({ ready: true, refreshed: false, expiresAt: '2026-10-12T12:05:00.000Z' })
    expect(JSON.stringify(first)).not.toContain('secret')
    clock('2026-10-12T12:04:20Z'); await refreshSeasonDraftPool(id)
    expect(mock.pool).toHaveBeenCalledTimes(1)
    clock('2026-10-12T12:05:01Z')
    expect((await refreshSeasonDraftPool(id))?.ready).toBe(false)
    await expect(loadSeasonDraftPlayers(id, 'NBA')).rejects.toThrow('Refresh')
  })
  it('fails closed when the refresh lease is unavailable and releases acquired leases', async () => {
    const id = await checked(); clock('2026-10-12T12:06:00Z')
    const locks = await import('@/lib/automation/locks')
    vi.mocked(locks.acquireAutomationLock).mockResolvedValueOnce({ ok: false, reason: 'Lock held (postgres)' })
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    expect((await refreshSeasonDraftPool(id))?.ready).toBe(false)
    expect(mock.pool).not.toHaveBeenCalled()
    expect((await refreshSeasonDraftPool(id))?.ready).toBe(true)
    expect(locks.releaseAutomationLock).toHaveBeenCalled()
  })
  it('bounds provider waits and ignores late results after timeout', async () => {
    const id = await checked(); clock('2026-10-12T12:06:00Z')
    let resolve!: (value: any) => void
    mock.pool.mockImplementation(() => new Promise(r => { resolve = r }))
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    vi.useFakeTimers()
    try {
      const result = refreshSeasonDraftPool(id)
      await vi.advanceTimersByTimeAsync(15001)
      expect((await result)?.ready).toBe(false)
      const count = rows.tournamentAuditLog!.length
      resolve({ sport: 'NBA', entries: [], rosterConfigurationIncomplete: false })
      await Promise.resolve(); await Promise.resolve()
      expect(rows.tournamentAuditLog).toHaveLength(count)
    } finally { vi.useRealTimers() }
  })

  it('coalesces concurrent expired-pool recovery behind a separate refresh lease', async () => {
    const id = await checked(); clock('2026-10-12T12:06:00Z')
    const source = await mock.pool()
    mock.pool.mockClear()
    let complete!: (value: any) => void
    mock.pool.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const locks = await import('@/lib/automation/locks')
    vi.mocked(locks.acquireAutomationLock).mockResolvedValueOnce({ ok: true, backend: 'postgres' }).mockResolvedValueOnce({ ok: false, reason: 'Lock held (postgres)' })
    const { refreshSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    const first = refreshSeasonDraftPool(id)
    await vi.waitFor(() => expect(mock.pool).toHaveBeenCalledTimes(1))
    expect((await refreshSeasonDraftPool(id))?.ready).toBe(false)
    expect(mock.pool).toHaveBeenCalledTimes(1)
    complete(source)
    expect((await first)?.ready).toBe(true)
  })
  it('refreshes before auction mutation and recovers an expired nomination pool', async () => {
    const raw = rows.tournamentAuditLog![0].data
    raw.config.draftType = 'auction'; rows.tournamentAuditLog![1].data.config.draftType = 'auction'
    const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
    const id = await checked(); const session = rows.draftSession![0]
    session.status = 'in_progress'; session.picks = []
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    await engine.initializeAuctionForSession(id)
    const source = await mock.pool(); mock.pool.mockClear()
    mock.pool.mockImplementationOnce(async () => { expect(mock.lockDepth).toBe(0); return source })
    clock('2026-10-12T12:06:00Z')
    const result = await engine.nominatePlayer(id, { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }, session.slotOrder[0].rosterId)
    expect(result.success).toBe(true)
    expect(mock.pool).toHaveBeenCalledTimes(1)
    expect((await loadSeasonDraftPlayers(id, 'NBA')).length).toBe(300)
  })
  it('does not run providers for blocked or ordinary sessions', async () => {
    await provision(); const { prepareSeasonDraftPool } = await import('@/lib/tournament/seasonDraftRefresh')
    expect(await prepareSeasonDraftPool(rows.league![0].id)).toBeNull()
    rows.league!.push({ id: 'ordinary', sport: 'NBA', settings: {} })
    expect(await prepareSeasonDraftPool('ordinary')).toBeNull()
    expect(mock.pool).not.toHaveBeenCalled()
  })
})


describe('tournament draft controls', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())
  async function active(auction = false) {
    if (auction) {
      const raw = rows.tournamentAuditLog![0].data
      raw.config.draftType = 'auction'; rows.tournamentAuditLog![1].data.config.draftType = 'auction'
      const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
    }
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    const session = rows.draftSession![0]; session.status = 'in_progress'; session.picks = []; session.timerEndAt = new Date(Date.now() + 40000)
    return session
  }
  it('preserves the remaining clock, resumes explicitly and audits each accepted change', async () => {
    const session = await active(); const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    expect(await controls.pauseDraftSession(session.leagueId, 'owner')).toBe(true)
    expect(session).toMatchObject({ status: 'paused', timerEndAt: null, pausedRemainingSeconds: 40 })
    expect(await controls.resumeDraftSession(session.leagueId)).toBe(true)
    expect(session.timerEndAt.getTime()).toBe(Date.now() + 40000)
    expect(rows.tournamentAuditLog!.filter(e => ['season_draft_pause', 'season_draft_resume'].includes(e.action))).toHaveLength(2)
  })
  it('does not grant extra time when resuming an already expired pick', async () => {
    const session = await active(); session.timerEndAt = new Date(Date.now() - 1000)
    const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    await controls.pauseDraftSession(session.leagueId)
    expect(session.pausedRemainingSeconds).toBe(0)
    await controls.resumeDraftSession(session.leagueId)
    expect(session.timerEndAt.getTime()).toBe(Date.now())
    expect(await controls.resetTimer(session.leagueId)).toBe(true)
    expect(session.timerEndAt.getTime()).toBe(Date.now() + 90000)
  })
  it('reset stays paused and tournament clocks cannot be edited', async () => {
    const session = await active(); const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    await controls.pauseDraftSession(session.leagueId)
    expect(await controls.resetTimer(session.leagueId)).toBe(true)
    expect(session).toMatchObject({ status: 'paused', timerEndAt: null, pausedRemainingSeconds: 90 })
    expect(await controls.setTimerSeconds(session.leagueId, 300, { resetCurrentTimer: true })).toBe(false)
    expect(session.timerSeconds).toBe(90)
  })
  it('allows pause during catalog failure and blocks resume until recovery', async () => {
    const session = await active(); const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:06:00Z'))
    const source = await mock.pool(); mock.pool.mockRejectedValue(new Error('provider outage'))
    expect(await controls.pauseDraftSession(session.leagueId)).toBe(true)
    expect(await controls.resumeDraftSession(session.leagueId)).toBe(false)
    expect(session.status).toBe('paused')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:06:31Z')); mock.pool.mockResolvedValue(source)
    expect(await controls.resumeDraftSession(session.leagueId)).toBe(true)
  })
  it('accepts a competing pause only once even with lock passthrough', async () => {
    const session = await active(); const { pauseDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    expect((await Promise.all([pauseDraftSession(session.leagueId), pauseDraftSession(session.leagueId)])).filter(Boolean)).toHaveLength(1)
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_pause')).toHaveLength(1)
  })
  it('rolls back a control mutation when its audit write fails', async () => {
    const session = await active(); const { pauseDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(pauseDraftSession(session.leagueId)).rejects.toThrow('audit unavailable')
    expect(rows.draftSession![0]).toMatchObject({ status: 'in_progress', version: session.version - 1 })
  })
  it('uses the frozen auction clock and preserves nomination and bids on pause/reset', async () => {
    const session = await active(true); const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    await engine.initializeAuctionForSession(session.leagueId)
    const rosterId = session.slotOrder[0].rosterId
    expect((await engine.nominatePlayer(session.leagueId, { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }, rosterId)).success).toBe(true)
    expect((await engine.placeBid(session.leagueId, rosterId, 1)).success).toBe(true)
    await controls.pauseDraftSession(session.leagueId)
    expect(session.auctionState).toMatchObject({ currentBid: 1, bidTimerEndAt: null })
    await controls.resetTimer(session.leagueId)
    expect(session.pausedRemainingSeconds).toBe(30)
    await controls.resumeDraftSession(session.leagueId)
    expect(session.auctionState).toMatchObject({ currentBid: 1, bidTimerEndAt: session.timerEndAt.toISOString() })
  })

  it('does not overwrite a competing auction bid or its late extension', async () => {
    const session = await active(true); const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    await engine.initializeAuctionForSession(session.leagueId)
    await engine.nominatePlayer(session.leagueId, { playerId: 'player-0', playerName: 'Player 0', position: 'PG', team: 'TEST' }, session.slotOrder[0].rosterId)
    await engine.placeBid(session.leagueId, session.slotOrder[0].rosterId, 1)
    session.timerEndAt = new Date(Date.now() + 5000)
    const original = mock.db.$transaction
    // Commit the competing bid before opening the control transaction; the fixture serializes transactions.
    vi.spyOn(mock.db, '$transaction').mockImplementationOnce(async (run: any) => {
      expect((await engine.placeBid(session.leagueId, session.slotOrder[1].rosterId, 2)).success).toBe(true)
      return original(run)
    })
    expect(await controls.pauseDraftSession(session.leagueId)).toBe(false)
    expect(session.status).toBe('in_progress')
    expect(session.auctionState.currentBid).toBe(2)
    expect(session.timerEndAt.getTime()).toBe(Date.now() + 10000)
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_pause')).toHaveLength(0)
  })
  it('refuses all controls on blocked setup sessions', async () => {
    await provision(); const id = rows.league![0].id; const controls = await import('@/lib/live-draft-engine/DraftSessionService')
    expect(await controls.pauseDraftSession(id)).toBe(false)
    expect(await controls.resumeDraftSession(id)).toBe(false)
    expect(await controls.resetTimer(id)).toBe(false)
    expect(rows.draftSession![0].status).toBe('tournament_setup_blocked')
  })
})


describe('native tournament generic draft mutation boundaries', () => {
  it.each(['tournament_setup_blocked', 'pre_draft', 'in_progress', 'paused', 'completed'])('preserves frozen state through generic tools with status %s', async status => {
    await provision()
    const leagueId = rows.league![0].id
    rows.draftSession![0].status = status
    rows.draftSession![0].picks = []
    const before = clone(rows)
    const services = await import('@/lib/live-draft-engine/DraftSessionService')
    const { appendDraftPickTrades } = await import('@/lib/live-draft-engine/DraftPickTradeService')
    const { commissionerPickEdit } = await import('@/lib/live-draft-engine/commissioner/commissionerPickEditService')
    const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
    const { runSlowDraftAutomationTick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const { runPostDraftFinalizationArtifacts, repairDraftCompletionIfBoardFull } = await import('@/lib/live-draft-engine/postDraftFinalizeArtifacts')
    expect(await services.undoLastPick(leagueId, { reason: 'override', actorUserId: 'owner' })).toBe(false)
    expect(await services.resetDraftSession(leagueId, { allowCompleted: true })).toBe(false)
    expect(await services.swapDraftManagers(leagueId, 1, 2, 'owner')).toMatchObject({ ok: false, code: 'TOURNAMENT_RULES_FROZEN' })
    expect(await services.completeDraftSession(leagueId)).toBe(false)
    expect(await appendDraftPickTrades(leagueId, [{} as any])).toMatchObject({ success: false })
    expect(await commissionerPickEdit({ leagueId, action: 'remove', force: true } as any)).toMatchObject({ ok: false, status: 409, code: 'TOURNAMENT_RULES_FROZEN' })
    expect(await createNextLeagueDraft(leagueId, 'owner')).toMatchObject({ ok: false, code: 'TOURNAMENT_RULES_FROZEN' })
    expect(await runSlowDraftAutomationTick(leagueId)).toEqual({ changed: false, actions: [] })
    await services.reconcileOvernightDraftTimerForLeague(leagueId)
    await runPostDraftFinalizationArtifacts(leagueId)
    expect(await repairDraftCompletionIfBoardFull(leagueId)).toBe(false)
    expect(rows).toEqual(before)
  })

  it('refuses generic recreation of a missing native session and fails closed on a malformed marker', async () => {
    await provision()
    const leagueId = rows.league![0].id
    rows.draftSession = []
    rows.league![0].settings = { seasonTournament: null }
    const { getOrCreateDraftSession, resetDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    await expect(getOrCreateDraftSession(leagueId)).rejects.toThrow('Tournament draft rules are frozen')
    expect(await resetDraftSession(leagueId, { allowCompleted: true })).toBe(false)
    expect(rows.draftSession).toEqual([])
    expect(rows.league![0].locked).toBe(true)
  })
})

describe('complete native NFL and NBA draft service simulations', () => {
  const completedFixtures = new Map<string, Record<string, any[]>>()
  async function setup(sport: 'NFL' | 'NBA', draftType: 'snake' | 'auction') {
    let c = completeConfig()
    if (sport === 'NFL') {
      const base = defaultSeasonBlueprint('NFL'), r = defaultSeasonRules('NFL', 'ppr'), nba = completeConfig()
      const periods = nba.rules.calendar.periods.slice(0, 17)
      r.calendar = { ...nba.rules.calendar, periods, drafts: [nba.rules.calendar.drafts[0]!, ...[6, 13].map((cut, index) => ({ stage: index + 2, startsAt: periods[cut - 1]!.finalizesAt, completeBy: new Date(Date.parse(periods[cut]!.startsAt) - 12 * 3600000).toISOString() }))] }
      c = { ...base, name: 'NFL Simulation', rules: r, redraftBufferHours: 12 } as typeof c
    }
    c.draftType = draftType
    const raw = rows.tournamentAuditLog![0].data
    raw.config = c; rows.tournamentAuditLog![1].data.config = clone(c)
    const { manifestHash: _old, ...payload } = raw; raw.manifestHash = seasonContractHash(payload)
    const positions = sport === 'NFL' ? ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] : ['PG/SG', 'SG', 'SF', 'PF', 'C']
    mock.pool.mockResolvedValue({ sport, rosterConfigurationIncomplete: false, entries: Array.from({ length: 300 }, (_, i) => ({ playerId: 'player-' + i, name: 'Player ' + i, position: positions[i % positions.length], team: 'TEST', adp: i + 1 })) })
    await provision(); await checkSeasonDraftReadiness('owner', 't1', 'f1')
    const session = rows.draftSession![0]
    const league = rows.league![0]
    const marker = league.settings.seasonTournament
    rows.tournamentAuditLog!.push({ id: 'draft-release', tournamentId: 't1', targetType: 'league', targetId: league.id, action: 'season_opening_draft_released', data: { version: 1, freezeId: 'f1', manifestHash: marker.manifestHash, key: marker.key, leagueId: league.id, seasonLaunchReady: false }, createdAt: new Date(Date.now()) })
    league.lifecycleState = 'drafting'
    rows.tournamentLeague![0].status = 'season_draft_ready'
    session.status = 'in_progress'; session.picks = []; session.timerEndAt = new Date(Date.now() + 90000)
    return { c, session, leagueId: session.leagueId }
  }
  async function draft(sport: 'NFL' | 'NBA', draftType: 'snake' | 'auction') {
    const cached = completedFixtures.get(sport + draftType)
    if (cached) { rows = clone(cached); const session = rows.draftSession![0]; return { session, leagueId: session.leagueId, total: session.rounds * session.teamCount } }
    const { c, session, leagueId } = await setup(sport, draftType)
    const { resolveCurrentOnTheClock } = await import('@/lib/live-draft-engine/CurrentOnTheClockResolver')
    const { selectSeasonAutodraft } = await import('@/lib/tournament/seasonDraftPolicy')
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    const { pauseDraftSession, resumeDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    const engine = await import('@/lib/live-draft-engine/auction/AuctionEngine')
    if (draftType === 'auction') await engine.initializeAuctionForSession(leagueId)
    const total = session.rounds * session.teamCount
    for (let i = 0; i < total; i++) {
      if (i === Math.floor(total / 2)) {
        expect(await pauseDraftSession(leagueId, 'owner')).toBe(true)
        // Simulate a catalog expiring during the pause; resume must recover outside the control lock.
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-12T12:06:00Z'))
        expect(await resumeDraftSession(leagueId)).toBe(true)
      }
      const rosterId = draftType === 'auction' ? session.slotOrder[session.auctionState.nominationOrderIndex].rosterId : resolveCurrentOnTheClock({ totalPicks: total, picks: session.picks, teamCount: session.teamCount, draftType, thirdRoundReversal: false, slotOrder: session.slotOrder })!.rosterId
      const pool = await loadSeasonDraftPlayers(leagueId, sport)
      const candidate = selectSeasonAutodraft(c, session.picks.filter((p: any) => p.rosterId === rosterId), pool, new Set(session.picks.map((p: any) => p.playerId)))!
      expect(candidate).toBeTruthy()
      if (draftType === 'auction') {
        expect(await engine.nominatePlayer(leagueId, candidate, rosterId)).toMatchObject({ success: true })
        expect(await engine.placeBid(leagueId, rosterId, 1)).toMatchObject({ success: true })
        session.timerEndAt = new Date(Date.now() - 1)
        expect(await engine.resolveAuctionWin(leagueId)).toMatchObject({ success: true, sold: true, amount: 1 })
      } else {
        expect(await submitPick({ leagueId, ...candidate, rosterId, source: 'user', expectedOverall: i + 1 })).toMatchObject({ success: true })
      }
    }
    expect(session.status).toBe('completed')
    expect(session.timerEndAt).toBeNull()
    expect(rows.draftPick).toHaveLength(total)
    expect(new Set(rows.draftPick!.map(p => p.playerId)).size).toBe(total)
    for (const slot of session.slotOrder) expect(rows.draftPick!.filter(p => p.rosterId === slot.rosterId)).toHaveLength(c.rosterSize)
    const events = rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_board_completed')
    expect(events).toHaveLength(1)
    expect(events[0].data).toMatchObject({ totalPicks: total, rosterCount: session.teamCount, launchReady: false })
    expect(rows.league![0]).toMatchObject({ lifecycleState: 'drafting', locked: true })
    expect(rows.leagueWaiverState![0].processingLocked).toBe(true)
    const { completeSeasonDraft } = await import('@/lib/tournament/seasonDraftCompletion')
    expect(await completeSeasonDraft(leagueId)).toBe(true)
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_board_completed')).toHaveLength(1)
    completedFixtures.set(sport + draftType, clone(rows))
    return { session, leagueId, total }
  }
  it.each([['NFL', 'snake'], ['NBA', 'snake'], ['NFL', 'auction'], ['NBA', 'auction']] as const)('completes a full %s %s draft with refresh and controls, preserving season locks', async (sport, type) => { await draft(sport, type) }, 120000)

  async function scoreFixture(sport: 'NFL' | 'NBA' = 'NBA') {
    const { leagueId } = await draft(sport, 'snake')
    const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')
    const ledger = await import('@/lib/tournament/seasonScoreLedger')
    await prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')
    const window = rows.tournamentAuditLog![0].data.config.rules.calendar.periods[0]
    const startsAt = new Date(Date.parse(window.startsAt) + 3600000).toISOString()
    const game = { gameId: 'game-1', startsAt, playerIds: rows.roster!.flatMap(r => r.playerData.players) }
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt) - 60000)
    const before = clone(rows)
    expect(await ledger.captureSeasonOpeningLineup(leagueId, game)).toMatchObject({ repeated: false, period: 1, launchReady: false })
    const after = clone(rows)
    expect(await ledger.captureSeasonOpeningLineup(leagueId, game)).toMatchObject({ repeated: true })
    expect(rows).toEqual(after)
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.finalizesAt) + 60000)
    const batch = { requestId: 'batch-1', expectedRevision: 0, period: 1, source: 'trusted-fixture', observedAt: new Date(Date.now()).toISOString(), coverage: 'complete' as const,
      scores: game.playerIds.map(playerId => ({ gameId: game.gameId, playerId, revision: 1, status: 'final' as const, points: 0 })),
    }
    return { ledger, leagueId, game, batch, before, after, window }
  }
  it.each(['NFL', 'NBA'] as const)('persists %s locked lineups and score revisions with idempotent readback', async sport => {
    const { ledger, leagueId, batch } = await scoreFixture(sport)
    expect(await ledger.readSeasonOpeningScoreLedger(leagueId, 1)).toMatchObject({ state: 'missing', revision: 0 })
    expect(await ledger.ingestSeasonOpeningScores(leagueId, batch)).toMatchObject({ repeated: false, revision: 1, projection: { canFinalize: true }, launchReady: false })
    const before = clone(rows)
    expect(await ledger.ingestSeasonOpeningScores(leagueId, batch)).toMatchObject({ repeated: true, revision: 1 })
    expect(rows).toEqual(before)
    expect(await ledger.readSeasonOpeningScoreLedger(leagueId, 1)).toMatchObject({ state: 'eligible', revision: 1 })
    const playerId = rows.roster![0].playerData.starters[0]
    const corrected = { ...batch, requestId: 'batch-2', expectedRevision: 1, scores: [{ gameId: 'game-1', playerId, revision: 2, status: 'provisional' as const, points: 4.5 }] }
    expect(await ledger.ingestSeasonOpeningScores(leagueId, corrected)).toMatchObject({ revision: 2, projection: { canFinalize: false } })
    const report = await ledger.readSeasonOpeningScoreLedger(leagueId, 1)
    expect(report).toMatchObject({ state: 'provisional', revision: 2 })
    expect(report.projection.teams[0].knownPoints).toBe(4.5)
    expect(rows.league![0]).toMatchObject({ locked: true, lifecycleState: 'drafting' })
    expect(rows.leagueWaiverState![0].processingLocked).toBe(true)
    expect(shell.status).toBe('rules_published')
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_scores_ingested')).toHaveLength(2)
  }, 120000)
  it('refuses backdated captures and schedule rebinding without writes', async () => {
    const { ledger, leagueId, game } = await scoreFixture()
    const before = clone(rows)
    await expect(ledger.captureSeasonOpeningLineup(leagueId, { ...game, gameId: 'late' })).rejects.toThrow('before its lock deadline')
    await expect(ledger.captureSeasonOpeningLineup(leagueId, { ...game, startsAt: new Date(Date.parse(game.startsAt) + 60000).toISOString() })).rejects.toThrow('cannot be rebound')
    expect(rows).toEqual(before)
  }, 120000)
  it('refuses altered request content, stale sequence, provider swaps and conflicting score revisions', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const before = clone(rows)
    await expect(ledger.ingestSeasonOpeningScores(leagueId, { ...batch, coverage: 'missing' })).rejects.toThrow('reused')
    await expect(ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'stale' })).rejects.toThrow('revision changed')
    await expect(ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'swap', expectedRevision: 1, source: 'other' })).rejects.toThrow('source')
    await expect(ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'conflict', expectedRevision: 1, scores: [{ ...batch.scores[0]!, points: 9 }] })).rejects.toThrow('Conflicting')
    expect(rows).toEqual(before)
  }, 120000)
  it('rolls back session claims when score receipts fail and refuses lost claims', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const before = clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('score audit failed'))
    await expect(ledger.ingestSeasonOpeningScores(leagueId, batch)).rejects.toThrow('score audit failed')
    expect(rows).toEqual(before)
    mock.db.draftSession.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(ledger.ingestSeasonOpeningScores(leagueId, batch)).rejects.toThrow('checkpoint changed')
    expect(rows).toEqual(before)
  }, 120000)
  it('serializes competing ledger revisions so only one new batch commits', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const results = await Promise.allSettled([ledger.ingestSeasonOpeningScores(leagueId, batch), ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'other' })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_scores_ingested')).toHaveLength(1)
  }, 120000)
  it('detects tampered lineup receipts, score receipts and prepared roster drift', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const before = clone(rows)
    rows.tournamentAuditLog!.find(e => e.action === 'season_lineup_locked')!.data.lineups[0].starterIds = []
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('checkpoint')
    rows = clone(before)
    rows.tournamentAuditLog!.find(e => e.action === 'season_scores_ingested')!.data.evidence.scores[0].points = 99
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('checkpoint')
    rows = clone(before); rows.roster![0].playerData.starters = []
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('prepared rosters')
  }, 120000)

  it('stores incomplete results without treating missing teams as zero', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const report = await ledger.ingestSeasonOpeningScores(leagueId, { ...batch, scores: [] })
    expect(report.projection.canFinalize).toBe(false)
    expect(report.projection.teams.every((t: any) => t.points === null && t.missing.length > 0)).toBe(true)
    expect(await ledger.readSeasonOpeningScoreLedger(leagueId, 1)).toMatchObject({ state: 'provisional', revision: 1 })
  }, 120000)
  it('rejects deleted revision history and reordered observations', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    await expect(ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'older', expectedRevision: 1, observedAt: new Date(Date.parse(batch.observedAt) - 1).toISOString() })).rejects.toThrow('observation order')
    await ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'second', expectedRevision: 1, scores: [] })
    rows.tournamentAuditLog = rows.tournamentAuditLog!.filter(e => e.action !== 'season_scores_ingested' || e.data.revision !== 1)
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('sequence')
  }, 120000)
  it('rolls back lineup capture failures and refuses unknown mapped identities', async () => {
    const { ledger, leagueId, game, window } = await scoreFixture()
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt) - 60000)
    const before = clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('lock save failed'))
    await expect(ledger.captureSeasonOpeningLineup(leagueId, { ...game, gameId: 'second' })).rejects.toThrow('lock save failed')
    expect(rows).toEqual(before)
    await expect(ledger.captureSeasonOpeningLineup(leagueId, { ...game, gameId: 'unknown', playerIds: ['foreign-player'] })).rejects.toThrow('mapped')
    expect(rows).toEqual(before)
  }, 120000)
  it('requires a prepared completed draft and refuses an activated shell', async () => {
    const { leagueId } = await draft('NBA', 'snake')
    const ledger = await import('@/lib/tournament/seasonScoreLedger')
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('prepared rosters')
    const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')
    await prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')
    shell.status = 'active'
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('outside locked setup')
  }, 120000)

  it('reviews private weekly counts and finalizes the exact owner-reviewed revision idempotently', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await expect(ledger.reviewSeasonOpeningWeek('outsider', ...args.slice(1) as [string, string, string, number])).rejects.toMatchObject({ status: 403 })
    expect(await ledger.reviewSeasonOpeningWeek(...args)).toMatchObject({ state: 'missing', canFinalize: false })
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const beforeReview = clone(rows), report = await ledger.reviewSeasonOpeningWeek(...args)
    expect(report).toMatchObject({ state: 'ready', revision: 1, canFinalize: true, launchReady: false })
    expect(JSON.stringify(report)).not.toContain('player-')
    expect(JSON.stringify(report)).not.toContain('rosterId')
    expect(rows).toEqual(beforeReview)
    expect(await ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)).toMatchObject({ finalized: true, repeated: false, revision: 1 })
    const after = clone(rows)
    expect(await ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)).toMatchObject({ repeated: true })
    expect(rows).toEqual(after)
    expect(await ledger.reviewSeasonOpeningWeek(...args)).toMatchObject({ state: 'finalized', canFinalize: false })
    const receipt = rows.tournamentAuditLog!.find(e => e.action === 'season_week_finalized_setup')!
    expect(receipt).toMatchObject({ actorId: 'owner', actorType: 'user' })
    expect(rows.league![0]).toMatchObject({ locked: true, lifecycleState: 'drafting' })
    expect(shell.status).toBe('rules_published')
  }, 120000)
  it('invalidates a previously finalized week when a later start status contradicts it', async () => {
    const { ledger, leagueId, batch, game } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const initial = await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args, initial.revision, initial.reviewToken!)
    const manifest = readOpeningManifest(rows.tournamentAuditLog![0].data)
    const observation = (state: string, observedAt: string) => {
      const payload = { version: 1, manifestHash: manifest.manifestHash, rulesHash: manifest.rulesHash,
        providerGameId: game.gameId, sport: manifest.config.sport, state, observedAt, scheduledAt: game.startsAt, rawDigest: 'a'.repeat(64) }
      rows.tournamentAuditLog!.push({ id: 'start-' + rows.tournamentAuditLog!.length, tournamentId: 't1', action: 'season_game_start_observed', targetId: game.gameId,
        data: { ...payload, digest: seasonContractHash(payload) } })
    }
    observation('not_started', new Date(Date.parse(game.startsAt) - 60000).toISOString())
    observation('in_progress', new Date(Date.parse(game.startsAt) + 60000).toISOString())
    expect(await ledger.reviewSeasonOpeningWeek(...args)).toMatchObject({ state: 'finalized' })
    observation('postponed', new Date(Date.parse(game.startsAt) + 120000).toISOString())
    const before = clone(rows)
    await expect(ledger.reviewSeasonOpeningWeek(...args)).rejects.toThrow('start/correction review')
    await expect(ledger.finalizeSeasonOpeningWeek(...args, initial.revision, initial.reviewToken!)).rejects.toThrow('start/correction review')
    await expect(ledger.readSeasonOpeningScoreLedger(leagueId, 1)).rejects.toThrow('start/correction review')
    expect(rows).toEqual(before)
  }, 120000)
  it('rejects a stale reviewed score revision and requires another review after corrections', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const old = await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args, old.revision, old.reviewToken!)
    await ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'correction', expectedRevision: 1, scores: [{ ...batch.scores[0]!, revision: 2, points: 2 }] })
    await expect(ledger.finalizeSeasonOpeningWeek(...args, old.revision, old.reviewToken!)).rejects.toMatchObject({ status: 409 })
    const current = await ledger.reviewSeasonOpeningWeek(...args)
    expect(current).toMatchObject({ state: 'ready', revision: 2, canFinalize: true })
    expect(await ledger.finalizeSeasonOpeningWeek(...args, current.revision, current.reviewToken!)).toMatchObject({ repeated: false })
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_week_finalized_setup')).toHaveLength(2)
  }, 120000)
  it('refuses early finalization and rechecks owner and frozen binding', async () => {
    const { ledger, leagueId, batch, window } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const report = await ledger.reviewSeasonOpeningWeek(...args)
    await expect(ledger.finalizeSeasonOpeningWeek('outsider', 't1', 'f1', args[3], 1, report.revision, report.reviewToken!)).rejects.toMatchObject({ status: 403 })
    await expect(ledger.reviewSeasonOpeningWeek('owner', 't1', 'wrong-freeze', args[3], 1)).rejects.toMatchObject({ status: 409 })
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.finalizesAt) - 60000)
    await expect(ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)).rejects.toThrow()
    expect(rows.tournamentAuditLog!.some(e => e.action === 'season_week_finalized_setup')).toBe(false)
  }, 120000)
  it('rolls back a failed finalization receipt and refuses a competing session change', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const report = await ledger.reviewSeasonOpeningWeek(...args), before = clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('finalization save failed'))
    await expect(ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)).rejects.toThrow('finalization save failed')
    expect(rows).toEqual(before)
    mock.db.draftSession.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)).rejects.toThrow('checkpoint changed')
    expect(rows).toEqual(before)
  }, 120000)
  it('serializes repeated finalization and detects receipt drift', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const report = await ledger.reviewSeasonOpeningWeek(...args)
    const results = await Promise.all([ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!), ledger.finalizeSeasonOpeningWeek(...args, report.revision, report.reviewToken!)])
    expect(results.map(r => r.repeated).sort()).toEqual([false, true])
    rows.tournamentAuditLog!.find(e => e.action === 'season_week_finalized_setup')!.data.totalsHash = 'changed'
    await expect(ledger.reviewSeasonOpeningWeek(...args)).rejects.toThrow('checkpoint')
  }, 120000)

  it('cannot finalize missing or provisional counted results even with the current review token', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, { ...batch, scores: [] })
    const missing = await ledger.reviewSeasonOpeningWeek(...args)
    expect(missing).toMatchObject({ state: 'provisional', canFinalize: false })
    await expect(ledger.finalizeSeasonOpeningWeek(...args, missing.revision, missing.reviewToken!)).rejects.toMatchObject({ status: 409 })
    await ledger.ingestSeasonOpeningScores(leagueId, { ...batch, requestId: 'provisional', expectedRevision: 1, scores: batch.scores.map(row => ({ ...row, status: 'provisional' as const })) })
    const provisional = await ledger.reviewSeasonOpeningWeek(...args)
    await expect(ledger.finalizeSeasonOpeningWeek(...args, provisional.revision, provisional.reviewToken!)).rejects.toMatchObject({ status: 409 })
    expect(rows.tournamentAuditLog!.some(e => e.action === 'season_week_finalized_setup')).toBe(false)
  }, 120000)

  it('builds the whole frozen field from current receipts and removes superseded totals until re-finalized', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    const args = ['owner', 't1', 'f1', 'stage-1-league-1', 1] as const
    await ledger.ingestSeasonOpeningScores(leagueId, batch)
    const review = await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args, review.revision, review.reviewToken!)
    const before = clone(rows), report = await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)
    expect(report).toMatchObject({ verifiedWeeks:1, requiredWeeks:8, scoresFinal:false, canAdvance:false })
    expect(report.rows).toHaveLength(64)
    expect(report.rows.filter(r=>r.leagueKey==='stage-1-league-1').every(r=>r.pointsFor===0&&r.rank===null)).toBe(true)
    expect(report.rows.filter(r=>r.leagueKey!=='stage-1-league-1').every(r=>r.pointsFor===null)).toBe(true)
    expect(JSON.stringify(report)).not.toContain('player-')
    expect(JSON.stringify(report)).not.toContain('rosterId')
    expect(rows).toEqual(before)
    await ledger.ingestSeasonOpeningScores(leagueId,{...batch,requestId:'new-correction',expectedRevision:1,scores:[{...batch.scores[0]!,revision:2,points:5}]})
    const invalidated = await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)
    expect(invalidated.verifiedWeeks).toBe(0)
    expect(invalidated.weeks.find(w=>w.leagueKey==='stage-1-league-1')).toMatchObject({state:'unfinalized',revision:2})
    expect(invalidated.rows.every(r=>r.pointsFor===null)).toBe(true)
    const newReview = await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args,newReview.revision,newReview.reviewToken!)
    expect((await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)).verifiedWeeks).toBe(1)
  },120000)
  it('keeps missing weeks explicit and refuses stale freezes, outsiders and later stages', async () => {
    const { ledger, leagueId, batch } = await scoreFixture('NFL')
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const report = await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)
    await ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,report.revision,report.reviewToken!)
    const board=await ledger.reviewSeasonOpeningStandings('owner','t1','f1',2)
    expect(board).toMatchObject({requiredWeeks:16,verifiedWeeks:1,scoresFinal:false})
    expect(board.rows.filter(r=>r.leagueKey==='stage-1-league-1').every(r=>r.pointsFor===null&&r.knownFinalizedPoints===0&&r.missingPeriods.includes(2))).toBe(true)
    await expect(ledger.reviewSeasonOpeningStandings('outsider','t1','f1',1)).rejects.toMatchObject({status:403})
    await expect(ledger.reviewSeasonOpeningStandings('owner','t1','stale',1)).rejects.toMatchObject({status:409})
    await expect(ledger.reviewSeasonOpeningStandings('owner','t1','f1',7)).rejects.toMatchObject({status:409})
  },120000)
  it('excludes a drifted finalization receipt from standings instead of trusting its old total', async () => {
    const { ledger, leagueId, batch } = await scoreFixture()
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const report=await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)
    await ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,report.revision,report.reviewToken!)
    rows.tournamentAuditLog!.find(e=>e.action==='season_week_finalized_setup')!.data.totalsHash='drift'
    const board=await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)
    expect(board.verifiedWeeks).toBe(0)
    expect(board.weeks.find(w=>w.leagueKey==='stage-1-league-1')!.state).toBe('review_required')
    expect(board.rows.every(r=>r.pointsFor===null)).toBe(true)
  },120000)

  async function matchupFixture() {
    const f = await scoreFixture()
    vi.mocked(Date.now).mockReturnValue(Date.parse(f.window.startsAt) - 60000)
    const rosterIds = rows.roster!.map(r=>r.id)
    const schedule = { period:1, source:'trusted-native-scheduler', pairs:Array.from({length:rosterIds.length/2},(_,i)=>({homeRosterId:rosterIds[i*2]!,awayRosterId:rosterIds[i*2+1]!})) }
    expect(await f.ledger.captureSeasonOpeningMatchups(f.leagueId,schedule)).toMatchObject({repeated:false,launchReady:false})
    const before=clone(rows)
    expect(await f.ledger.captureSeasonOpeningMatchups(f.leagueId,schedule)).toMatchObject({repeated:true})
    expect(rows).toEqual(before)
    vi.mocked(Date.now).mockReturnValue(Date.parse(f.batch.observedAt))
    return {...f,schedule,rosterIds}
  }
  it('finalizes verified fantasy matchup outcomes atomically and exposes real tie credits without private IDs',async()=>{
    const {ledger,leagueId,batch}=await matchupFixture()
    const args=['owner','t1','f1','stage-1-league-1',1] as const
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const review=await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args,review.revision,review.reviewToken!)
    const outcomes=rows.tournamentAuditLog!.find(e=>e.action==='season_matchup_outcomes_setup')!
    expect(outcomes.data.results).toHaveLength(8)
    expect(outcomes.data.results.every((r:any)=>r.wins===0.5&&r.ties===1&&r.losses===0)).toBe(true)
    const before=clone(rows)
    await ledger.finalizeSeasonOpeningWeek(...args,review.revision,review.reviewToken!)
    expect(rows).toEqual(before)
    const board=await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)
    expect(board.verifiedMatchupWeeks).toBe(1)
    expect(board.rows.filter(r=>r.leagueKey==='stage-1-league-1').every(r=>r.wins===0.5&&r.ties===1)).toBe(true)
    expect(board.rows.filter(r=>r.leagueKey!=='stage-1-league-1').every(r=>r.wins===null)).toBe(true)
    expect(JSON.stringify(board)).not.toContain('opponentRosterId')
    expect(JSON.stringify(board)).not.toContain('rosterId')
  },120000)
  it('invalidates old wins on score correction and derives the new winner only after re-finalization',async()=>{
    const {ledger,leagueId,batch,rosterIds}=await matchupFixture()
    const args=['owner','t1','f1','stage-1-league-1',1] as const
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const old=await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args,old.revision,old.reviewToken!)
    const playerId=rows.roster!.find(r=>r.id===rosterIds[0])!.playerData.starters[0]
    await ledger.ingestSeasonOpeningScores(leagueId,{...batch,requestId:'matchup-correction',expectedRevision:1,scores:[{gameId:'game-1',playerId,revision:2,status:'final',points:5}]})
    expect((await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)).verifiedMatchupWeeks).toBe(0)
    const current=await ledger.reviewSeasonOpeningWeek(...args)
    await ledger.finalizeSeasonOpeningWeek(...args,current.revision,current.reviewToken!)
    const result=rows.tournamentAuditLog!.find(e=>e.action==='season_matchup_outcomes_setup'&&e.data.revision===2)!.data.results
    expect(result.find((r:any)=>r.rosterId===rosterIds[0])).toMatchObject({wins:1,losses:0,ties:0})
    expect(result.find((r:any)=>r.rosterId===rosterIds[1])).toMatchObject({wins:0,losses:1,ties:0})
  },120000)
  it('refuses late fantasy pairing publication and rebinding an existing schedule',async()=>{
    const {ledger,leagueId,schedule}=await matchupFixture()
    const before=clone(rows)
    await expect(ledger.captureSeasonOpeningMatchups(leagueId,{...schedule,source:'different'})).rejects.toThrow('cannot be rebound')
    rows.tournamentAuditLog=rows.tournamentAuditLog!.filter(e=>e.action!=='season_matchups_locked')
    await expect(ledger.captureSeasonOpeningMatchups(leagueId,schedule)).rejects.toThrow('before the scoring week starts')
    rows=clone(before)
  },120000)
  it('rolls back weekly finalization if its matchup receipt cannot be saved',async()=>{
    const {ledger,leagueId,batch}=await matchupFixture()
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const review=await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1),before=clone(rows)
    const create=mock.db.tournamentAuditLog.create.getMockImplementation()!
    mock.db.tournamentAuditLog.create.mockImplementationOnce(create).mockRejectedValueOnce(new Error('outcome save failed'))
    await expect(ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,review.revision,review.reviewToken!)).rejects.toThrow('outcome save failed')
    expect(rows).toEqual(before)
  },120000)
  it('keeps finalized points but refuses drifted win outcomes in standings',async()=>{
    const {ledger,leagueId,batch}=await matchupFixture()
    await ledger.ingestSeasonOpeningScores(leagueId,batch)
    const review=await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)
    await ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,review.revision,review.reviewToken!)
    rows.tournamentAuditLog!.find(e=>e.action==='season_matchup_outcomes_setup')!.data.results[0].wins=1
    const board=await ledger.reviewSeasonOpeningStandings('owner','t1','f1',1)
    expect(board).toMatchObject({verifiedWeeks:1,verifiedMatchupWeeks:0})
    expect(board.weeks.find(w=>w.leagueKey==='stage-1-league-1')!.matchupsState).toBe('review_required')
    expect(board.rows.filter(r=>r.leagueKey==='stage-1-league-1').every(r=>r.pointsFor===0&&r.wins===null)).toBe(true)
  },120000)

  it('previews without writes and publishes exact owner-reviewed pairings idempotently',async()=>{
    const {ledger,leagueId,window}=await scoreFixture()
    const args=['owner','t1','f1','stage-1-league-1',1] as const
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)-60000)
    const before=clone(rows),report=await ledger.previewSeasonOpeningMatchups(...args)
    expect(report).toMatchObject({state:'draft',canPublish:true,launchReady:false})
    expect(report.pairs).toHaveLength(4)
    expect(rows).toEqual(before)
    expect(JSON.stringify(report)).not.toContain('rosterId')
    expect(JSON.stringify(report)).not.toContain('userId')
    expect(await ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).toMatchObject({repeated:false})
    expect(rows.tournamentAuditLog!.find(e=>e.action==='season_matchups_locked')).toMatchObject({actorId:'owner',actorType:'user'})
    const published=await ledger.previewSeasonOpeningMatchups(...args)
    expect(published).toMatchObject({state:'published',canPublish:false,previewToken:report.previewToken,pairs:report.pairs})
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)+1000)
    const after=clone(rows)
    expect(await ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).toMatchObject({repeated:true})
    expect(rows).toEqual(after)
    expect(rows.league!.find(l=>l.id===leagueId)).toMatchObject({locked:true,lifecycleState:'drafting'})
  },120000)
  it('refuses stale or forged previews, outsiders, stale freezes and unpublished late schedules',async()=>{
    const {ledger,window}=await scoreFixture()
    const args=['owner','t1','f1','stage-1-league-1',1] as const
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)-60000)
    const report=await ledger.previewSeasonOpeningMatchups(...args),before=clone(rows)
    await expect(ledger.publishSeasonOpeningMatchups(...args,'0'.repeat(64))).rejects.toMatchObject({status:409})
    await expect(ledger.previewSeasonOpeningMatchups('outsider','t1','f1',args[3],1)).rejects.toMatchObject({status:403})
    await expect(ledger.previewSeasonOpeningMatchups('owner','t1','old',args[3],1)).rejects.toMatchObject({status:409})
    expect(rows).toEqual(before)
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt))
    expect(await ledger.previewSeasonOpeningMatchups(...args)).toMatchObject({state:'closed',canPublish:false})
    await expect(ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).rejects.toMatchObject({status:409})
    expect(rows).toEqual(before)
  },120000)
  it('refuses a preview superseded by an independently published schedule',async()=>{
    const {ledger,leagueId,window}=await scoreFixture()
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)-60000)
    const args=['owner','t1','f1','stage-1-league-1',1] as const,report=await ledger.previewSeasonOpeningMatchups(...args)
    const ids=rows.roster!.map(r=>r.id)
    await ledger.captureSeasonOpeningMatchups(leagueId,{period:1,source:'independent-native-scheduler',pairs:Array.from({length:4},(_,i)=>({homeRosterId:ids[2*i]!,awayRosterId:ids[2*i+1]!}))})
    const before=clone(rows)
    await expect(ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).rejects.toMatchObject({status:409})
    expect(rows).toEqual(before)
    expect((await ledger.previewSeasonOpeningMatchups(...args)).source).toBe('independent-native-scheduler')
  },120000)
  it('rolls back failed owner publication and refuses a deadline crossed while claiming the session',async()=>{
    const {ledger,window}=await scoreFixture()
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)-60000)
    const args=['owner','t1','f1','stage-1-league-1',1] as const,report=await ledger.previewSeasonOpeningMatchups(...args),before=clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('publish audit failed'))
    await expect(ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).rejects.toThrow('publish audit failed')
    expect(rows).toEqual(before)
    const update=mock.db.draftSession.updateMany.getMockImplementation()!
    mock.db.draftSession.updateMany.mockImplementationOnce(async(input:any)=>{const result=await update(input);vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt));return result})
    await expect(ledger.publishSeasonOpeningMatchups(...args,report.previewToken)).rejects.toThrow('deadline passed')
    expect(rows).toEqual(before)
  },120000)
  it('serializes repeated owner publications into one schedule receipt',async()=>{
    const {ledger,window}=await scoreFixture()
    vi.mocked(Date.now).mockReturnValue(Date.parse(window.startsAt)-60000)
    const args=['owner','t1','f1','stage-1-league-1',1] as const,report=await ledger.previewSeasonOpeningMatchups(...args)
    const results=await Promise.all([ledger.publishSeasonOpeningMatchups(...args,report.previewToken),ledger.publishSeasonOpeningMatchups(...args,report.previewToken)])
    expect(results.map(r=>r.repeated).sort()).toEqual([false,true])
    expect(rows.tournamentAuditLog!.filter(e=>e.action==='season_matchups_locked')).toHaveLength(1)
  },120000)

  async function statFixture() {
    const f=await scoreFixture(),provider='rolling_insights' as const
    rows.playerProviderIdentity=f.game.playerIds.map((playerId,i)=>({id:'identity-'+i,playerId,providerPlayerId:'provider-'+i,provider,sportKey:'NBA',leagueKey:null,verified:true,expiresAt:new Date(Date.now()+3600000)}))
    rows.gameProviderIdentity=[{id:'game-identity',gameId:'game-1',providerGameId:'provider-game',provider,sportKey:'NBA',verified:true,expiresAt:new Date(Date.now()+3600000)}]
    const input={requestId:'stat-1',expectedRevision:0,period:1,provider,format:'canonical_game_v1' as const,observedAt:f.batch.observedAt,coverage:'complete' as const,games:[{providerGameId:'provider-game',actualStartsAt:f.game.startsAt,startVerified:true as const,seasonType:'regular' as const,status:'final' as const,rows:rows.playerProviderIdentity.map(p=>({providerPlayerId:p.providerPlayerId,revision:1,stats:{...Object.fromEntries(rows.tournamentAuditLog![0].data.config.rules.weights.filter((w:any)=>w.points!==0).map((w:any)=>[w.statKey,0])),points:2}}))}]}
    return {...f,input}
  }
  function markVendorDraftSource() {
    const ids=rows.roster!.flatMap(r=>(r.playerData as any).players as string[])
    for(const snapshot of rows.tournamentAuditLog!.filter(e=>e.action==='season_draft_pool_checked'))
      for(const player of snapshot.data.players) if(ids.includes(player.playerId)) player.draftIdProvenance={namespace:'rolling_insights',sourceRecordId:'source-'+player.playerId}
    rows.sportsPlayer=ids.map(id=>({id:'source-'+id,sport:'NBA',source:'rolling_insights',externalId:id,sleeperId:null}))
  }
  it('pins a full vendor-keyed draft to verified canonical identities before stat scoring',async()=>{
    const {ledger,leagueId,input}=await statFixture()
    rows.playerProviderIdentity!.forEach((row,i)=>{row.playerId='canonical-'+i;row.providerPlayerId=rows.roster!.flatMap(r=>(r.playerData as any).players)[i]})
    input.games[0].rows.forEach((row,i)=>row.providerPlayerId=rows.playerProviderIdentity![i].providerPlayerId)
    markVendorDraftSource()
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).rejects.toThrow('verified provider identity')
    expect(await ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).toMatchObject({players:96,repeated:false,launchReady:false})
    const after=clone(rows)
    expect(await ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).toMatchObject({repeated:true})
    expect(rows).toEqual(after)
    expect(await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).toMatchObject({revision:1,projection:{canFinalize:true}})
    const evidence=rows.tournamentAuditLog!.find(e=>e.action==='season_scores_ingested')!.data.statEvidence
    expect(evidence.bridgeDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(evidence.bindings.find((b:any)=>b.id==='identity-0')).toMatchObject({canonicalPlayerId:'canonical-0',playerId:rows.playerProviderIdentity![0].providerPlayerId,providerPlayerId:rows.playerProviderIdentity![0].providerPlayerId})
    expect((await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).state).toBe('ready')
    rows.playerProviderIdentity![0].playerId='canonical-relinked'
    await expect(ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).rejects.toThrow('bridge changed')
    rows.playerProviderIdentity![0].playerId='canonical-0'
    rows.sportsPlayer![0].externalId='wrong-provider-id'
    await expect(ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).rejects.toThrow('source record changed')
  },120000)
  it('refuses ambiguous or incomplete vendor-keyed mappings and rolls back a failed bridge receipt',async()=>{
    const {ledger,leagueId}=await statFixture()
    rows.playerProviderIdentity!.forEach((row,i)=>{row.providerPlayerId=rows.roster!.flatMap(r=>(r.playerData as any).players)[i];row.playerId='canonical-'+i})
    await expect(ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).rejects.toThrow('source-namespace evidence')
    markVendorDraftSource()
    rows.sportsPlayer![0].source='other_provider'
    await expect(ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).rejects.toThrow('source no longer matches')
    rows.sportsPlayer![0].source='rolling_insights'
    const duplicate={...rows.playerProviderIdentity![0],id:'other-record',leagueKey:'NBA'}
    rows.playerProviderIdentity!.push(duplicate)
    const before=clone(rows)
    await expect(ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).rejects.toThrow('one current verified')
    expect(rows).toEqual(before)
    rows.playerProviderIdentity!.pop()
    rows.playerProviderIdentity![0].verified=false
    await expect(ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).rejects.toThrow('one current verified')
    rows.playerProviderIdentity![0].verified=true
    const saved=clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('bridge audit failed'))
    await expect(ledger.recordSeasonDraftProviderBridge(leagueId,'rolling_insights')).rejects.toThrow('bridge audit failed')
    expect(rows).toEqual(saved)
  },120000)
  it('scores complete canonical NBA evidence with verified identity provenance and idempotent receipts',async()=>{
    const {ledger,leagueId,input}=await statFixture()
    expect(await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).toMatchObject({revision:1,projection:{canFinalize:true},launchReady:false})
    const after=clone(rows)
    expect(await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).toMatchObject({repeated:true})
    expect(rows).toEqual(after)
    const saved=rows.tournamentAuditLog!.find(e=>e.action==='season_scores_ingested')!
    expect(saved.data.statEvidence).toMatchObject({version:1,raw:{format:'canonical_game_v1'}})
    expect(saved.data.statEvidence.bindings).toHaveLength(96)
    expect(saved.data.evidence.scores.every((score:any)=>score.points===2)).toBe(true)
    const report=await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)
    expect(report).toMatchObject({state:'ready',canFinalize:true})
    expect(JSON.stringify(report)).not.toContain('provider-')
    await ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,report.revision,report.reviewToken!)
    expect(rows.league![0]).toMatchObject({locked:true,lifecycleState:'drafting'})
  },120000)
  it('compacts identical stat revisions and applies corrected stats without retaining old finality',async()=>{
    const {ledger,leagueId,input}=await statFixture()
    await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)
    await ledger.ingestSeasonOpeningStatEvidence(leagueId,{...input,requestId:'stat-2',expectedRevision:1})
    expect(rows.tournamentAuditLog!.find(e=>e.action==='season_scores_ingested'&&e.data.revision===2)!.data.evidence.scores).toHaveLength(96)
    const corrected=clone(input);corrected.requestId='stat-3';corrected.expectedRevision=2;corrected.games[0].status='provisional' as any
    corrected.games[0].rows.forEach(r=>r.revision=2);corrected.games[0].rows[0]!.stats.points=3
    expect(await ledger.ingestSeasonOpeningStatEvidence(leagueId,corrected)).toMatchObject({revision:3,projection:{canFinalize:false}})
    const receipt=rows.tournamentAuditLog!.find(e=>e.action==='season_scores_ingested'&&e.data.revision===3)!
    expect(receipt.data.statEvidence.reconciliation).toMatchObject({ correctedRows:96, statusChangedGames:1, backfilledRows:0, versionAdvancedRows:96 })
    expect(await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).toMatchObject({statRefresh:{correctedRows:96,statusChangedGames:1}})
    receipt.data.statEvidence.reconciliation.correctedRows=0
    const {digest: _digest,...payload}=receipt.data
    receipt.data.digest=seasonContractHash(payload)
    await expect(ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).rejects.toThrow('Stat reconciliation receipt differs')
  },120000)
  it.each(['unverified','expired','ambiguous','postponed','missing-stat','incomplete-coverage'])('refuses %s stat evidence before any receipt is saved',async kind=>{
    const {ledger,leagueId,input}=await statFixture()
    if(kind==='unverified')rows.playerProviderIdentity![0].verified=false
    if(kind==='expired')rows.gameProviderIdentity![0].expiresAt=new Date(Date.now()-1)
    if(kind==='ambiguous')rows.playerProviderIdentity!.push({...rows.playerProviderIdentity![0],id:'duplicate'})
    if(kind==='postponed')input.games[0].actualStartsAt=new Date(Date.parse(input.games[0].actualStartsAt)+1000).toISOString()
    if(kind==='missing-stat')delete (input.games[0].rows[0]!.stats as any).steals
    if(kind==='incomplete-coverage')input.games[0].rows.pop()
    const before=clone(rows)
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).rejects.toThrow()
    expect(rows).toEqual(before)
  },120000)
  it('rejects identity drift and low-level numeric writes after stat provenance is pinned',async()=>{
    const {ledger,leagueId,input,batch}=await statFixture()
    await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)
    rows.playerProviderIdentity![0].id='relinked'
    const before=clone(rows)
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,{...input,requestId:'drift',expectedRevision:1})).rejects.toThrow('identity provenance changed')
    expect(rows).toEqual(before)
    await expect(ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).rejects.toThrow('identity changed')
    await expect(ledger.ingestSeasonOpeningScores(leagueId,{...batch,requestId:'numeric',expectedRevision:1,source:'rolling_insights:canonical_game_v1'})).rejects.toThrow('identity provenance changed')
  },120000)
  it('rolls back a stat-derived score receipt when its audit cannot be saved',async()=>{
    const {ledger,leagueId,input}=await statFixture(),before=clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('stat evidence save failed'))
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).rejects.toThrow('stat evidence save failed')
    expect(rows).toEqual(before)
  },120000)

  it('rechecks stored game identities before owner review and finalization',async()=>{
    const {ledger,leagueId,input}=await statFixture()
    await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)
    const review=await ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)
    rows.gameProviderIdentity![0].providerGameId='relinked-game'
    await expect(ledger.reviewSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1)).rejects.toThrow('game identity changed')
    await expect(ledger.finalizeSeasonOpeningWeek('owner','t1','f1','stage-1-league-1',1,review.revision,review.reviewToken!)).rejects.toThrow('game identity changed')
  },120000)
  it('blocks measured RI NBA boxes when frozen default discipline scoring is unavailable',async()=>{
    const {ledger,leagueId,input}=await statFixture(),before=clone(rows)
    input.format='nba_ri_box_v1' as any
    input.games[0].rows.forEach(r=>{r.stats={points:2,total_rebounds:0,assists:0,steals:0,blocks:0,turnovers:0,three_points_made:0}})
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,input)).rejects.toThrow('NBA box lacks weighted evidence for: technical_foul, flagrant_foul')
    expect(rows).toEqual(before)
  },120000)

  it('refuses changed source stats under the same revision even when fantasy points are identical',async()=>{
    const {ledger,leagueId,input}=await statFixture()
    ;(input.games[0].rows[0]!.stats as any).unscored_note_count=1
    await ledger.ingestSeasonOpeningStatEvidence(leagueId,input)
    ;(input.games[0].rows[0]!.stats as any).unscored_note_count=2
    const before=clone(rows)
    await expect(ledger.ingestSeasonOpeningStatEvidence(leagueId,{...input,requestId:'same-revision-new-stats',expectedRevision:1})).rejects.toThrow('Conflicting source stat revision')
    expect(rows).toEqual(before)
  },120000)

  it('shows a verified completion to the owner without exposing identities or changing state', async () => {
    const { leagueId } = await draft('NBA', 'snake')
    const { reviewSeasonOpeningDraft } = await import('@/lib/tournament/seasonOpeningReadiness')
    const before = clone(rows)
    const report = await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')
    expect(report).toMatchObject({ state: 'completed', filledPicks: 96, totalPicks: 96, launchReady: false })
    expect(Object.keys(report)).not.toContain('context')
    expect(JSON.stringify(report)).not.toContain('player-')
    expect(rows).toEqual(before)
    rows.draftSession![0].status = 'in_progress'
    rows.tournamentAuditLog = rows.tournamentAuditLog!.filter(e => e.action !== 'season_draft_board_completed')
    expect(await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ state: 'checkpoint_pending', launchReady: false })
    expect(rows.draftSession![0].status).toBe('in_progress')
    expect(rows.tournamentAuditLog!.some(e => e.action === 'season_draft_board_completed')).toBe(false)
  })

  it.each([['NBA', 'snake'], ['NFL', 'snake'], ['NBA', 'auction'], ['NFL', 'auction']] as const)('prepares complete %s %s rosters atomically without season activation', async (sport, type) => {
    const { leagueId } = await draft(sport, type)
    const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')
    const { reviewSeasonOpeningDraft } = await import('@/lib/tournament/seasonOpeningReadiness')
    await expect(prepareSeasonOpeningRosters('outsider', 't1', 'f1', 'stage-1-league-1')).rejects.toMatchObject({ status: 403 })
    expect(await prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ prepared: true, repeated: false, teams: 8, launchReady: false })
    for (const row of rows.roster!) {
      const data = row.playerData
      expect(data.players).toHaveLength(rows.draftSession![0].rounds)
      expect(data.lineup_sections.ir).toEqual([])
      expect(data.foundation.createdBy).toBe('season_tournament')
      expect(new Set(data.players).size).toBe(data.players.length)
    }
    expect(rows.league![0]).toMatchObject({ lifecycleState: 'drafting', locked: true })
    expect(rows.leagueWaiverState![0].processingLocked).toBe(true)
    const before = clone(rows)
    expect(await prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ repeated: true })
    expect(rows).toEqual(before)
    expect(await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ rostersPrepared: true, launchReady: false })
    rows.roster![0].playerData.starters = []
    await expect(prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).rejects.toMatchObject({ status: 409 })
    expect((await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')).state).toBe('review_required')
  }, 120000)
  it('rolls back every roster when preparation audit saving fails', async () => {
    await draft('NBA', 'snake')
    const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')
    const before = clone(rows)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('audit failed'))
    await expect(prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).rejects.toThrow('audit failed')
    expect(rows).toEqual(before)
    expect(await prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ prepared: true })
  }, 120000)
  it('refuses preparation if a roster or session changes before its version claim', async () => {
    await draft('NBA', 'snake')
    const { prepareSeasonOpeningRosters } = await import('@/lib/tournament/seasonRosterPreparation')
    const before = clone(rows)
    mock.db.roster.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).rejects.toMatchObject({ status: 409 })
    expect(rows).toEqual(before)
    mock.db.draftSession.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(prepareSeasonOpeningRosters('owner', 't1', 'f1', 'stage-1-league-1')).rejects.toMatchObject({ status: 409 })
    expect(rows).toEqual(before)
  }, 120000)

  it.each(['force', 'trades', 'owner', 'session', 'clock', 'auction'])('refuses unsupported manual tournament pick %s overrides before insertion', async kind => {
    const { session, leagueId } = await setup('NBA', 'snake')
    const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
    const player = (await loadSeasonDraftPlayers(leagueId, 'NBA'))[0]!
    const input: any = { leagueId, ...player, rosterId: session.slotOrder[0].rosterId }
    if (kind === 'force') input.commissionerOverride = true
    if (kind === 'trades') input.tradedPicks = [{}]
    if (kind === 'owner') input.rosterId = session.slotOrder[1].rosterId
    if (kind === 'session') session.slotOrder.reverse()
    if (kind === 'clock') session.timerSeconds++
    if (kind === 'auction') session.draftType = 'auction'
    const before = clone(rows)
    expect((await submitPick(input)).success).toBe(false)
    expect(rows).toEqual(before)
  })

  it('rolls back completion when audit saving fails and safely retries', async () => {
    const { session, leagueId } = await draft('NBA', 'snake')
    session.status = 'in_progress'
    rows.tournamentAuditLog = rows.tournamentAuditLog!.filter(e => e.action !== 'season_draft_board_completed')
    const before = clone(session)
    mock.db.tournamentAuditLog.create.mockRejectedValueOnce(new Error('checkpoint unavailable'))
    const { completeSeasonDraft } = await import('@/lib/tournament/seasonDraftCompletion')
    await expect(completeSeasonDraft(leagueId)).rejects.toThrow('checkpoint unavailable')
    expect(rows.draftSession![0]).toEqual(before)
    const results = await Promise.all([completeSeasonDraft(leagueId), completeSeasonDraft(leagueId)])
    expect(results).toEqual([true, true])
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_board_completed')).toHaveLength(1)
  }, 120000)

  it('refuses an auction receipt whose charge differs from the completed budget ledger', async () => {
    const { leagueId } = await draft('NBA', 'auction')
    rows.draftPick![0].amount = 2
    const { completeSeasonDraft } = await import('@/lib/tournament/seasonDraftCompletion')
    expect(await completeSeasonDraft(leagueId)).toBe(false)
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_board_completed')).toHaveLength(1)
  }, 120000)

  it('does not save a completion receipt if a control wins the version claim', async () => {
    const { leagueId } = await draft('NBA', 'snake')
    rows.draftSession![0].status = 'in_progress'
    rows.tournamentAuditLog = rows.tournamentAuditLog!.filter(e => e.action !== 'season_draft_board_completed')
    mock.db.draftSession.updateMany.mockResolvedValueOnce({ count: 0 })
    const { completeSeasonDraft } = await import('@/lib/tournament/seasonDraftCompletion')
    expect(await completeSeasonDraft(leagueId)).toBe(false)
    expect(rows.draftSession![0].status).toBe('in_progress')
    expect(rows.tournamentAuditLog!.filter(e => e.action === 'season_draft_board_completed')).toHaveLength(0)
    expect(await completeSeasonDraft(leagueId)).toBe(true)
  }, 120000)

  it.each(['identity', 'ownership', 'overall', 'position', 'contract', 'locks', 'roster', 'checkpoint'])('rejects completed-board %s tampering', async kind => {
    const { session, leagueId } = await draft('NBA', 'snake')
    if (kind === 'identity') rows.draftPick![0].playerId = 'unknown'
    if (kind === 'ownership') rows.draftPick![0].rosterId = session.slotOrder[1].rosterId
    if (kind === 'overall') rows.draftPick![0].overall = 2
    if (kind === 'position') rows.draftPick![0].position = 'QB'
    if (kind === 'contract') session.rounds++
    if (kind === 'roster') rows.roster![0].platformUserId = 'replacement'
    if (kind === 'locks') rows.leagueWaiverState![0].processingLocked = false
    if (kind === 'checkpoint') rows.tournamentAuditLog = rows.tournamentAuditLog!.filter(e => e.action !== 'season_draft_board_completed')
    const before = clone(rows)
    const { completeSeasonDraft } = await import('@/lib/tournament/seasonDraftCompletion')
    expect(await completeSeasonDraft(leagueId)).toBe(false)
    expect(rows).toEqual(before)
  }, 120000)
})

describe('opening draft readonly readiness access', () => {
  it('refuses outsiders, stale freezes and unknown leagues before assessment', async () => {
    await provision()
    const { reviewSeasonOpeningDraft } = await import('@/lib/tournament/seasonOpeningReadiness')
    await expect(reviewSeasonOpeningDraft('outsider', 't1', 'f1', 'stage-1-league-1')).rejects.toMatchObject({ status: 403 })
    await expect(reviewSeasonOpeningDraft('owner', 't1', 'old', 'stage-1-league-1')).rejects.toMatchObject({ status: 409 })
    await expect(reviewSeasonOpeningDraft('owner', 't1', 'f1', 'unknown')).rejects.toMatchObject({ status: 404 })
    const before = clone(rows)
    expect(await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')).toMatchObject({ state: 'not_started', filledPicks: 0, totalPicks: 96, launchReady: false })
    expect(rows).toEqual(before)
    rows.league![0].settings.seasonTournament = null
    const failed = await reviewSeasonOpeningDraft('owner', 't1', 'f1', 'stage-1-league-1')
    expect(failed.state).toBe('review_required'); expect(failed.launchReady).toBe(false)
    expect(JSON.stringify(failed)).not.toContain('connection')
  })
  it('blocks direct redraft materialization for native tournament markers', async () => {
    await provision(); rows.league![0].settings = { seasonTournament: null }
    const { syncCompletedDraftToRedraftSeason } = await import('@/lib/redraft/finalizeDraftToRedraftSeason')
    const before = clone(rows)
    expect(await syncCompletedDraftToRedraftSeason(rows.league![0].id)).toMatchObject({ skipped: true, reason: 'season_tournament_managed' })
    const { finalizeRosterAssignments } = await import('@/lib/live-draft-engine/RosterAssignmentService')
    expect(await finalizeRosterAssignments(rows.league![0].id)).toMatchObject({ teamsSynced: 0, playersSynced: 0 })
    expect(rows).toEqual(before)
  })
})

it('blocks lineup bypass flags and direct AF player moves for native markers', async () => {
  await provision(); const leagueId = rows.league![0].id
  const { persistRosterLineupWithEngine } = await import('@/lib/roster-lineup-engine/lineupService')
  const { applyTradeAssetsInTransaction } = await import('@/lib/league-trade-engine/tradeProcessor')
  const before = clone(rows)
  expect(await persistRosterLineupWithEngine({ leagueId, rosterId: rows.roster![0].id, actorUserId: 'owner', nextPlayerData: {}, season: 2026, week: 1, source: 'commissioner_override', skipLockCheck: true })).toMatchObject({ ok: false, status: 409 })
  await expect(applyTradeAssetsInTransaction(mock.db, { leagueId, proposerRosterId: 'a', receiverRosterId: 'b', assets: [] })).rejects.toThrow('Tournament player moves')
  expect(rows).toEqual(before)
})

it('blocks late draft-snapshot appends from overwriting prepared native lineups', async () => {
  await provision(); const roster = rows.roster![0]
  roster.playerData = { ...roster.playerData, players: ['prepared-player'], lineup_sections: { starters: [{ id: 'prepared-player' }], bench: [] } }
  const before = clone(rows)
  const { appendPickToRosterDraftSnapshot } = await vi.importActual<typeof import('@/lib/live-draft-engine/RosterAssignmentService')>('@/lib/live-draft-engine/RosterAssignmentService')
  await appendPickToRosterDraftSnapshot(rows.league![0].id, roster.id, { playerId: 'late-player', playerName: 'Late player', position: 'PG' })
  expect(rows).toEqual(before)
})
