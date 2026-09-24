/**
 * A 1QB league and a superflex league read different ADP boards.
 *
 * The importer writes Sleeper's 1QB board as scoring 'standard' and its 2QB board as '2qb' (dynasty
 * 'superflex') under the SAME format and source, and the pool averaged every row it found — so
 * Josh Allen's 18.7 (1QB) and 1.2 (2QB) became ~10 in every league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AdpRow = { playerName: string; position: string; team: string; source: string; adp: number; scoring: string }

const state = vi.hoisted(() => ({
  rows: [] as AdpRow[],
  slots: [] as Array<{ slotName: string; starterCount: number }>,
}))

function matchesScoring(row: AdpRow, scoring: { in?: string[]; notIn?: string[] } | undefined): boolean {
  if (!scoring) return true
  if (scoring.in) return scoring.in.includes(row.scoring)
  if (scoring.notIn) return !scoring.notIn.includes(row.scoring)
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    adpDataRecord: {
      findFirst: vi.fn(async ({ where }: { where: { scoring?: { in?: string[]; notIn?: string[] } } }) =>
        state.rows.some((r) => matchesScoring(r, where.scoring)) ? { season: 2026, week: 1 } : null,
      ),
      findMany: vi.fn(async ({ where }: { where: { scoring?: { in?: string[]; notIn?: string[] } } }) =>
        state.rows.filter((r) => matchesScoring(r, where.scoring)),
      ),
    },
  },
}))

vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => ({ template: { slots: state.slots } })),
  getDraftEligiblePositionsFromPayload: vi.fn(() => new Set<string>()),
}))

import {
  leagueStartsTwoQuarterbacks,
  loadLatestAveragedAdpRowsFromDb,
} from '@/lib/draft-room/getResolvedDraftPoolForLeague'

beforeEach(() => {
  state.rows = [
    { playerName: 'Josh Allen', position: 'QB', team: 'BUF', source: 'sleeper', adp: 18.7, scoring: 'standard' },
    { playerName: 'Josh Allen', position: 'QB', team: 'BUF', source: 'sleeper', adp: 1.2, scoring: '2qb' },
  ]
})

describe('ADP board by quarterback format', () => {
  it('a 1QB league reads only the 1QB board', async () => {
    const [row] = await loadLatestAveragedAdpRowsFromDb('NFL' as never, 'redraft', false)
    expect(row.adp).toBeCloseTo(18.7)
  })

  it('a superflex league reads the 2QB board', async () => {
    const [row] = await loadLatestAveragedAdpRowsFromDb('NFL' as never, 'redraft', true)
    expect(row.adp).toBeCloseTo(1.2)
  })

  it('a superflex league with no 2QB board falls back to the 1QB one rather than none', async () => {
    state.rows = state.rows.filter((r) => r.scoring !== '2qb')
    const [row] = await loadLatestAveragedAdpRowsFromDb('NFL' as never, 'redraft', true)
    expect(row.adp).toBeCloseTo(18.7)
  })
})

describe('reading two quarterbacks off the lineup', () => {
  it.each([
    [[{ slotName: 'QB', starterCount: 1 }, { slotName: 'SUPERFLEX', starterCount: 1 }], true],
    [[{ slotName: 'QB', starterCount: 1 }, { slotName: 'SUPER_FLEX', starterCount: 1 }], true],
    [[{ slotName: 'QB', starterCount: 1 }, { slotName: 'SF', starterCount: 1 }], true],
    [[{ slotName: 'QB', starterCount: 2 }], true],
    [[{ slotName: 'QB', starterCount: 1 }, { slotName: 'FLEX', starterCount: 2 }], false],
    [[{ slotName: 'QB', starterCount: 1 }, { slotName: 'SUPERFLEX', starterCount: 0 }], false],
  ])('%j → %s', async (slots, expected) => {
    state.slots = slots
    expect(await leagueStartsTwoQuarterbacks('L')).toBe(expected)
  })
})
