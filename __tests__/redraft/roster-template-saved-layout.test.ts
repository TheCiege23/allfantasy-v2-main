/**
 * `getRosterTemplate(sport, format, leagueId)` feeds the lineup editor, league home, roster legality,
 * lineup scans and Chimmy's lineup action. For an NFL / NCAAF redraft-core league it must resolve the
 * league's OWN saved layout, not the sport default — otherwise a league saved with QB, RB, WR, WR, TE, DEF
 * shows empty FLEX / K slots once the defaults carry them (owner, 2026-10-20).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, rosterTemplateFindUnique } = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  rosterTemplateFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    rosterTemplate: { findUnique: rosterTemplateFindUnique },
  },
}))

import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'

function league(sport: 'NFL' | 'NCAAF', settings: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    settings,
    sport,
    leagueType: 'redraft',
    isDynasty: false,
    leagueVariant: null,
    bestBallMode: false,
    guillotineMode: false,
    keeperPhaseActive: false,
    ...overrides,
  }
}

function starters(template: Awaited<ReturnType<typeof getRosterTemplate>>): Record<string, number> {
  return Object.fromEntries(template.slots.filter((s) => s.starterCount > 0).map((s) => [s.slotName, s.starterCount]))
}

describe('getRosterTemplate — football redraft saved layout', () => {
  beforeEach(() => {
    rosterTemplateFindUnique.mockResolvedValue(null)
  })

  it('resolves a saved cut lineup as saved: no FLEX, no K, one RB', async () => {
    for (const sport of ['NFL', 'NCAAF'] as const) {
      leagueFindUnique.mockResolvedValue(
        league(sport, { starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 }, bench_slots: 6, ir_slots: 1 }),
      )
      const template = await getRosterTemplate(sport, 'standard', 'league-1')
      expect(starters(template)).toEqual({ QB: 1, RB: 1, WR: 2, TE: 1, DST: 1 })
      expect(template.slots.find((s) => s.slotName === 'BENCH')?.benchCount).toBe(6)
      expect(template.slots.find((s) => s.slotName === 'IR')?.reserveCount).toBe(1)
    }
  })

  it('resolves a FLEX / DST custom lineup with exactly one flex and one defense', async () => {
    leagueFindUnique.mockResolvedValue(
      league('NFL', { starter_slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1 } }),
    )
    const template = await getRosterTemplate('NFL', 'standard', 'league-1')
    expect(starters(template)).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1 })
  })

  it('gives a redraft league with no saved layout the full default lineup', async () => {
    leagueFindUnique.mockResolvedValue(league('NFL', {}))
    expect(starters(await getRosterTemplate('NFL', 'standard', 'league-1'))).toEqual({
      QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1, FLEX: 1,
    })
    leagueFindUnique.mockResolvedValue(league('NCAAF', {}))
    expect(starters(await getRosterTemplate('NCAAF', 'standard', 'league-1'))).toEqual({
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1,
    })
  })

  it('leaves non-redraft-core leagues (dynasty) on the existing resolution', async () => {
    leagueFindUnique.mockResolvedValue(
      league('NFL', { starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 } }, { isDynasty: true, leagueType: 'dynasty' }),
    )
    const template = await getRosterTemplate('NFL', 'standard', 'league-1')
    expect(template.templateId.startsWith('saved-')).toBe(false)
  })
})
