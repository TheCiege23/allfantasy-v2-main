// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(),
  commissioner: vi.fn(),
  member: vi.fn(),
  resolveConflict: vi.fn(),
  executeMerge: vi.fn(),
  connectSource: vi.fn(),
  db: {
    devyImportSession: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    devyImportSource: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    devyPlayerMapping: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    devyManagerMapping: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    devyMergeConflict: { findMany: vi.fn(), findFirst: vi.fn() },
    leagueTeam: { findMany: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueCommissioner: m.commissioner, assertLeagueMember: m.member }))
vi.mock('@/lib/devy/conflictResolutionEngine', () => ({ resolveConflict: m.resolveConflict }))
vi.mock('@/lib/devy/mergeExecutionEngine', () => ({ executeMerge: m.executeMerge, generateImportAudit: vi.fn() }))
vi.mock('@/lib/devy/importEngine', () => ({ connectSource: m.connectSource, createImportSession: vi.fn() }))
vi.mock('@/lib/devy/identityMatchingEngine', () => ({ detectMergeConflicts: vi.fn(), matchManagers: vi.fn(), matchPlayers: vi.fn() }))

import { GET as sessionGET } from '@/app/api/devy/import/route'
import { GET as sourcesGET, POST as sourcesPOST } from '@/app/api/devy/import/sources/route'
import { GET as matchGET } from '@/app/api/devy/import/match/route'
import { PATCH as mappingsPATCH } from '@/app/api/devy/import/mappings/route'
import { PATCH as conflictsPATCH } from '@/app/api/devy/import/conflicts/route'
import { POST as executePOST } from '@/app/api/devy/import/execute/route'

const get = (path: string) => new NextRequest(`http://localhost${path}`)
const send = (path: string, method: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method, body: JSON.stringify(body) })

const row = (o: Record<string, unknown> = {}) => ({ id: 'S1', leagueId: 'L1', commissionerId: 'creator', status: 'conflict_review', ...o })

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'me' } })
  m.commissioner.mockResolvedValue({ ok: true })
  m.member.mockResolvedValue({ ok: true })
  m.db.devyImportSession.findFirst.mockResolvedValue(row())
})

