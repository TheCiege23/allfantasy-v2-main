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
  // 2026-11-19: 492 Fantrax MLB players on a club had a same-name record on another club (offseason trades).
  it('links a player who changed club only when the name is unique on both sides and the role fits (Dillon Tate)', () => {
    const tate = row('tate', 'Dillon Tate', 'TORONTO BLUE JAYS', 'P')
    const ref = { fantraxId: 't', name: 'Tate, Dillon', team: 'LAA', position: 'RP' }
    expect(planMlbFantraxIdentityLinks([ref], [tate], { fullDirectory: true }).links).toEqual([{ id: 'tate', fantraxId: 't', rollingInsightsId: 'ri-tate' }])
    // A namesake anywhere (even linked), a second Fantrax Dillon Tate (even unattached), or a hitter: refused.
    expect(planMlbFantraxIdentityLinks([ref], [tate, { ...row('t2', 'Dillon Tate', 'ATL', 'P'), fantraxId: 'taken' }], { fullDirectory: true }).links).toEqual([])
    expect(planMlbFantraxIdentityLinks([ref, { ...ref, fantraxId: 'u', team: '(N/A)' }], [tate], { fullDirectory: true }).links.filter((l) => l.fantraxId === 't')).toEqual([])
    expect(planMlbFantraxIdentityLinks([{ ...ref, position: 'CF' }], [tate], { fullDirectory: true }).links).toEqual([])
  })
  it('reads the registry\'s generic "IF" as a hitter (Danny Serretti 2B / IF)', () => {
    expect(planMlbFantraxIdentityLinks([{ fantraxId: 's', name: 'Serretti, Danny', team: 'ARI', position: '2B' }],
      [row('s', 'Danny Serretti', 'ARIZONA DIAMONDBACKS', 'IF')]).links).toHaveLength(1)
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
