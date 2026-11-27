// @vitest-environment node
/**
 * POST /api/leagues/import/commit — a PASTED Yahoo league imported by someone who is a MEMBER, not its
 * commissioner (owner report 2026-11-26: a public league Yahoo created could only be imported by
 * ticking "I'm the commissioner"). It takes ESPN's public-member path: system-owned league, team
 * claimed UNCONFIRMED, no attestation recorded, no commissioner C.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  assertImportCommissioner: vi.fn(),
  pipeline: vi.fn(),
  memberImport: vi.fn(),
  persist: vi.fn(),
  recordImportAttestation: vi.fn(async () => {}),
  applyAttestedCommissioner: vi.fn(async () => ({ teamsUpdated: 1 })),
  snapshotOpen: vi.fn(() => true),
}))

vi.mock('@/lib/yahoo/yahooAvailability', () => ({ isYahooSnapshotImportOpenFor: h.snapshotOpen }))
vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser, requireAgeConfirmedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/commissionerGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/commissionerGate')>()),
  assertImportCommissioner: h.assertImportCommissioner,
  recordImportAttestation: h.recordImportAttestation,
  applyAttestedCommissioner: h.applyAttestedCommissioner,
}))
vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: h.pipeline,
}))
vi.mock('@/lib/league-import/espn/espnPublicMemberImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/espn/espnPublicMemberImport')>()),
  importPublicEspnLeagueAsMember: h.memberImport,
}))
vi.mock('@/lib/league-import/importPersistenceService', () => ({
  ImportRunInFlightError: class extends Error {},
  persistImportWithCanonicalAudit: h.persist,
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({ buildCanonicalImportBundle: () => ({}) }))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  ImportedLeagueConflictError: class ImportedLeagueConflictError extends Error {},
  ImportedLeagueConvertedError: class ImportedLeagueConvertedError extends Error {},
  ImportedLeagueTombstonedError: class ImportedLeagueTombstonedError extends Error {},
  ImportedLeagueAlreadyHereError: class ImportedLeagueAlreadyHereError extends Error {},
}))

const SOURCE = 'yahoo-snapshot:424242'
const ATTEST = { accepted: true, statement: 'I am the commissioner of this Yahoo league.' }
const NORMALIZED = {
  source: { source_league_id: 'nfl.l.424242' },
  league: { season: 2026 },
  rosters: [
    { source_team_id: 'nfl.l.424242.t.1', source_manager_id: 'nfl.l.424242.t.1' },
    { source_team_id: 'nfl.l.424242.t.2', source_manager_id: 'nfl.l.424242.t.2' },
  ],
}
/** What the real gate answers for a pasted league with no attestation. */
const NEEDS_ATTESTATION = { ok: false, verification: 'api', requiresAttestation: true, reason: 'confirm you are the commissioner' }
const PERSISTED = {
  persisted: { league: { id: 'lg-y', name: 'Moonbase', sport: 'NFL' }, historicalBackfill: null, existed: false, joinedExisting: false, incompleteSteps: [] },
  skipped: false,
  runId: 'run-y',
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/leagues/import/commit/route')
  return POST(
    new Request('http://localhost/api/leagues/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'yahoo', sourceId: SOURCE, ...body }),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.snapshotOpen.mockReturnValue(true)
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'alice' })
  h.assertImportCommissioner.mockImplementation(async (args: { attestation?: { accepted?: boolean } }) =>
    args.attestation?.accepted ? { ok: true, verification: 'attestation' } : NEEDS_ATTESTATION,
  )
  h.pipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.persist.mockResolvedValue(PERSISTED)
  h.memberImport.mockResolvedValue({ ok: true, league: { id: 'lg-sys', name: 'Moonbase', sport: 'NFL' }, joinedExisting: false, existed: false })
})

