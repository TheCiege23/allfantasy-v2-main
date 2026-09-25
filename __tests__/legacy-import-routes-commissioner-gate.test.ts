import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 The two legacy per-provider import routes used to persist a league after only
 * `requireVerifiedUser()`. Any verified account could import any readable ESPN league (a
 * public one needs no cookies) or any MFL league id and become its AllFantasy owner —
 * `League.userId`, which is what the commissioner checks read. The unified commit route has
 * run `assertImportCommissioner` for months; these two doors did not.
 *
 * Real route handlers, with the gate, pipeline and persistence replaced — the question here is
 * only "does a refusal stop the write, and does a pass hand the importer's manager id through".
 */

const {
  requireVerifiedUserMock,
  assertImportCommissionerMock,
  recordImportAttestationMock,
  pipelineMock,
  persistMock,
  leagueAuthUpsertMock,
} = vi.hoisted(() => ({
  requireVerifiedUserMock: vi.fn(),
  assertImportCommissionerMock: vi.fn(),
  recordImportAttestationMock: vi.fn(),
  pipelineMock: vi.fn(),
  persistMock: vi.fn(),
  leagueAuthUpsertMock: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))

vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: assertImportCommissionerMock,
  recordImportAttestation: recordImportAttestationMock,
}))

vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: pipelineMock,
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  persistImportedLeagueFromNormalization: persistMock,
  ImportedLeagueConflictError: class extends Error {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueAuth: { upsert: leagueAuthUpsertMock }, mFLConnection: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/league-auth-crypto', () => ({ encrypt: (v: string) => `enc(${v})` }))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))

function post(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const NORMALIZED = { source: { source_league_id: 'L1' }, league: { season: 2026 } }

beforeEach(() => {
  vi.clearAllMocks()
  requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
  pipelineMock.mockResolvedValue({ success: true, normalized: NORMALIZED })
  persistMock.mockResolvedValue({
    league: { id: 'af-league-1', name: 'Imported', sport: 'NFL' },
    historicalBackfill: null,
    existed: false,
  })
  leagueAuthUpsertMock.mockResolvedValue({})
  recordImportAttestationMock.mockResolvedValue(undefined)
})

describe('POST /api/import-espn — commissioner gate', () => {
  it('refuses a caller the gate refuses, and writes nothing', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      leagueReadable: true,
      reason: 'We could read this league, but not prove you have a team in it.',
    })
    const { POST } = await import('@/app/api/import-espn/route')
    const res = await POST(post('http://localhost/api/import-espn', { leagueId: '12345', season: 2026 }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_COMMISSIONER', requiresAttestation: false })
    expect(pipelineMock).not.toHaveBeenCalled()
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('gates the SAME sourceId the pipeline would receive, as a full-league commit', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: false, reason: 'no' })
    const { POST } = await import('@/app/api/import-espn/route')
    await POST(post('http://localhost/api/import-espn', { leagueId: ' 12345 ', season: 2025 }))

    expect(assertImportCommissionerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appUserId: 'u1',
        provider: 'espn',
        sourceLeagueId: '2025:12345',
        requireCommissioner: true,
      }),
    )
  })

  it('stores the cookies BEFORE the gate runs — the gate needs them to prove membership', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: false, reason: 'no' })
    const { POST } = await import('@/app/api/import-espn/route')
    await POST(
      post('http://localhost/api/import-espn', { leagueId: '12345', season: 2026, espnS2: 's2', swid: '{SWID}' }),
    )

    expect(leagueAuthUpsertMock).toHaveBeenCalledTimes(1)
    expect(leagueAuthUpsertMock.mock.invocationCallOrder[0]).toBeLessThan(
      assertImportCommissionerMock.mock.invocationCallOrder[0],
    )
  })

  it('maps not-found to 404 and a provider outage to 503, not a flat 403', async () => {
    const { POST } = await import('@/app/api/import-espn/route')

    assertImportCommissionerMock.mockResolvedValueOnce({ ok: false, notFound: true, reason: 'gone' })
    const gone = await POST(post('http://localhost/api/import-espn', { leagueId: '1', season: 2026 }))
    expect(gone.status).toBe(404)
    await expect(gone.json()).resolves.toMatchObject({ code: 'LEAGUE_NOT_FOUND' })

    assertImportCommissionerMock.mockResolvedValueOnce({ ok: false, status: 502, reason: 'down' })
    const down = await POST(post('http://localhost/api/import-espn', { leagueId: '1', season: 2026 }))
    expect(down.status).toBe(503)
    await expect(down.json()).resolves.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('points an attestation refusal at /import, because this form has no checkbox to collect it', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      requiresAttestation: true,
      reason: 'ESPN cannot verify commissioner status automatically.',
    })
    const { POST } = await import('@/app/api/import-espn/route')
    const res = await POST(post('http://localhost/api/import-espn', { leagueId: '1', season: 2026 }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'ATTESTATION_REQUIRED', requiresAttestation: true })
    expect(body.error).toContain('/import')
  })

  it('on a pass, hands the importer’s own manager id to persistence so their team is claimed', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'member', sourceManagerId: '{MGR-1}' })
    const { POST } = await import('@/app/api/import-espn/route')
    const res = await POST(post('http://localhost/api/import-espn', { leagueId: '12345', season: 2026 }))

    expect(res.status).toBe(200)
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', provider: 'espn', importerSourceManagerId: '{MGR-1}' }),
    )
    expect(recordImportAttestationMock).not.toHaveBeenCalled()
  })

  it('forwards an accepted attestation to the gate and records it on the new league', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation', sourceManagerId: 'm2' })
    const { POST } = await import('@/app/api/import-espn/route')
    await POST(
      post('http://localhost/api/import-espn', {
        leagueId: '12345',
        season: 2026,
        attestation: { accepted: true, statement: 'I run it' },
      }),
    )

    expect(assertImportCommissionerMock).toHaveBeenCalledWith(
      expect.objectContaining({ attestation: { accepted: true, statement: 'I run it' } }),
    )
    expect(recordImportAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'af-league-1', appUserId: 'u1', provider: 'espn', sourceLeagueId: '2026:12345' }),
    )
  })
})

