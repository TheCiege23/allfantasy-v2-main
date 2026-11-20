/**
 * The learning loop for the commissioner (2026-11-20): the inactive-manager warnings take their strength from how
 * the inactive flag has graded (lib/decision-os/commissioner-health/rules.ts).
 *
 * Pinned:
 *   - no record, or fewer than 30 graded, or an imported league: every verdict exactly as before;
 *   - held up (≥70%, shrunk): still a warning, with the record as evidence;
 *   - mixed (40–70%): still a warning, "message them before replacing anyone";
 *   - mostly came back (<40%): an information item, and "abandoned" is no longer critical;
 *   - the count is never changed, and the decision's own sentence follows the verdict.
 */
import { describe, expect, it } from 'vitest'
import { evaluateCommissionerHealthRules, inactiveFlagPrecision } from '@/lib/decision-os/commissioner-health/rules'
import { decideCommissionerHealth } from '@/lib/decision-os/commissioner-health/decision'
import { buildCommissionerHealthDCO } from '@/lib/decision-os/commissioner-health/dco'
import { resolveCommissionerHealthWorld } from '@/lib/decision-os/commissioner-health/world'
import { fakeSnapshot } from './commissionerHealthFakes'

const native = (inactiveTeams: number, over: Record<string, unknown> = {}) =>
  fakeSnapshot({ nativeLeague: true, metrics: { ...fakeSnapshot().metrics, inactiveTeams }, ...over })
const record = (graded: number, stayedAway: number) => ({ graded, stayedAway, ratePct: graded >= 30 ? Math.round((100 * stayedAway) / graded) : null })
const pick = (v: ReturnType<typeof evaluateCommissionerHealthRules>, cat: string) => v.find((x) => x.rule === `commissioner.health.${cat}`)

describe('the inactive warnings learn from the flag’s record', () => {
  it('without a usable record — none, under 30 graded, or an imported league — nothing changes', () => {
    const base = evaluateCommissionerHealthRules(native(3))
    expect(evaluateCommissionerHealthRules(native(3), { inactiveFlags: null })).toEqual(base)
    expect(evaluateCommissionerHealthRules(native(3), { inactiveFlags: record(29, 3) })).toEqual(base)
    const imported = fakeSnapshot({ nativeLeague: false, metrics: { ...fakeSnapshot().metrics, inactiveTeams: 3 } })
    expect(evaluateCommissionerHealthRules(imported, { inactiveFlags: record(100, 10) })).toEqual(evaluateCommissionerHealthRules(imported))
    expect(pick(base, 'inactive_managers')).toMatchObject({ severity: 'warning', message: '3 inactive managers.' })
    expect(pick(base, 'abandoned_teams')).toMatchObject({ severity: 'critical' })
  })

  it('a record that has held up keeps the warning and cites the evidence', () => {
    const v = evaluateCommissionerHealthRules(native(3), { inactiveFlags: record(100, 90) })
    expect(pick(v, 'inactive_managers')).toMatchObject({ severity: 'warning' })
    expect(pick(v, 'inactive_managers')!.message).toBe('3 inactive managers. Past flags have held up: 90 of 100 managers AllFantasy flagged inactive stayed away two weeks later.')
    expect(pick(v, 'abandoned_teams')).toMatchObject({ severity: 'critical' })
  })

  it('a mixed record says to message them before replacing anyone', () => {
    const v = evaluateCommissionerHealthRules(native(3), { inactiveFlags: record(100, 55) })
    expect(pick(v, 'inactive_managers')).toMatchObject({ severity: 'warning' })
    expect(pick(v, 'inactive_managers')!.message).toMatch(/Past flags are mixed .* message them before replacing anyone/)
  })

  it('a record where most came back turns both warnings down, and never changes the count', () => {
    const v = evaluateCommissionerHealthRules(native(3), { inactiveFlags: record(100, 20) })
    expect(pick(v, 'inactive_managers')).toMatchObject({ severity: 'info' })
    expect(pick(v, 'inactive_managers')!.message).toMatch(/^3 managers look inactive, but most past flags came back on their own \(20 of 100/)
    expect(pick(v, 'abandoned_teams')).toMatchObject({ severity: 'warning' })
    expect(pick(v, 'abandoned_teams')!.message).toMatch(/^2 team\(s\) may be abandoned/)
  })

  it('the rate is shrunk toward even odds, so a 30-flag record cannot swing it to an extreme', () => {
    expect(inactiveFlagPrecision(record(30, 30))).toBeCloseTo(0.8, 5)
    expect(inactiveFlagPrecision(record(30, 0))).toBeCloseTo(0.2, 5)
    expect(inactiveFlagPrecision(record(29, 29))).toBeNull()
  })

  it('the decision Chimmy reads follows the learned verdict', async () => {
    const snapshot = native(3)
    const dco = buildCommissionerHealthDCO({ world: resolveCommissionerHealthWorld({ snapshot }), userId: 'u1' })
    const learned = await decideCommissionerHealth(dco, { evaluate: async () => snapshot, newId: () => 'd', learned: { inactiveFlags: record(100, 20) } })
    const plain = await decideCommissionerHealth(dco, { evaluate: async () => snapshot, newId: () => 'd' })
    // Unlearned, a critical verdict leads; learned, no inactive-derived verdict is critical any more.
    expect(plain.rule_verdicts.filter((v) => v.severity === 'critical').map((v) => v.rule)).toEqual(
      expect.arrayContaining(['commissioner.health.abandonment_risk_high', 'commissioner.health.abandoned_teams']),
    )
    expect(learned.rule_verdicts.some((v) => v.severity === 'critical' && /abandon/.test(v.rule))).toBe(false)
    expect(learned.four_answers.why_it_matters).not.toMatch(/find replacements|Abandonment risk is high/)
  })
})
