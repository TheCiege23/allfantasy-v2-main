// @vitest-environment node
/**
 * POST /api/leagues/import/commit — a PUBLIC ESPN league imported with no cookies by someone who says
 * they are not its commissioner. Every case below is a way this could widen into "anyone imports
 * anything": it must need the answer AND a picked team AND a league the gate actually read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  assertImportCommissioner: vi.fn(),
  pipeline: vi.fn(),
  memberImport: vi.fn(),
  persist: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/commissionerGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/commissionerGate')>()),
  assertImportCommissioner: h.assertImportCommissioner,
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
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({
  buildCanonicalImportBundle: () => ({}),
}))
vi.mock('@/lib/league-import/provider-ui-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/provider-ui-config')>()),
  isImportProviderAvailable: () => true,
}))

const NORMALIZED = { source: { source_league_id: '777' }, league: { season: 2026 }, rosters: [] }
const UNPROVEN = { ok: false, leagueReadable: true, reason: 'We could read this league, but not prove you have a team in it.' }

function commit(body: Record<string, unknown>) {
  return new Request('http://localhost/api/leagues/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'espn', sourceId: '777', ...body }),
  })
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/leagues/import/commit/route')
  return POST(commit(body) as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'alice' })
  h.assertImportCommissioner.mockResolvedValue(UNPROVEN)
  h.pipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.memberImport.mockResolvedValue({
    ok: true,
    league: { id: 'L1', name: 'Pub League', sport: 'NFL' },
    joinedExisting: false,
    existed: false,
  })
})

describe('ESPN public league, no cookies', () => {
  it.each(['espn', 'member'])('imports as a member when the answer is %s and a team is picked', async (runBy) => {
    const res = await post({ espnLeagueRunBy: runBy, claimSourceTeamId: '2' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ leagueId: 'L1', claimUnconfirmed: true, joinedExisting: false })
    expect(h.memberImport).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'alice', claimSourceTeamId: '2', normalized: NORMALIZED }),
    )
  })

  it('persists the new league as the owner the member import asks for, never the caller', async () => {
    h.persist.mockResolvedValue({ persisted: { league: { id: 'L1' } }, runId: 'r', skipped: false })
    await post({ espnLeagueRunBy: 'espn', claimSourceTeamId: '2' })
    const { persistAsOwner } = h.memberImport.mock.calls[0][0]
    await persistAsOwner('SYSTEM')
    expect(h.persist).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'SYSTEM', importerSourceManagerId: null, importerSourceTeamId: null }),
    )
  })

  it('"I\'m the commissioner" still needs proof: the gate refusal stands', async () => {
    const res = await post({ espnLeagueRunBy: 'me', claimSourceTeamId: '2' })
    expect(res.status).not.toBe(200)
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it('no answer: the gate refusal stands', async () => {
    const res = await post({ claimSourceTeamId: '2' })
    expect(res.status).not.toBe(200)
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it('an answer without a picked team is refused before anything is read', async () => {
    const res = await post({ espnLeagueRunBy: 'member' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PICK_TEAM_REQUIRED')
    expect(h.pipeline).not.toHaveBeenCalled()
  })

  it('a league the gate could NOT read (private, missing) is never imported this way', async () => {
    h.assertImportCommissioner.mockResolvedValue({ ok: false, reason: 'private' })
    const res = await post({ espnLeagueRunBy: 'member', claimSourceTeamId: '2' })
    expect(res.status).not.toBe(200)
    expect(h.memberImport).not.toHaveBeenCalled()
  })

  it('the answer means nothing for another provider', async () => {
    const res = await post({ provider: 'fleaflicker', espnLeagueRunBy: 'member', claimSourceTeamId: '2' })
    expect(h.memberImport).not.toHaveBeenCalled()
    expect(res.status).not.toBe(200)
  })

  it("passes the member import's refusal through with its code", async () => {
    h.memberImport.mockResolvedValue({ ok: false, status: 409, code: 'TEAM_ALREADY_CLAIMED', error: 'taken' })
    const res = await post({ espnLeagueRunBy: 'espn', claimSourceTeamId: '2' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'taken', code: 'TEAM_ALREADY_CLAIMED' })
  })
})
