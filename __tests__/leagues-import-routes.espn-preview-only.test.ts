import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Owner decision "A1", 2026-09-12: a public ESPN league can be PREVIEWED without a connected ESPN
 * account, and still cannot be IMPORTED. The gate refuses (`ok: false`) and marks the league
 * `leagueReadable`; only the unified preview route reads that, and only when the client opts in.
 *
 * Every refusal case below exists because it is the way this could widen into an import bypass or a
 * silent behaviour change for a surface that treats any 200 as ready-to-import.
 */

const requireVerifiedUserMock = vi.fn()
const assertImportCommissionerMock = vi.fn()
const orchestrateImportPreviewMock = vi.fn()
const getSleeperImportPreviewMock = vi.fn()

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: assertImportCommissionerMock,
}))

vi.mock('@/lib/league-import/importOrchestrator', () => ({
  orchestrateImportPreview: orchestrateImportPreviewMock,
}))

vi.mock('@/lib/league-import/sleeper/SleeperImportPreviewService', () => ({
  getSleeperImportPreview: getSleeperImportPreviewMock,
}))

const UNPROVEN_REASON =
  'We could read this league, but not prove you have a team in it — that needs your ESPN account connected.'

function previewRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/leagues/import/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/leagues/import/preview — ESPN preview-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
    orchestrateImportPreviewMock.mockResolvedValue({
      ok: true,
      preview: { league: { id: '12345', name: 'Public ESPN League' } },
      canonicalPreview: { leagueName: 'Public ESPN League' },
    })
  })

  it('returns the preview with importable:false and the gate reason for a readable-but-unproven ESPN league when the client opts in', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      leagueReadable: true,
      reason: UNPROVEN_REASON,
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      previewRequest({ provider: 'espn', sourceId: '12345', allowPreviewOnly: true }) as any,
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      league: { id: '12345', name: 'Public ESPN League' },
      canonical: { leagueName: 'Public ESPN League' },
      importable: false,
      importBlockedReason: UNPROVEN_REASON,
    })
    expect(orchestrateImportPreviewMock).toHaveBeenCalledWith({
      provider: 'espn',
      sourceId: '12345',
      userId: 'u1',
    })
  })

  it('keeps the 403 for the same league when the client does not opt in', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      leagueReadable: true,
      reason: UNPROVEN_REASON,
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(previewRequest({ provider: 'espn', sourceId: '12345' }) as any)

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      error: UNPROVEN_REASON,
      code: 'NOT_COMMISSIONER',
      requiresAttestation: false,
    })
    expect(orchestrateImportPreviewMock).not.toHaveBeenCalled()
  })

  it('treats only a literal true opt-in as opting in', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      leagueReadable: true,
      reason: UNPROVEN_REASON,
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      previewRequest({ provider: 'espn', sourceId: '12345', allowPreviewOnly: 'true' }) as any,
    )

    expect(res.status).toBe(403)
    expect(orchestrateImportPreviewMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 for an ESPN league the gate could not read, even with the opt-in', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      reason: 'ESPN returned 401 for this league.',
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      previewRequest({ provider: 'espn', sourceId: '12345', allowPreviewOnly: true }) as any,
    )

    expect(res.status).toBe(403)
    expect(orchestrateImportPreviewMock).not.toHaveBeenCalled()
  })

  it('keeps the 403 for any other provider, even if its gate result carried the flag', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      leagueReadable: true,
      reason: 'Not a member.',
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      previewRequest({ provider: 'fantrax', sourceId: 'abc123', allowPreviewOnly: true }) as any,
    )

    expect(res.status).toBe(403)
    expect(orchestrateImportPreviewMock).not.toHaveBeenCalled()
  })

  it('adds no importable field to an ordinary ESPN preview the gate allowed', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: true,
      sourceManagerId: 'espn-member-3',
      verification: 'api',
    })

    const { POST } = await import('@/app/api/leagues/import/preview/route')
    const res = await POST(
      previewRequest({ provider: 'espn', sourceId: '12345', allowPreviewOnly: true }) as any,
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).not.toHaveProperty('importable')
    expect(json).not.toHaveProperty('importBlockedReason')
  })
})

/*
 * The whole safety argument is "nothing that writes reads `leagueReadable`". A source check is the
 * cheapest way to keep that true: a commit route that starts consulting the flag fails here, before
 * anyone has to notice an import going through without membership.
 */
describe('leagueReadable is read by the unified preview route only', () => {
  const repo = path.resolve(__dirname, '..')
  const mustNotRead = [
    'app/api/leagues/import/commit/route.ts',
    'app/api/leagues/[leagueId]/import/commit/route.ts',
    'app/api/leagues/[leagueId]/import/preview/route.ts',
    'app/api/league/create/route.ts',
  ]

  for (const rel of mustNotRead) {
    it(`${rel} does not reference leagueReadable`, () => {
      const src = readFileSync(path.join(repo, rel), 'utf8')
      // Positive control: the file is a real gate caller, so an empty or wrong read cannot pass.
      expect(src).toContain('assertImportCommissioner')
      expect(src).not.toContain('leagueReadable')
    })
  }

  it('the unified preview route does reference it', () => {
    const src = readFileSync(path.join(repo, 'app/api/leagues/import/preview/route.ts'), 'utf8')
    expect(src).toContain('gate.leagueReadable === true')
  })
})
