import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Commissioner hub, 2026-11-20: the "no moves in 14 days" warning cites its graded record, in the SAME bands the
 * commissioner's health decision uses in Chimmy, so the screen and Chimmy never disagree about how far to trust it.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: vi.fn(async () => null) }))

const { abandonedTeamsFlag } = await import('@/lib/core-app/commissioner/health')
const { inactiveFlagHubRecord } = await import('@/lib/commissioner-hub/inactiveFlagRecord')
const { evaluateCommissionerHealthRules } = await import('@/lib/decision-os/commissioner-health/rules')
const { fakeSnapshot } = await import('../decision-os/commissionerHealthFakes')

const quiet = {
  managers: [
    { name: 'Busy Bees', status: 'active' as const },
    { name: 'Sleepy', status: 'inactive' as const },
  ],
  orphanTeams: [],
  totalTeams: 2,
  action: null,
}
const view = (stayedAway: number, graded: number) => ({ graded, stayedAway, ratePct: Math.round((100 * stayedAway) / graded) })

describe('the quiet-manager warning cites its record', () => {
  it.each([
    [view(45, 50), 'held_up', 'This warning has held up: 45 of 50 managers'],
    [view(30, 50), 'mixed', '30 of 50 managers AllFantasy flagged this way still had no moves two weeks later — message them before replacing anyone.'],
    [view(5, 50), 'low', 'Most managers flagged this way came back on their own: only 5 of 50'],
  ])('%o → %s', (record, standing, text) => {
    const r = inactiveFlagHubRecord(record)
    expect(r?.standing).toBe(standing)
    const flag = abandonedTeamsFlag({ ...quiet, inactiveRecord: r })
    expect(flag.measured && flag.detail).toContain(text)
    // The existing caution stays; the record is added after it.
    expect(flag.measured && flag.detail).toContain('Quiet isn’t the same as gone')
  })

  it('in Spanish too', () => {
    const flag = abandonedTeamsFlag({ ...quiet, inactiveRecord: inactiveFlagHubRecord(view(5, 50)), language: 'es' } as never)
    expect(flag.measured && flag.detail).toContain('La mayoría de los mánagers marcados así volvieron por su cuenta: solo 5 de 50')
  })

  it('under the record’s floor, or with no record, the warning reads exactly as before', () => {
    const before = abandonedTeamsFlag(quiet)
    expect(inactiveFlagHubRecord({ graded: 12, stayedAway: 10, ratePct: null })).toBeNull()
    expect(abandonedTeamsFlag({ ...quiet, inactiveRecord: inactiveFlagHubRecord({ graded: 12, stayedAway: 10, ratePct: null }) })).toEqual(before)
    expect(abandonedTeamsFlag({ ...quiet, inactiveRecord: null })).toEqual(before)
  })

  it('no quiet manager, no record line — an empty seat is a different fact', () => {
    // An empty seat with every manager active reaches the same detail list the record line sits in.
    const flag = abandonedTeamsFlag({
      ...quiet,
      managers: [{ name: 'Busy Bees', status: 'active' }, { name: 'Also Busy', status: 'active' }],
      orphanTeams: ['Empty Seat'],
      inactiveRecord: inactiveFlagHubRecord(view(5, 50)),
    })
    expect(flag.measured && flag.detail).toContain('Empty Seat')
    expect(flag.measured && flag.detail).not.toContain('flagged this way')
  })

  it('🛑 the bands are the decision’s bands — the hub and Chimmy cannot disagree', () => {
    const snapshot = fakeSnapshot({ nativeLeague: true, metrics: { ...fakeSnapshot().metrics, inactiveTeams: 3 } })
    for (const [stayed, expected] of [[45, 'warning'], [30, 'warning'], [5, 'info']] as const) {
      const record = view(stayed, 50)
      const verdict = evaluateCommissionerHealthRules(snapshot, { inactiveFlags: record }).find((v) => v.rule === 'commissioner.health.inactive_managers')
      expect(verdict?.severity).toBe(expected)
      const standing = inactiveFlagHubRecord(record)!.standing
      expect(standing === 'low').toBe(expected === 'info')
    }
  })
})

describe('the hub passes the record, for a league AllFantasy hosts', () => {
  const SRC = readFileSync(join(process.cwd(), 'lib/core-app/commissionerHub.ts'), 'utf8')
  it('reads it through the shared loader, native only, and hands it to the flag', () => {
    expect(SRC).toMatch(/const inactiveRecord = native \? inactiveFlagHubRecord\(await loadInactiveFlagRecord\(\)\.catch\(\(\) => null\)\) : null/)
    expect(SRC).toMatch(/abandonedTeamsFlag\(\{\s*managers: memberRows,\s*inactiveRecord,/)
  })
})
