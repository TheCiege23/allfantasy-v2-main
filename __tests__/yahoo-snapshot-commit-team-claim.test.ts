import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A PASTED Yahoo league (`yahoo-snapshot:<id>`) imported with all ten teams unclaimed and no team
 * carrying the commissioner's C (production, 2026-11-25): nothing on a pasted page says which team is
 * the importer's, and the commit route accepted a picked team only for the open-read providers. The
 * pasted league now takes one, under the same rules — validated against the league's own rosters, only
 * ever as `importerSourceTeamId`, never as the provider-proven `importerSourceManagerId`.
 */

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  assertImportCommissioner: vi.fn(),
  runPipeline: vi.fn(),
  persist: vi.fn(),
  applyAttestedCommissioner: vi.fn(async () => ({ teamsUpdated: 1 })),
  snapshotOpen: vi.fn(() => true),
}))

vi.mock('@/lib/yahoo/yahooAvailability', () => ({ isYahooSnapshotImportOpenFor: h.snapshotOpen }))
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

const SOURCE = 'yahoo-snapshot:424242'
const ATTEST = { accepted: true, statement: 'I am the commissioner of this Yahoo league.' }
const NORMALIZED = {
  source: { source_league_id: 'nfl.l.424242' },
  rosters: [
    { source_team_id: 'nfl.l.424242.t.1', source_manager_id: 'nfl.l.424242.t.1' },
    { source_team_id: 'nfl.l.424242.t.2', source_manager_id: 'nfl.l.424242.t.2' },
  ],
}
const PERSISTED = {
  persisted: {
    league: { id: 'lg-y', name: 'Moonbase Fantasy', sport: 'NFL' },
    historicalBackfill: null,
    existed: false,
    joinedExisting: false,
    incompleteSteps: [],
  },
  skipped: false,
  runId: 'run-y',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.snapshotOpen.mockReturnValue(true)
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'af-user-1' })
  h.assertImportCommissioner.mockResolvedValue({ ok: true, verification: 'attestation' })
  h.runPipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.persist.mockResolvedValue(PERSISTED)
})

describe('🛑 a pasted Yahoo league takes the importer’s team', () => {
  it('the picked team reaches the persist as importerSourceTeamId, and the commissioner C is applied', async () => {
    const res = await commit({ provider: 'yahoo', sourceId: SOURCE, attestation: ATTEST, claimSourceTeamId: 'nfl.l.424242.t.2' })

    expect(res.status).toBe(200)
    const input = h.persist.mock.calls[0]![0]
    expect(input.importerSourceTeamId).toBe('nfl.l.424242.t.2')
    expect(input.importerSourceManagerId).toBeNull()
    // `applyAttestedCommissioner` marks the league AND the importer's claimed team.
    expect(h.applyAttestedCommissioner).toHaveBeenCalledWith({ leagueId: 'lg-y', appUserId: 'af-user-1' })
  })

  it('a team that is not in the pasted league is refused before anything is written', async () => {
    const res = await commit({ provider: 'yahoo', sourceId: SOURCE, attestation: ATTEST, claimSourceTeamId: 'nfl.l.999.t.1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'CLAIM_TEAM_NOT_IN_LEAGUE' })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('NOT for a Yahoo API league id — only the pasted path has no identity of its own', async () => {
    const res = await commit({ provider: 'yahoo', sourceId: 'nfl.l.424242', attestation: ATTEST, claimSourceTeamId: 'nfl.l.424242.t.2' })
    // The Yahoo API path is still coming-soon here; either way nothing is persisted with a picked team.
    expect(res.status).toBe(400)
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('NOT for an account the snapshot rollout does not include', async () => {
    h.snapshotOpen.mockReturnValue(false)
    const res = await commit({ provider: 'yahoo', sourceId: SOURCE, attestation: ATTEST, claimSourceTeamId: 'nfl.l.424242.t.2' })
    expect(res.status).toBe(400)
    expect(h.persist).not.toHaveBeenCalled()
  })
})
