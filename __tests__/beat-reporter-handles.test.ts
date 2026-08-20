import { describe, it, expect } from 'vitest'
import {
  X_SEARCH_ALLOWED_HANDLES,
  X_HANDLE_LIMIT,
  NFL_INSIDER_HANDLES,
  FANTASY_ANALYST_HANDLES,
} from '@/lib/news/beatReporterHandles'

/**
 * The whitelist is a trust boundary. Without it the search covers all of X, and
 * whatever the platform surfaces becomes input to a model that reports injury
 * status into trade recommendations and draft picks.
 */
describe('X_SEARCH_ALLOWED_HANDLES', () => {
  it('never exceeds the vendor cap of 20', () => {
    // The API rejects more than 20. Exceeding it would fail the whole request,
    // which fails OPEN in practice — no search results, silently.
    expect(X_SEARCH_ALLOWED_HANDLES.length).toBeLessThanOrEqual(X_HANDLE_LIMIT)
  })

  it('is not empty — an empty list would search all of X', () => {
    expect(X_SEARCH_ALLOWED_HANDLES.length).toBeGreaterThan(0)
  })

  it('contains no duplicates, which would waste slots against the cap', () => {
    expect(new Set(X_SEARCH_ALLOWED_HANDLES).size).toBe(X_SEARCH_ALLOWED_HANDLES.length)
  })

  it('carries no @ prefix or whitespace — the API wants bare handles', () => {
    for (const h of X_SEARCH_ALLOWED_HANDLES) {
      expect(h).not.toMatch(/^@/)
      expect(h).toBe(h.trim())
      expect(h).not.toMatch(/\s/)
    }
  })

  it('includes the accounts that actually break injury news', () => {
    // If these ever fall off the list, the feed keeps working and quietly stops
    // being first — the failure is invisible without an assertion.
    for (const h of ['AdamSchefter', 'RapSheet', 'TomPelissero', 'MikeGarafolo']) {
      expect(X_SEARCH_ALLOWED_HANDLES).toContain(h)
    }
  })

  it('keeps room for fantasy analysts alongside the insiders', () => {
    const hasInsider = NFL_INSIDER_HANDLES.some((h) => X_SEARCH_ALLOWED_HANDLES.includes(h))
    const hasAnalyst = FANTASY_ANALYST_HANDLES.some((h) => X_SEARCH_ALLOWED_HANDLES.includes(h))
    // The slice truncates from the end, so a growing insider list could silently
    // push every analyst out.
    expect(hasInsider).toBe(true)
    expect(hasAnalyst).toBe(true)
  })
})
