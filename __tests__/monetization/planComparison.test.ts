import { describe, expect, it } from 'vitest'
import { buildPlanComparison, planExamplesAreConsistent, PLAN_EXAMPLES, COMPARISON_TIERS } from '@/lib/monetization/planComparison'
import { COMMISSIONERS_ROADMAP } from '@/components/core-app/screens/commissionersCopy'

function cells(rowId: string) {
  const row = buildPlanComparison().flatMap((g) => g.rows).find((r) => r.id === rowId)
  expect(row, rowId).toBeDefined()
  return COMPARISON_TIERS.map((t) => (row!.cells[t].kind === 'text' ? (row!.cells[t] as { text: string }).text : row!.cells[t].kind))
}

/**
 * These are the paywall's answers, read through hasFeatureAccessForPlans. If one of them changes, a
 * feature moved between plans: check the move was intended, then update the expectation.
 */
describe('plan comparison', () => {
  it('keeps running a league free on every plan', () => {
    for (const id of ['leagues', 'season', 'basics', 'dues']) expect(cells(id)).toEqual(['yes', 'yes', 'yes', 'yes'])
  })

  it('puts the manager tools on Pro and Supreme only', () => {
    for (const id of ['trade_breakdown', 'player_depth', 'competitive_edge', 'start_sit', 'waivers']) {
      expect(cells(id), id).toEqual(['no', 'yes', 'no', 'yes'])
    }
  })

  it('puts Commissioner OS on Commissioner and Supreme only', () => {
    for (const id of ['league_health', 'integrity', 'recaps', 'draft_as_me', 'scoring', 'playoffs', 'bb_narration']) {
      expect(cells(id), id).toEqual(['no', 'no', 'yes', 'yes'])
    }
  })

  it('reads the Chimmy allowance from the constants the counter enforces', () => {
    expect(cells('chimmy')).toEqual(['2 a day', '100 a day', '2 a day', '100 a day'])
  })

  it('marks the Commissioner OS roadmap as coming soon, and only that', () => {
    const soon = buildPlanComparison().find((g) => g.id === 'soon')!
    expect(soon.rows.map((r) => r.label)).toEqual(COMMISSIONERS_ROADMAP.items.map((i) => i.title))
    const elsewhere = buildPlanComparison().filter((g) => g.id !== 'soon').flatMap((g) => g.rows)
    for (const row of elsewhere) for (const t of COMPARISON_TIERS) expect(row.cells[t].kind, row.id).not.toBe('soon')
  })

  it('only gives a plan examples its own gate actually opens', () => {
    expect(planExamplesAreConsistent()).toBe(true)
    for (const t of COMPARISON_TIERS) expect(PLAN_EXAMPLES[t].length, t).toBeGreaterThanOrEqual(1)
  })

  it('links only to sections the Commissioner OS page has', () => {
    const ids = ['league-health', 'illegal-lineups', 'trade-evaluator', 'integrity', 'league-hub', 'dues-tracker', 'features']
    const links = [
      ...buildPlanComparison().flatMap((g) => g.rows).map((r) => r.learnMoreHref),
      ...COMPARISON_TIERS.flatMap((t) => PLAN_EXAMPLES[t].map((e) => e.learnMoreHref)),
    ].filter(Boolean) as string[]
    for (const href of links) {
      expect(href.startsWith('/commissioners#'), href).toBe(true)
      expect(ids, href).toContain(href.split('#')[1])
    }
  })
})
