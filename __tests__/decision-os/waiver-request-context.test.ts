/**
 * Tests for lib/decision-os/waiver/WaiverRequestContext.ts — Phase 15.
 * Pure function, no mocking needed.
 */
import { describe, expect, it } from 'vitest'
import { extractWaiverRequestContext, type WaiverRequestContext } from '@/lib/decision-os/waiver/WaiverRequestContext'
import type { WaiverAIServiceInput } from '@/lib/waiver-ai-engine'

function baseInput(overrides: Partial<WaiverAIServiceInput> = {}): WaiverAIServiceInput {
  return { sport: 'NFL', leagueSettings: {}, availablePlayers: [], ...overrides }
}

describe('extractWaiverRequestContext — context construction', () => {
  it('extracts all three real request-scoped fields from a fully-specified request', () => {
    const ctx = extractWaiverRequestContext(baseInput({ currentWeek: 8, goal: 'rebuild', maxResults: 20 }))
    expect(ctx).toEqual<WaiverRequestContext>({ currentWeek: 8, goal: 'rebuild', maxResults: 20 })
  })

  it('is a plain serializable object (no class instances, no functions, no undefined values)', () => {
    const ctx = extractWaiverRequestContext(baseInput({ currentWeek: 3, goal: 'win-now', maxResults: 5 }))
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx)
    for (const value of Object.values(ctx)) {
      expect(value).not.toBeUndefined()
      expect(typeof value === 'function').toBe(false)
    }
  })
})

describe('extractWaiverRequestContext — omitted/defaulted context (week forwarding)', () => {
  it('defaults currentWeek to 1 when omitted — matching the authoritative engine\'s own default', () => {
    const ctx = extractWaiverRequestContext(baseInput({ goal: 'balanced' }))
    expect(ctx.currentWeek).toBe(1)
  })

  it('forwards a real client-supplied currentWeek unchanged', () => {
    const ctx = extractWaiverRequestContext(baseInput({ currentWeek: 17 }))
    expect(ctx.currentWeek).toBe(17)
  })

  it('ignores a non-finite currentWeek and falls back to the real default rather than propagating garbage', () => {
    const ctx = extractWaiverRequestContext(baseInput({ currentWeek: Number.NaN }))
    expect(ctx.currentWeek).toBe(1)
  })
})

describe('extractWaiverRequestContext — goal forwarding', () => {
  it('defaults goal to balanced when omitted — matching the authoritative engine\'s own default', () => {
    const ctx = extractWaiverRequestContext(baseInput({ currentWeek: 1 }))
    expect(ctx.goal).toBe('balanced')
  })

  it.each(['win-now', 'balanced', 'rebuild'] as const)('forwards a real client-supplied goal (%s) unchanged', (goal) => {
    const ctx = extractWaiverRequestContext(baseInput({ goal }))
    expect(ctx.goal).toBe(goal)
  })
})

describe('extractWaiverRequestContext — runtime options (maxResults forwarding)', () => {
  it('defaults maxResults to 10 when omitted — matching the previously-hardcoded shared-service value', () => {
    const ctx = extractWaiverRequestContext(baseInput())
    expect(ctx.maxResults).toBe(10)
  })

  it('forwards a real client-supplied maxResults unchanged when within bounds', () => {
    const ctx = extractWaiverRequestContext(baseInput({ maxResults: 25 }))
    expect(ctx.maxResults).toBe(25)
  })

  it('clamps an out-of-range maxResults to the route\'s own real bound (1-25) rather than forwarding an unsafe value', () => {
    expect(extractWaiverRequestContext(baseInput({ maxResults: 999 })).maxResults).toBe(25)
    expect(extractWaiverRequestContext(baseInput({ maxResults: -5 })).maxResults).toBe(1)
    expect(extractWaiverRequestContext(baseInput({ maxResults: 0 })).maxResults).toBe(1)
  })
})

describe('extractWaiverRequestContext — authorization boundaries', () => {
  it('never includes identity or authorization fields, even if present on the input object', () => {
    const inputWithExtraFields = {
      ...baseInput({ currentWeek: 5, goal: 'balanced', maxResults: 10 }),
      // Not real fields on WaiverAIServiceInput, but proving the extractor only reads
      // the 3 known keys and can't be tricked into forwarding anything else.
      userId: 'user-should-never-appear',
      leagueId: 'league-should-never-appear',
      rosterId: 'roster-should-never-appear',
    } as WaiverAIServiceInput & Record<string, string>

    const ctx = extractWaiverRequestContext(inputWithExtraFields)
    expect(Object.keys(ctx).sort()).toEqual(['currentWeek', 'goal', 'maxResults'])
    expect(JSON.stringify(ctx)).not.toContain('should-never-appear')
  })

  it('is a pure function — never touches the database or any authorization check', () => {
    // No mocks configured for prisma/auth anywhere in this file; if the function tried
    // to reach either, this whole suite would already have failed with a real error.
    expect(() => extractWaiverRequestContext(baseInput())).not.toThrow()
  })
})

describe('extractWaiverRequestContext — identical comparison inputs', () => {
  it('produces byte-identical context for two calls with the same real request', () => {
    const request = baseInput({ currentWeek: 12, goal: 'win-now', maxResults: 8 })
    const ctxA = extractWaiverRequestContext(request)
    const ctxB = extractWaiverRequestContext(request)
    expect(ctxA).toEqual(ctxB)
  })
})