describe('pasted Yahoo league, member', () => {
  it('imports as a member: the picked team is claimed through the public-member path, unconfirmed', async () => {
    const res = await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ leagueId: 'lg-sys', claimUnconfirmed: true })
    expect(h.memberImport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'alice', platform: 'yahoo', claimSourceTeamId: 'nfl.l.424242.t.2', normalized: NORMALIZED }),
    )
    expect(h.memberImport.mock.calls[0][0].refreshExisting).toBeUndefined()
    // No commissioner anything.
    expect(h.recordImportAttestation).not.toHaveBeenCalled()
    expect(h.applyAttestedCommissioner).not.toHaveBeenCalled()
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('🛑 an attestation sent alongside a member choice never reaches the gate', async () => {
    const res = await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2', attestation: ATTEST })
    expect(res.status).toBe(200)
    expect(h.assertImportCommissioner.mock.calls[0][0].attestation).toBeUndefined()
    expect(h.memberImport).toHaveBeenCalled()
    expect(h.recordImportAttestation).not.toHaveBeenCalled()
    expect(h.applyAttestedCommissioner).not.toHaveBeenCalled()
  })

  it('persists a new league as the owner the member import asks for (the system account), as yahoo', async () => {
    await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2' })
    const { persistAsOwner } = h.memberImport.mock.calls[0][0]
    await persistAsOwner('SYSTEM')
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'SYSTEM',
        provider: 'yahoo',
        allowUpdateExisting: false,
        importerSourceManagerId: null,
        importerSourceTeamId: null,
      }),
    )
  })

  it('a member without a team is refused with a 400 before anything is read', async () => {
    const res = await post({ yahooLeagueRunBy: 'member' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PICK_TEAM_REQUIRED')
    expect(h.pipeline).not.toHaveBeenCalled()
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it('"Update my existing league" asks the member import to refresh', async () => {
    await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2', force: true })
    expect(h.memberImport.mock.calls[0][0].refreshExisting).toBe(true)
  })

  it('someone else’s paste (gate not-found) is never imported this way', async () => {
    h.assertImportCommissioner.mockResolvedValue({ ok: false, notFound: true, reason: 'not found' })
    const res = await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2' })
    expect(res.status).toBe(404)
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it('NOT for an account outside the snapshot rollout', async () => {
    h.snapshotOpen.mockReturnValue(false)
    const res = await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2' })
    expect(res.status).toBe(400)
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it("passes the member import's refusal through with its code", async () => {
    h.memberImport.mockResolvedValue({ ok: false, status: 409, code: 'TEAM_ALREADY_CLAIMED', error: 'taken' })
    const res = await post({ yahooLeagueRunBy: 'member', claimSourceTeamId: 'nfl.l.424242.t.2' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'taken', code: 'TEAM_ALREADY_CLAIMED' })
  })
})

describe('pasted Yahoo league, commissioner — unchanged', () => {
  it('attests, persists as the caller with the team, and applies the C', async () => {
    const res = await post({ yahooLeagueRunBy: 'me', attestation: ATTEST, claimSourceTeamId: 'nfl.l.424242.t.1' })
    expect(res.status).toBe(200)
    expect(h.memberImport).not.toHaveBeenCalled()
    expect(h.assertImportCommissioner.mock.calls[0][0].attestation).toMatchObject({ accepted: true })
    expect(h.persist.mock.calls[0][0]).toMatchObject({ userId: 'alice', importerSourceTeamId: 'nfl.l.424242.t.1' })
    expect(h.applyAttestedCommissioner).toHaveBeenCalledWith({ leagueId: 'lg-y', appUserId: 'alice' })
  })

  it('without an attestation the gate refusal stands (no silent member fallback)', async () => {
    const res = await post({ yahooLeagueRunBy: 'me', claimSourceTeamId: 'nfl.l.424242.t.1' })
    expect(res.status).not.toBe(200)
    expect(h.memberImport).not.toHaveBeenCalled()
    expect(h.persist).not.toHaveBeenCalled()
  })
})
