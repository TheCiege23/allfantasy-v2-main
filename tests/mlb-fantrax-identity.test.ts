import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planMlbFantraxIdentityLinks, type MlbIdentityRow } from '@/lib/player-identity/mlbFantraxIdentityPlan'
import { ingestMlbFantraxIdentities } from '@/lib/player-identity/ingestMlbFantraxIdentities'
import publicMap from './fixtures/fantrax/mlb-player-map-public.json'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
const mocks = vi.hoisted(() => ({ marker: vi.fn(), upsert: vi.fn(), identities: vi.fn(), update: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: mocks.marker, upsert: mocks.upsert }, playerIdentityMap: { findMany: mocks.identities }, $executeRaw: mocks.update } }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxPlayerIds: mocks.provider }))
const row = (id: string, name: string, team: string, position: string): MlbIdentityRow => ({ id, canonicalName: name, currentTeam: team, position, fantraxId: null, rollingInsightsId: `ri-${id}` })
describe('MLB Fantrax native identity links', () => {
  it('links the captured public player references and keeps Ohtani eligible for utility', () => {
    const identities = [row('judge', 'Aaron Judge', 'NEW YORK YANKEES', 'RF'), row('ohtani', 'Shohei Ohtani', 'LOS ANGELES DODGERS', 'TWP'), row('smith', 'Will Smith', 'LOS ANGELES DODGERS', 'C')]
    expect(planMlbFantraxIdentityLinks(publicMap.players, identities).links).toHaveLength(3)
    expect(allowedPositionsForSlot('MLB', 'UTIL')).toContain('TWP')
  })
  it('requires matching current team and pitching/batting role, including duplicate names', () => {
    const refs = [{ fantraxId: 'catcher', name: 'Smith, Will', team: 'LAD', position: 'C' }, { fantraxId: 'pitcher', name: 'Smith, Will', team: 'KC', position: 'RP' }]
    const plan = planMlbFantraxIdentityLinks(refs, [row('c', 'Will Smith', 'Los Angeles Dodgers', 'C'), row('p', 'Will Smith', 'Kansas City Royals', 'P')])
    expect(plan.links).toEqual([{ id: 'c', fantraxId: 'catcher', rollingInsightsId: 'ri-c' }, { id: 'p', fantraxId: 'pitcher', rollingInsightsId: 'ri-p' }])
  })
  it('refuses missing teams, duplicate native rows and multiple source identities for one native player', () => {
    const ref = { fantraxId: 'a', name: 'Judge, Aaron', team: 'NYY', position: 'OF' }
    const identities = [row('one', 'Aaron Judge', 'New York Yankees', 'RF')]
    expect(planMlbFantraxIdentityLinks([{ ...ref, team: '(N/A)' }], identities).links).toEqual([])
    expect(planMlbFantraxIdentityLinks([ref], [...identities, row('two', 'Aaron Judge', 'NYY', 'OF')]).ambiguous).toBe(1)
    expect(planMlbFantraxIdentityLinks([ref, { ...ref, fantraxId: 'b' }], identities).links).toEqual([])
  })
  it('never overwrites an existing link or reuses another player’s source ID', () => {
    const ref = { fantraxId: 'a', name: 'Judge, Aaron', team: 'NYY', position: 'RF' }
    const identity = row('one', 'Aaron Judge', 'NYY', 'RF')
    expect(planMlbFantraxIdentityLinks([ref], [{ ...identity, fantraxId: 'old' }]).conflicts).toBe(1)
    expect(planMlbFantraxIdentityLinks([ref], [{ ...identity, fantraxId: 'a' }]).unchanged).toBe(1)
    expect(planMlbFantraxIdentityLinks([ref], [identity, { ...row('other', 'Other Player', 'ATL', 'OF'), fantraxId: 'a' }]).links).toEqual([])
  })
})
describe('scheduled MLB identity ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.marker.mockResolvedValue(null)
    mocks.identities.mockResolvedValue([row('one', 'Aaron Judge', 'NYY', 'RF')])
    mocks.provider.mockResolvedValue({ ok: true, data: { a: { fantraxId: 'a', name: 'Judge, Aaron', team: 'NYY', position: 'RF' } } })
    mocks.update.mockResolvedValue(1)
  })
  it('skips the provider inside weekly cadence', async () => {
    mocks.marker.mockResolvedValue({ data: { at: new Date().toISOString() } })
    expect(await ingestMlbFantraxIdentities()).toMatchObject({ skipped: 'weekly cadence' })
    expect(mocks.provider).not.toHaveBeenCalled()
  })
  it('dry runs without updating IDs or the cadence marker', async () => {
    expect(await ingestMlbFantraxIdentities(true)).toMatchObject({ proposed: 1, updated: 0, dryRun: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('batches additive updates and records success only after the write', async () => {
    expect(await ingestMlbFantraxIdentities()).toMatchObject({ updated: 1 })
    const [sql, payload] = mocks.update.mock.calls[0]!
    expect(sql.join('')).toContain('p."fantraxId" IS NULL')
    expect(JSON.parse(payload)).toEqual([{ id: 'one', fantraxId: 'a', rollingInsightsId: 'ri-one' }])
    expect(mocks.upsert).toHaveBeenCalled()
  })
})
