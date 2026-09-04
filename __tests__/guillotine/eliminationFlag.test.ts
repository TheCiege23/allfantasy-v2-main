/**
 * Marking a chopped guillotine team as eliminated.
 *
 * 🛑 THE BUG THIS REPLACES. `GuillotineEliminationEngine` wrote `isEliminated: true` to
 * `prisma.roster` — a model with no such field — through a type assertion:
 *
 *     await (prisma.roster.update as (args: {...}) => Promise<unknown>)({ ... }).catch(() => {})
 *
 * The cast replaced Prisma's typed argument with `Record<string, unknown>`, so TypeScript could
 * not object. Prisma rejected the unknown argument at runtime and `.catch(() => {})` swallowed it.
 * The comment above the call said it existed "so standings, scheduling, and endgame engine filters
 * pick it up". It never once did, in any league, since it was written.
 *
 * ⚠ WHY A SOURCE SCAN AND NOT ONLY BEHAVIOUR. The defect was a cast that suppressed a compile
 * error. A behavioural test cannot see a cast, and this repo does not typecheck its test files at
 * all — so the assertion that the cast is gone has to read the source.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  redraftUpdate: vi.fn(),
  rosterUpdate: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { update: h.rosterUpdate },
    redraftRoster: { update: h.redraftUpdate },
  },
}))
/*
 * The id-space resolution moved OUT of this engine and into the shared reconciler once
 * `Roster.redraftRosterId` existed. Mocking the resolver rather than the two findMany calls it
 * replaced is the point: the engine no longer owns a copy of that rule, so a test that still
 * described the join would be asserting an implementation this file does not have.
 */
vi.mock('@/lib/league-runtime/reconcileRosterRedraftLinks', () => ({
  resolveRedraftRosterId: h.resolve,
}))

import { markRedraftRostersEliminated } from '@/lib/guillotine/GuillotineEliminationEngine'

beforeEach(() => {
  vi.resetAllMocks()
  h.redraftUpdate.mockResolvedValue({})
})

describe('🛑 the flag is written to the model that has it', () => {
  it('writes the flag to the RedraftRoster the resolver returns', async () => {
    h.resolve.mockResolvedValue('cmtl6v21c12wq')

    const out = await markRedraftRostersEliminated('L1', ['roster-uuid-1'])

    expect(out.marked).toEqual(['cmtl6v21c12wq'])
    expect(out.unresolved).toEqual([])
    expect(h.redraftUpdate).toHaveBeenCalledWith({
      where: { id: 'cmtl6v21c12wq' },
      data: { isEliminated: true },
    })
    // 🛑 The old target. Writing here is the bug, and it must never be touched again.
    expect(h.rosterUpdate).not.toHaveBeenCalled()
  })

  it('🛑 reports an unresolvable chop instead of dropping it', async () => {
    /*
     * The case that makes this honest. Across the 12 production guillotine leagues,
     * `rosters.platformUserId` is 202 sleeper-numeric, 23 app uuid and 6 neither out of 231 — so
     * a chopped roster genuinely may not resolve. Silence there means standings show a chopped
     * team as alive with nothing anywhere saying why.
     */
    h.resolve.mockResolvedValue(null)

    const out = await markRedraftRostersEliminated('L1', ['roster-uuid-2'])

    expect(out.marked).toEqual([])
    expect(out.unresolved).toEqual(['roster-uuid-2'])
    expect(h.redraftUpdate).not.toHaveBeenCalled()
  })

  it('marks what it can and reports what it cannot, in one batch', async () => {
    h.resolve.mockImplementation(async (_l: string, id: string) => (id === 'r-ok' ? 'rr-ok' : null))

    const out = await markRedraftRostersEliminated('L1', ['r-ok', 'r-bad'])

    expect(out.marked).toEqual(['rr-ok'])
    expect(out.unresolved).toEqual(['r-bad'])
  })

  it('does nothing, quietly, when nobody was chopped', async () => {
    const out = await markRedraftRostersEliminated('L1', [])
    expect(out).toEqual({ marked: [], unresolved: [] })
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('🛑 does NOT swallow a real write failure', async () => {
    /*
     * The other half of the original defect. `.catch(() => {})` meant a genuine database error was
     * indistinguishable from success. A rejection must propagate.
     */
    h.resolve.mockResolvedValue('rr1')
    h.redraftUpdate.mockRejectedValue(new Error('db exploded'))

    await expect(markRedraftRostersEliminated('L1', ['r1'])).rejects.toThrow('db exploded')
  })
})

describe('🛑 the cast that hid the bug must not come back', () => {
  const SRC = readFileSync(
    join(process.cwd(), 'lib/guillotine/GuillotineEliminationEngine.ts'),
    'utf8',
  )

  it('the source scan is looking at the right file', () => {
    // Positive control: a scan that silently matched nothing would pass every assertion below.
    expect(SRC).toContain('markRedraftRostersEliminated')
    expect(SRC.length).toBeGreaterThan(1000)
  })

  it('no live call writes isEliminated to prisma.roster', () => {
    /*
     * The historical form is quoted in a comment in that file on purpose, so this strips comments
     * before scanning — otherwise the documentation of the bug would trip the guard against it.
     */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/prisma\.roster\.update/)
  })

  it('no type assertion is used to get a prisma call past the compiler', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/prisma\.\w+\.\w+\s+as\s+\(/)
  })
})
