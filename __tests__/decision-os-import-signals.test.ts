/**
 * Phase 5.2 — Pure derivation tests for the Decision OS import signals.
 *
 * These are unit tests only — no DB, no port. The pure module returns undefined
 * for un-imported leagues and a real dataQuality shape when signals are present.
 */
import { describe, expect, it } from 'vitest'
import {
  deriveImportDataQuality,
  extendLookbackForImport,
} from '@/lib/decision-os/behavioral/import-signals'

describe('deriveImportDataQuality (Phase 5.2 wire-up B)', () => {
  it('returns undefined when signals are null (no wire-up carried through)', () => {
    expect(deriveImportDataQuality(null)).toBeUndefined()
  })

  it('returns undefined when the league has never been imported', () => {
    expect(
      deriveImportDataQuality({
        lastImportedAt: null,
        warningCountsBySeverity: { error: 0, warn: 0, info: 0 },
        latestRunIncomplete: false,
      }),
    ).toBeUndefined()
  })

  it('marks a clean import as healthy (unresolvedWarnings=0, importIncomplete=false)', () => {
    const at = new Date('2026-06-01T00:00:00Z')
    const q = deriveImportDataQuality({
      lastImportedAt: at,
      warningCountsBySeverity: { error: 0, warn: 0, info: 3 },
      latestRunIncomplete: false,
    })
    expect(q).toBeDefined()
    expect(q!.importIncomplete).toBe(false)
    expect(q!.unresolvedWarnings).toBe(0)
    expect(q!.hasRecentImport).toBe(true)
    expect(q!.lastImportedAt).toBe(at.toISOString())
  })

  it('info warnings do not count as unresolved', () => {
    const q = deriveImportDataQuality({
      lastImportedAt: new Date('2026-06-01T00:00:00Z'),
      warningCountsBySeverity: { error: 0, warn: 0, info: 12 },
      latestRunIncomplete: false,
    })
    expect(q!.unresolvedWarnings).toBe(0)
  })

  it('warn warnings count as unresolved but do not mark the import incomplete', () => {
    const q = deriveImportDataQuality({
      lastImportedAt: new Date('2026-06-01T00:00:00Z'),
      warningCountsBySeverity: { error: 0, warn: 3, info: 0 },
      latestRunIncomplete: false,
    })
    expect(q!.unresolvedWarnings).toBe(3)
    expect(q!.importIncomplete).toBe(false)
  })

  it('error warnings mark the import incomplete AND count as unresolved', () => {
    const q = deriveImportDataQuality({
      lastImportedAt: new Date('2026-06-01T00:00:00Z'),
      warningCountsBySeverity: { error: 2, warn: 1, info: 0 },
      latestRunIncomplete: false,
    })
    expect(q!.unresolvedWarnings).toBe(3)
    expect(q!.importIncomplete).toBe(true)
  })

  it('latestRunIncomplete marks the import incomplete on its own', () => {
    const q = deriveImportDataQuality({
      lastImportedAt: new Date('2026-06-01T00:00:00Z'),
      warningCountsBySeverity: { error: 0, warn: 0, info: 0 },
      latestRunIncomplete: true,
    })
    expect(q!.importIncomplete).toBe(true)
  })
})

describe('extendLookbackForImport (Phase 5.2 wire-up A)', () => {
  const now = new Date('2026-07-08T00:00:00Z')

  it('returns the original lookback when no import exists', () => {
    expect(extendLookbackForImport(90, null, now)).toBe(90)
  })

  it('returns the original lookback when the import is within the window', () => {
    const at = new Date('2026-06-15T00:00:00Z') // 23 days ago
    expect(extendLookbackForImport(90, at, now)).toBe(90)
  })

  it('widens the lookback when the import falls outside the window', () => {
    const at = new Date('2026-01-01T00:00:00Z') // 188 days before 2026-07-08
    const extended = extendLookbackForImport(90, at, now)
    expect(extended).toBe(188)
    expect(extended).toBeGreaterThan(90)
  })

  it('never narrows the lookback', () => {
    const at = new Date('2026-07-01T00:00:00Z') // 7 days ago
    expect(extendLookbackForImport(90, at, now)).toBe(90)
  })

  it('defensive: future dates are a no-op (never returns 0 or negative)', () => {
    const at = new Date('2026-08-01T00:00:00Z') // future
    expect(extendLookbackForImport(90, at, now)).toBe(90)
  })
})
