/**
 * Schema-drift guard: DraftSession.currentPick does not exist in Prisma.
 * These tests assert the trade-builder routes have no cast to that field
 * and use the canonical resolver (getCanonicalDraftState → nextPick) instead.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TRADE_BUILDER = join(
  process.cwd(),
  'app/api/leagues/[leagueId]/draft/trade-builder',
)

function src(sub: string) {
  return readFileSync(join(TRADE_BUILDER, sub, 'route.ts'), 'utf-8')
}

describe('trade-builder currentPick schema-drift guard', () => {
  const suggestions = src('suggestions')
  const analyze = src('analyze')

  it('suggestions: no (draftSession as { currentPick? }) cast', () => {
    expect(suggestions).not.toMatch(/as\s*\{\s*currentPick\s*\?/)
  })

  it('analyze: no (draftSession as { currentPick? }) cast', () => {
    expect(analyze).not.toMatch(/as\s*\{\s*currentPick\s*\?/)
  })

  it('suggestions: legacyCurrentPick variable is gone', () => {
    expect(suggestions).not.toContain('legacyCurrentPick')
  })

  it('analyze: legacyCurrentPick variable is gone', () => {
    expect(analyze).not.toContain('legacyCurrentPick')
  })

  it('suggestions: uses canonicalDraftState.nextPick as the current-pick source', () => {
    expect(suggestions).toMatch(/canonicalDraftState\?\.nextPick/)
  })

  it('analyze: uses canonicalDraftState.nextPick as the current-pick source', () => {
    expect(analyze).toMatch(/canonicalDraftState\?\.nextPick/)
  })

  it('suggestions: falls back to null (not undefined or legacy) when nextPick is absent', () => {
    // The condition must use != null so overall === 0 is also handled safely.
    expect(suggestions).toMatch(/nextPick\?\.overall\s*!=\s*null/)
  })

  it('analyze: falls back to null (not undefined or legacy) when nextPick is absent', () => {
    expect(analyze).toMatch(/nextPick\?\.overall\s*!=\s*null/)
  })
})
