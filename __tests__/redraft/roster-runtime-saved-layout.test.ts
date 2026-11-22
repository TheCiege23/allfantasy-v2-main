/**
 * The NFL redraft roster runtime (lineups, starter slots) reads `rules.roster.starters`. For a native
 * league `League.starters` is null, so it used to fall back to its own full default lineup even when the
 * league had saved a smaller one. It must use the saved layout (owner, 2026-10-20).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildCanonicalLeagueRulesFromResolved } from '@/lib/league-runtime/canonicalLeagueRules'
import { buildCanonicalStarterSlots } from '@/lib/roster-runtime/canonicalRosterRuntime'

function starterTokens(settings: Record<string, unknown>, overrides: Record<string, unknown> = {}): string[] {
  const rules = buildCanonicalLeagueRulesFromResolved({
    league: {
      id: 'league-1',
      sport: 'NFL',
      leagueType: 'redraft',
      isDynasty: false,
      leagueSize: 12,
      starters: null,
      settings,
      ...overrides,
    } as any,
  })
  // Labels carry the slot token, e.g. QB, RB1, FLEX, K, DEF.
  return buildCanonicalStarterSlots(rules).map((slot) => slot.label.replace(/\d+$/, ''))
}

describe('roster runtime starter slots — saved layout', () => {
  it('uses a saved cut lineup: no FLEX, no K', () => {
    const tokens = starterTokens({ starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 } })
    expect(tokens).toHaveLength(6)
    expect(tokens).not.toContain('FLEX')
    expect(tokens).not.toContain('K')
  })

  it('falls back to the full default lineup when nothing is saved', () => {
    const tokens = starterTokens({})
    expect(tokens).toHaveLength(9)
    expect(tokens).toContain('FLEX')
    expect(tokens).toContain('K')
  })

  it('still prefers the imported League.starters column', () => {
    const tokens = starterTokens({ starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 } }, { starters: ['QB', 'RB', 'WR'] })
    expect(tokens).toHaveLength(3)
  })
})
