import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/leagues/import/commit with `pairWithLeagueId` — the other half of a C2C / devy league,
 * picked on the confirm screen. It is linked through the same `linkHalves` as Connect leagues, AFTER
 * the league is built, and it never fails the import.
 */

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  assertImportCommissioner: vi.fn(),
  runPipeline: vi.fn(),
  persist: vi.fn(),
  applyAttestedCommissioner: vi.fn(async () => ({ teamsUpdated: 1 })),
  linkHalves: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser, requireAgeConfirmedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/commissionerGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/commissionerGate')>()),
  assertImportCommissioner: h.assertImportCommissioner,
  recordImportAttestation: vi.fn(async () => {}),
  applyAttestedCommissioner: h.applyAttestedCommissioner,
  OPEN_READ_PROVIDERS: ['fantrax', 'fleaflicker'],
}))
vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: h.runPipeline,
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({
  buildCanonicalImportBundle: () => ({}),
}))
vi.mock('@/lib/league-import/importPersistenceService', () => ({
  persistImportWithCanonicalAudit: h.persist,
  ImportRunInFlightError: class ImportRunInFlightError extends Error {},
}))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  ImportedLeagueConflictError: class ImportedLeagueConflictError extends Error {},
  ImportedLeagueTombstonedError: class ImportedLeagueTombstonedError extends Error {},
  ImportedLeagueAlreadyHereError: class ImportedLeagueAlreadyHereError extends Error {},
}))

vi.mock('@/lib/league/collegePro/linkHalves', () => ({ linkHalves: h.linkHalves }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: vi.fn(async () => ({ name: 'Cream Bowl', userId: 'af-user-1' })) } },
}))

import { POST } from '@/app/api/leagues/import/commit/route'

function commit(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/leagues/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )
}

const persisted = (over: Record<string, unknown> = {}) => ({
  persisted: {
    league: { id: 'peach', name: 'Peach Bowl (C2C)', sport: 'NFL' },
    historicalBackfill: null,
    existed: false,
    joinedExisting: false,
    incompleteSteps: [],
    ...over,
  },
  skipped: false,
  runId: 'run-1',
})

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'af-user-1' })
  h.assertImportCommissioner.mockResolvedValue({ ok: true, verification: 'provider' })
  h.runPipeline.mockResolvedValue({ success: true, normalized: { source: { source_league_id: '1' }, rosters: [] } })
  h.persist.mockResolvedValue(persisted())
  h.linkHalves.mockResolvedValue({ ok: true })
})

describe('the other half picked on the confirm screen', () => {
  it('links the new league to it once built, and names it in the answer', async () => {
    const res = await commit({ provider: 'sleeper', sourceId: '1', pairWithLeagueId: 'cream' })
    expect(res.status).toBe(200)
    expect(h.linkHalves).toHaveBeenCalledWith({ leagueId: 'peach', otherLeagueId: 'cream', userId: 'af-user-1' })
    expect((await res.json()).pairLink).toEqual({ ok: true, otherLeagueId: 'cream', otherName: 'Cream Bowl' })
  })

  it('a refused link is reported, and the import still succeeds', async () => {
    h.linkHalves.mockResolvedValue({ ok: false, error: 'Both leagues must be yours.' })
    const res = await commit({ provider: 'sleeper', sourceId: '1', pairWithLeagueId: 'someone-elses' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.leagueId).toBe('peach')
    expect(data.pairLink).toEqual({ ok: false, error: 'Both leagues must be yours.' })
  })

  it('a throw while linking is reported, not a failed import', async () => {
    h.linkHalves.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await commit({ provider: 'sleeper', sourceId: '1', pairWithLeagueId: 'cream' })
    expect(res.status).toBe(200)
    expect((await res.json()).pairLink).toEqual({ ok: false, error: 'Could not link the other half.' })
    warn.mockRestore()
  })

  it("never links from another account's league (a join)", async () => {
    h.persist.mockResolvedValue(persisted({ joinedExisting: true }))
    const res = await commit({ provider: 'sleeper', sourceId: '1', pairWithLeagueId: 'cream' })
    expect(h.linkHalves).not.toHaveBeenCalled()
    expect((await res.json()).pairLink).toBeNull()
  })

  it('absent, nothing is linked', async () => {
    const res = await commit({ provider: 'sleeper', sourceId: '1' })
    expect(h.linkHalves).not.toHaveBeenCalled()
    expect((await res.json()).pairLink).toBeNull()
  })
})
