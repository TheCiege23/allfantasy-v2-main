import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/leagues/import/commit — two behaviours the /import click-through found missing.
 *
 * 1. AN UNEXPECTED THROW WAS AN EMPTY-BODY 500. The import screen then showed the browser's own
 *    "Failed to execute 'json' on 'Response': Unexpected end of JSON input" as the explanation.
 *    Every branch must answer JSON, including the one nobody anticipated.
 *
 * 2. FLEAFLICKER NEVER SAYS WHICH TEAM IS THE IMPORTER'S, so a Fleaflicker league imported with
 *    every team unclaimed and was invisible on Portfolio. The importer now picks their team, and
 *    it reaches the persist as `importerSourceTeamId` — validated against the league's rosters,
 *    accepted only where the gate proved no identity, and NEVER as `importerSourceManagerId`
 *    (which is provider-proven and can attach the caller to another account's league).
 */

const h = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  assertImportCommissioner: vi.fn(),
  runPipeline: vi.fn(),
  persist: vi.fn(),
}))

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: h.requireVerifiedUser }))
vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: h.assertImportCommissioner,
  recordImportAttestation: vi.fn(async () => {}),
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
}))

import { POST } from '@/app/api/leagues/import/commit/route'
import { ImportedLeagueConflictError } from '@/lib/league-import/ImportedLeagueCommitService'

const IMPORT_FAILED = 'Import failed on our side — nothing was changed. Try again in a minute.'

function commit(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/leagues/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )
}

const NORMALIZED = {
  source: { source_league_id: '349505' },
  rosters: [
    { source_team_id: '1001', source_manager_id: '55' },
    { source_team_id: '1002', source_manager_id: '1002' },
  ],
}

const PERSISTED = {
  persisted: {
    league: { id: 'lg-1', name: 'Flea League', sport: 'NFL' },
    historicalBackfill: null,
    existed: false,
    joinedExisting: false,
    incompleteSteps: [],
  },
  skipped: false,
  runId: 'run-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireVerifiedUser.mockResolvedValue({ ok: true, userId: 'af-user-1' })
  h.assertImportCommissioner.mockResolvedValue({ ok: true, verification: 'attestation' })
  h.runPipeline.mockResolvedValue({ success: true, normalized: NORMALIZED })
  h.persist.mockResolvedValue(PERSISTED)
})

describe('🛑 an unexpected failure still answers JSON', () => {
  it('a throw inside the persist is a JSON 500 with a human sentence and a code', async () => {
    h.persist.mockRejectedValue(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await commit({ provider: 'fleaflicker', sourceId: '349505' })

    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text.length).toBeGreaterThan(0)
    expect(JSON.parse(text)).toEqual({ error: IMPORT_FAILED, code: 'IMPORT_FAILED' })
    errSpy.mockRestore()
  })

  it('a throw BEFORE the persist (the gate) is caught too', async () => {
    h.assertImportCommissioner.mockRejectedValue(new TypeError('Cannot read properties of undefined'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await commit({ provider: 'fleaflicker', sourceId: '349505' })

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'IMPORT_FAILED' })
    errSpy.mockRestore()
  })

  it('logs the failure without the request URL or a credential in it', async () => {
    // A reserved example host, not a real vendor URL: a monitored provider host in a literal trips
    // the required DB-First boundary check. The shape that matters — a token in the query string — is kept.
    h.persist.mockRejectedValue(
      new Error('fetch failed https://provider.example.test/api/v1/live?token=SECRET123 (500)'),
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await commit({ provider: 'fleaflicker', sourceId: '349505' })

    const logged = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('fetch failed')
    expect(logged).not.toContain('SECRET123')
    expect(logged).not.toContain('provider.example.test')
    errSpy.mockRestore()
  })

  it('the specific errors keep their own answers (409 for an existing league)', async () => {
    h.persist.mockRejectedValue(new ImportedLeagueConflictError('This league already exists in your account'))

    const res = await commit({ provider: 'fleaflicker', sourceId: '349505' })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'LEAGUE_ALREADY_IMPORTED' })
  })
})

describe('🛑 the importer’s chosen team (claimSourceTeamId)', () => {
  it('reaches the persist as importerSourceTeamId — never as importerSourceManagerId', async () => {
    const res = await commit({ provider: 'fleaflicker', sourceId: '349505', claimSourceTeamId: '1002' })

    expect(res.status).toBe(200)
    expect(h.persist).toHaveBeenCalledTimes(1)
    const input = h.persist.mock.calls[0]![0]
    expect(input.importerSourceTeamId).toBe('1002')
    expect(input.importerSourceManagerId).toBeNull()
  })

  it('a team that is not in this league is refused before anything is written', async () => {
    const res = await commit({ provider: 'fleaflicker', sourceId: '349505', claimSourceTeamId: '9999' })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'CLAIM_TEAM_NOT_IN_LEAGUE' })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('is refused for a provider that proves identity itself (Sleeper)', async () => {
    h.assertImportCommissioner.mockResolvedValue({ ok: true, verification: 'api', sourceManagerId: 'slp-1' })

    const res = await commit({ provider: 'sleeper', sourceId: '123', claimSourceTeamId: '1001' })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'CLAIM_TEAM_NOT_ACCEPTED' })
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('is refused for an open-read provider once the gate DID prove the team (Fantrax + Secret ID)', async () => {
    h.assertImportCommissioner.mockResolvedValue({ ok: true, verification: 'member', sourceManagerId: 'Team A' })

    const res = await commit({ provider: 'fantrax', sourceId: 'fantrax-league:abc|Team A', claimSourceTeamId: '1001' })

    expect(res.status).toBe(400)
    expect(h.persist).not.toHaveBeenCalled()
  })

  it('absent, nothing changes: no team id is passed', async () => {
    await commit({ provider: 'fleaflicker', sourceId: '349505' })
    expect(h.persist.mock.calls[0]![0].importerSourceTeamId).toBeNull()
  })

  it('the attestation requirement is untouched — a gate refusal still wins over a chosen team', async () => {
    h.assertImportCommissioner.mockResolvedValue({
      ok: false,
      requiresAttestation: true,
      reason: 'Fleaflicker cannot verify commissioner status automatically',
    })

    const res = await commit({ provider: 'fleaflicker', sourceId: '349505', claimSourceTeamId: '1002' })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'ATTESTATION_REQUIRED' })
    expect(h.persist).not.toHaveBeenCalled()
  })
})
