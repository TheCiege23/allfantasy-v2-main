import { describe, expect, it } from 'vitest'
import {
  buildIntelligenceEvidence,
  getExternalPlatformAction,
  importDisplayStateToStatus,
  mapLegacyAuthError,
  resolveLegacyImportDisplayState,
  LEGACY_IMPORT_STALE_AFTER_MS,
} from '@/lib/legacy/dataStatus'

describe('resolveLegacyImportDisplayState', () => {
  it('returns partial when some seasons imported', () => {
    expect(
      resolveLegacyImportDisplayState({ importedSeasonCount: 2, expectedSeasonCount: 5, status: 'completed' }),
    ).toBe('partial')
  })

  it('returns failed when an import error exists, even mid-run', () => {
    expect(
      resolveLegacyImportDisplayState({ status: 'running', errorMessage: 'Provider timeout' }),
    ).toBe('failed')
  })

  it('returns queued and running for in-flight jobs', () => {
    expect(resolveLegacyImportDisplayState({ status: 'queued' })).toBe('queued')
    expect(resolveLegacyImportDisplayState({ status: 'running' })).toBe('running')
  })

  it('returns complete for a fresh finished import with full coverage', () => {
    expect(
      resolveLegacyImportDisplayState({
        status: 'completed',
        completedAt: new Date(),
        lastSyncedAt: new Date(),
        importedSeasonCount: 5,
        expectedSeasonCount: 5,
      }),
    ).toBe('complete')
  })

  it('returns stale for a finished import older than the staleness threshold', () => {
    const old = new Date(Date.now() - LEGACY_IMPORT_STALE_AFTER_MS - 60_000)
    expect(
      resolveLegacyImportDisplayState({ status: 'completed', completedAt: old, lastSyncedAt: old }),
    ).toBe('stale')
  })

  it('returns not_started when there is no job at all', () => {
    expect(resolveLegacyImportDisplayState({})).toBe('not_started')
  })
})

describe('importDisplayStateToStatus', () => {
  it('partial names the season counts and is retryable', () => {
    const status = importDisplayStateToStatus('partial', {
      importedSeasonCount: 2,
      expectedSeasonCount: 5,
    })
    expect(status.state).toBe('partial')
    expect(status.message).toContain('2 of 5 seasons')
    expect(status.retryable).toBe(true)
  })

  it('failed never leaks the raw provider error into user copy', () => {
    const status = importDisplayStateToStatus('failed', {
      errorMessage: 'ECONNREFUSED 10.0.0.7:5432 at PrismaClient…',
    })
    expect(status.message).not.toContain('ECONNREFUSED')
    expect(status.message).not.toContain('Prisma')
    expect(status.retryable).toBe(true)
  })
})

describe('mapLegacyAuthError', () => {
  it('maps 401 to auth_required', () => {
    const status = mapLegacyAuthError(401)
    expect(status.state).toBe('auth_required')
    expect(status.retryable).toBe(false)
  })

  it('maps 409 HANDLE_CLAIMED to link_required with the sign-in message', () => {
    const status = mapLegacyAuthError(409, 'HANDLE_CLAIMED')
    expect(status.state).toBe('link_required')
    expect(status.reasonCode).toBe('HANDLE_CLAIMED')
    expect(status.message).toMatch(/already linked/i)
  })

  it('maps plain 409 to link_required (SLEEPER_NOT_LINKED)', () => {
    expect(mapLegacyAuthError(409).state).toBe('link_required')
  })

  it('maps 403 identity mismatch to link_required', () => {
    const status = mapLegacyAuthError(403, 'SLEEPER_USERNAME_MISMATCH')
    expect(status.state).toBe('link_required')
    expect(status.reasonCode).toBe('SLEEPER_USERNAME_MISMATCH')
  })

  it('maps unknown failures to a retryable failed state without internals', () => {
    const status = mapLegacyAuthError(500)
    expect(status.state).toBe('failed')
    expect(status.retryable).toBe(true)
  })
})

describe('getExternalPlatformAction', () => {
  it('uses external-platform language for Sleeper leagues', () => {
    expect(
      getExternalPlatformAction({
        platform: 'sleeper',
        action: 'Set lineup',
        externalUrl: 'https://sleeper.com/leagues/example',
      }),
    ).toEqual({ mode: 'external', label: 'Open in Sleeper', external: true })
  })

  it('never surfaces a write-style verb for an external platform even without a URL', () => {
    const action = getExternalPlatformAction({ platform: 'sleeper', action: 'Submit waiver' })
    expect(action.mode).toBe('external')
    expect(action.label).not.toMatch(/submit|set|accept|edit|change|update|sync/i)
  })

  it('keeps native language for AF-native leagues', () => {
    expect(getExternalPlatformAction({ platform: 'allfantasy', action: 'Set lineup' })).toEqual({
      mode: 'native',
      label: 'Set lineup',
      external: false,
    })
  })
})

describe('buildIntelligenceEvidence', () => {
  it('is low-confidence with a disclaimer on thin history', () => {
    const evidence = buildIntelligenceEvidence({
      matchupCount: 3,
      tradeCount: 0,
      rosterCount: 1,
      basedOn: ['Sleeper league history'],
    })
    expect(evidence.confidence).toBe('low')
    expect(evidence.missingInputs).toContain('historical matchups')
    expect(evidence.missingInputs).toContain('historical trades')
    expect(evidence.disclaimer).toMatch(/limited historical evidence/i)
  })

  it('is high-confidence with no disclaimer when evidence is rich', () => {
    const evidence = buildIntelligenceEvidence({
      matchupCount: 40,
      tradeCount: 9,
      rosterCount: 12,
      importedSeasonCount: 5,
      expectedSeasonCount: 5,
      basedOn: ['Sleeper league history', 'imported transactions'],
    })
    expect(evidence.confidence).toBe('high')
    expect(evidence.disclaimer).toBeUndefined()
    expect(evidence.dataCoveragePercent).toBe(100)
  })

  it('reports null coverage when the expected total is unknown (never fabricates 0%)', () => {
    const evidence = buildIntelligenceEvidence({ matchupCount: 25, tradeCount: 6, rosterCount: 10, basedOn: [] })
    expect(evidence.dataCoveragePercent).toBeNull()
  })
})