describe('GET /api/devy/import?leagueId — past sessions', () => {
  it('is commissioner-only', async () => {
    m.commissioner.mockResolvedValue({ ok: false, status: 403 })
    const res = await sessionGET(get('/api/devy/import?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(m.commissioner).toHaveBeenCalledWith('L1', 'me')
    expect(m.db.devyImportSession.findMany).not.toHaveBeenCalled()
  })
  it("lists that league's sessions, newest first, without raw source data", async () => {
    m.db.devyImportSession.findMany.mockResolvedValue([{ id: 'S1' }])
    const res = await sessionGET(get('/api/devy/import?leagueId=L1'))
    expect(await res.json()).toEqual({ sessions: [{ id: 'S1' }] })
    const q = m.db.devyImportSession.findMany.mock.calls[0][0]
    expect(q.where).toEqual({ leagueId: 'L1' })
    expect(q.orderBy).toEqual({ createdAt: 'desc' })
    expect(q.select.sources.select).not.toHaveProperty('rawData')
  })
  it('a sessionId still reads one session for a member', async () => {
    const res = await sessionGET(get('/api/devy/import?sessionId=S1'))
    expect(res.status).toBe(200)
    expect(m.member).toHaveBeenCalledWith('L1', 'me')
    expect(m.db.devyImportSession.findMany).not.toHaveBeenCalled()
  })
})

describe('sources route', () => {
  const src = (rawData: unknown, o: Record<string, unknown> = {}) => ({
    id: 'x', sessionId: 'S1', sourceType: 'league_id_entry', sourcePlatform: 'sleeper', classification: 'nfl_roster',
    connectionStatus: 'connected', importedAt: null, createdAt: new Date('2026-10-01'), rawData, ...o,
  })
  it('GET is commissioner-only', async () => {
    m.commissioner.mockResolvedValue({ ok: false, status: 403 })
    expect((await sourcesGET(get('/api/devy/import/sources?sessionId=S1'))).status).toBe(403)
    expect(m.db.devyImportSource.findMany).not.toHaveBeenCalled()
  })
  it('GET summarises each source and never returns rawData', async () => {
    m.db.devyImportSource.findMany.mockResolvedValue([
      src({ league: { season: '2025' }, users: [{}, {}], rosters: [{ players: ['a', 'b'] }, { players: ['c'] }, {}] }),
      src({ players: [{}, {}], error: 'boom' }, { id: 'y', sourceType: 'csv_upload', sourcePlatform: 'csv', connectionStatus: 'failed' }),
    ])
    const json = await (await sourcesGET(get('/api/devy/import/sources?sessionId=S1'))).json()
    expect(json.sources[0]).toMatchObject({ id: 'x', playerCount: 3, managerCount: 2, season: 2025, hasError: false })
    expect(json.sources[1]).toMatchObject({ id: 'y', playerCount: 2, managerCount: 0, season: null, hasError: true })
    expect(JSON.stringify(json)).not.toMatch(/rawData|boom/)
  })
  it('POST returns the summary too, not the raw payload', async () => {
    m.connectSource.mockResolvedValue(src({ users: [{ user_id: 'secret-ish' }], rosters: [] }))
    const json = await (await sourcesPOST(send('/api/devy/import/sources', 'POST', { sessionId: 'S1', sourceType: 'league_id_entry', platform: 'sleeper', data: { leagueId: '1' } }))).json()
    expect(json.source).toMatchObject({ id: 'x', managerCount: 1 })
    expect(JSON.stringify(json)).not.toContain('secret-ish')
  })
})

describe('GET /api/devy/import/match — league managers to link to', () => {
  it('returns only claimed teams, labelled by owner name', async () => {
    for (const k of ['devyPlayerMapping', 'devyManagerMapping', 'devyMergeConflict'] as const) m.db[k].findMany.mockResolvedValue([])
    m.db.leagueTeam.findMany.mockResolvedValue([
      { claimedByUserId: 'u1', ownerName: 'Ann', teamName: 'A' },
      { claimedByUserId: null, ownerName: 'Orphan', teamName: 'O' },
      { claimedByUserId: 'u3', ownerName: '', teamName: 'Team C' },
    ])
    const json = await (await matchGET(get('/api/devy/import/match?sessionId=S1'))).json()
    expect(json.leagueManagers).toEqual([{ userId: 'u1', label: 'Ann' }, { userId: 'u3', label: 'Team C' }])
    expect(m.db.leagueTeam.findMany).toHaveBeenCalledWith({ where: { leagueId: 'L1' } })
  })
})

describe('PATCH /api/devy/import/mappings', () => {
  it('refuses an unknown action before touching anything', async () => {
    const res = await mappingsPATCH(send('/api/devy/import/mappings', 'PATCH', { sessionId: 'S1', mappingId: 'p1', action: 'delete' }))
    expect(res.status).toBe(400)
    expect(m.db.devyPlayerMapping.update).not.toHaveBeenCalled()
  })
  it('a picked player carries its name onto the mapping', async () => {
    m.db.devyPlayerMapping.findFirst.mockResolvedValue({ id: 'p1' })
    m.db.devyPlayerMapping.update.mockResolvedValue({ id: 'p1' })
    await mappingsPATCH(send('/api/devy/import/mappings', 'PATCH', { sessionId: 'S1', mappingId: 'p1', action: 'confirm', internalPlayerId: 'ip9', internalPlayerName: 'Nine' }))
    expect(m.db.devyPlayerMapping.update.mock.calls[0][0].data).toEqual({ isConfirmedByCommissioner: true, internalPlayerId: 'ip9', internalPlayerName: 'Nine', requiresReview: false })
  })
  it('a plain confirm leaves the matched player and its name alone', async () => {
    m.db.devyPlayerMapping.findFirst.mockResolvedValue({ id: 'p1' })
    m.db.devyPlayerMapping.update.mockResolvedValue({ id: 'p1' })
    await mappingsPATCH(send('/api/devy/import/mappings', 'PATCH', { sessionId: 'S1', mappingId: 'p1', action: 'confirm' }))
    const data = m.db.devyPlayerMapping.update.mock.calls[0][0].data
    expect(data.internalPlayerId).toBeUndefined()
    expect(data.internalPlayerName).toBeUndefined()
  })
})

describe('PATCH /api/devy/import/conflicts', () => {
  it('answers 400 for an invalid resolution instead of throwing a 500', async () => {
    const res = await conflictsPATCH(send('/api/devy/import/conflicts', 'PATCH', { conflictId: 'c1', resolution: 'delete_everything' }))
    expect(res.status).toBe(400)
    expect(m.resolveConflict).not.toHaveBeenCalled()
  })
  it('passes a valid resolution through', async () => {
    m.db.devyMergeConflict.findFirst.mockResolvedValue({ id: 'c1', sessionId: 'S1' })
    const res = await conflictsPATCH(send('/api/devy/import/conflicts', 'PATCH', { conflictId: 'c1', resolution: 'skipped', note: 'n' }))
    expect(res.status).toBe(200)
    expect(m.resolveConflict).toHaveBeenCalledWith('c1', 'skipped', 'n', 'me')
  })
})

describe('POST /api/devy/import/execute', () => {
  it('refuses to merge a session twice', async () => {
    m.db.devyImportSession.findFirst.mockResolvedValue(row({ status: 'merged' }))
    const res = await executePOST(send('/api/devy/import/execute', 'POST', { sessionId: 'S1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'already_merged' })
    expect(m.executeMerge).not.toHaveBeenCalled()
    expect(m.db.devyImportSession.update).not.toHaveBeenCalled()
  })
  it('a co-commissioner can run a session someone else created', async () => {
    m.executeMerge.mockResolvedValue({ ok: true, playersWritten: 1, seasonsWritten: 0, picksWritten: 0, errors: [] })
    const res = await executePOST(send('/api/devy/import/execute', 'POST', { sessionId: 'S1' }))
    expect(res.status).toBe(200)
    expect(m.commissioner).toHaveBeenCalledWith('L1', 'me')
    expect(m.executeMerge).toHaveBeenCalledWith('S1', 'creator')
  })
  it('is still commissioner-gated', async () => {
    m.commissioner.mockResolvedValue({ ok: false, status: 403 })
    const res = await executePOST(send('/api/devy/import/execute', 'POST', { sessionId: 'S1' }))
    expect(res.status).toBe(403)
    expect(m.executeMerge).not.toHaveBeenCalled()
  })
})
