// @vitest-environment node
/**
 * A public ESPN league owned by the AllFantasy system account (people joined it by picking a team)
 * must keep refreshing — and refreshing it must never hand a member their own owned copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: [] as Array<{ id: string; userId: string; platform: string; platformLeagueId: string; season: number }>,
  teams: [] as Array<{ leagueId: string; claimedByUserId: string | null }>,
  pipeline: vi.fn(),
  persist: vi.fn(),
  manualRefresh: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const where = (row: any, w: any) =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k])
      if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not
      return row[k] === v
    })
  return {
    prisma: {
      league: { findMany: vi.fn(async ({ where: w }: any) => h.leagues.filter((l) => where(l, w))) },
      leagueTeam: { findMany: vi.fn(async ({ where: w }: any) => h.teams.filter((t) => where(t, w))) },
    },
  }
})
vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: h.pipeline,
}))
vi.mock('@/lib/league-import/importPersistenceService', () => ({ persistImportWithCanonicalAudit: h.persist }))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({
  buildCanonicalImportBundle: () => ({ warnings: [], reviewRequired: false }),
}))
vi.mock('@/lib/import-os/collector', () => ({ manualRefreshConnectedSleeperLeague: h.manualRefresh }))

import { SYSTEM_LEAGUE_OWNER_ID } from '@/lib/league-import/systemLeagueOwner'
import {
  connectionReadableWithoutCredential,
  resolveCredentialCandidates,
} from '@/lib/import-os/collector/normalizedLoader'
import { resyncImportedLeague } from '@/lib/league-import/resyncImportUtility'

const CONNECTION = { provider: 'espn', externalLeagueId: '777', season: 2026, sport: 'NFL' } as any
const NORMALIZED = { source: { source_league_id: '777' }, league: { season: 2026 }, rosters: [] }

beforeEach(() => {
  vi.clearAllMocks()
  h.leagues = []
  h.teams = []
  h.pipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.persist.mockResolvedValue({ persisted: { league: { id: 'L-sys' } }, runId: 'r1' })
  h.manualRefresh.mockResolvedValue({ ok: true, sync: { status: 'completed', advancedFreshness: true, executed: true } })
})

describe('collector: a system-owned public ESPN league', () => {
  it('is readable without a stored credential, so the preflight does not skip it', async () => {
    h.leagues.push({ id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '777', season: 2026 })
    expect(await connectionReadableWithoutCredential(CONNECTION)).toBe(true)
  })

  it('a league a person owns still needs that person\'s credential', async () => {
    h.leagues.push({ id: 'L-carol', userId: 'carol', platform: 'espn', platformLeagueId: '777', season: 2026 })
    expect(await connectionReadableWithoutCredential(CONNECTION)).toBe(false)
    expect(await connectionReadableWithoutCredential({ ...CONNECTION, provider: 'yahoo' })).toBe(false)
  })

  it("tries the owner first, then members who claimed a team — whose ESPN cookies may be the only ones", async () => {
    h.leagues.push({ id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '777', season: 2026 })
    h.teams.push({ leagueId: 'L-sys', claimedByUserId: 'alice' }, { leagueId: 'L-sys', claimedByUserId: null }, { leagueId: 'L-sys', claimedByUserId: 'bob' })
    expect(await resolveCredentialCandidates(CONNECTION)).toEqual([SYSTEM_LEAGUE_OWNER_ID, 'alice', 'bob'])
  })
})

describe('resync: never a member-owned copy', () => {
  it('a member of a system-owned league refreshes the system row', async () => {
    h.leagues.push({ id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '777', season: 2026 })
    h.teams.push({ leagueId: 'L-sys', claimedByUserId: 'alice' })
    const out = await resyncImportedLeague({ userId: 'alice', provider: 'espn', sourceId: '777' })
    expect(out.ok).toBe(true)
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: SYSTEM_LEAGUE_OWNER_ID }))
    // The refresh still authorizes the CALLER, not the owner.
    expect(h.manualRefresh).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice', leagueId: 'L-sys' }))
  })

  it('someone with their own row keeps refreshing their own row', async () => {
    h.leagues.push(
      { id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '777', season: 2026 },
      { id: 'L-carol', userId: 'carol', platform: 'espn', platformLeagueId: '777', season: 2026 },
    )
    await resyncImportedLeague({ userId: 'carol', provider: 'espn', sourceId: '777' })
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: 'carol' }))
  })

  it('someone holding no team writes nothing: no copy, no refresh of the system row', async () => {
    h.leagues.push({ id: 'L-sys', userId: SYSTEM_LEAGUE_OWNER_ID, platform: 'espn', platformLeagueId: '777', season: 2026 })
    const out = await resyncImportedLeague({ userId: 'mallory', provider: 'espn', sourceId: '777' })
    expect(out).toMatchObject({ ok: false, httpStatus: 403 })
    expect(h.persist).not.toHaveBeenCalled()
    expect(h.manualRefresh).not.toHaveBeenCalled()
  })

  it('every provider, not only ESPN: a Sleeper member refreshes the league their commissioner imported', async () => {
    h.leagues.push({ id: 'L-dana', userId: 'dana', platform: 'sleeper', platformLeagueId: '777', season: 2026 })
    h.teams.push({ leagueId: 'L-dana', claimedByUserId: 'alice' })
    await resyncImportedLeague({ userId: 'alice', provider: 'sleeper', sourceId: '777' })
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: 'dana' }))
    expect(h.manualRefresh).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice' }))
  })

  it("a league nobody has imported yet is still the caller's to import", async () => {
    await resyncImportedLeague({ userId: 'alice', provider: 'sleeper', sourceId: '777' })
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice' }))
  })

  it('a different season is a different league row', async () => {
    h.leagues.push({ id: 'L-dana-25', userId: 'dana', platform: 'sleeper', platformLeagueId: '777', season: 2025 })
    await resyncImportedLeague({ userId: 'alice', provider: 'sleeper', sourceId: '777' })
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ userId: 'alice' }))
  })
})