describe('POST /api/mfl/import — commissioner gate', () => {
  it('refuses a caller the gate refuses, and writes nothing', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      reason: 'You are not a member of that MFL league according to your linked API key.',
    })
    const { POST } = await import('@/app/api/mfl/import/route')
    const res = await (POST as any)(post('http://localhost/api/mfl/import', { leagueId: '55555', season: 2026 }))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_COMMISSIONER' })
    expect(assertImportCommissionerMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mfl', sourceLeagueId: '2026:55555', requireCommissioner: true }),
    )
    expect(pipelineMock).not.toHaveBeenCalled()
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('on a pass, hands the importer’s franchise id to persistence', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation', sourceManagerId: '0004' })
    const { POST } = await import('@/app/api/mfl/import/route')
    const res = await (POST as any)(
      post('http://localhost/api/mfl/import', {
        sourceId: '2026:55555',
        attestation: { accepted: true, statement: 'commish' },
      }),
    )

    expect(res.status).toBe(200)
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mfl', importerSourceManagerId: '0004' }),
    )
    expect(recordImportAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'mfl', sourceLeagueId: '2026:55555' }),
    )
  })

  it('does not gate the no-league-id request, which never writes (501 historical path)', async () => {
    const { POST } = await import('@/app/api/mfl/import/route')
    const res = await (POST as any)(post('http://localhost/api/mfl/import', { startYear: 2020, endYear: 2025 }))

    expect(res.status).toBe(401)
    expect(assertImportCommissionerMock).not.toHaveBeenCalled()
    expect(persistMock).not.toHaveBeenCalled()
  })
})
