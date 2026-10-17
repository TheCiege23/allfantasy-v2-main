// @vitest-environment node
/**
 * Milestone 32 retired manager characterisation labels, and the product surfaces that sold them.
 * What the `manager_psychology` plan feature opens today is Competitive Edge: the other managers'
 * own RECORDED moves — trades, draft picks, waiver bids — beside your decision. The copy that still
 * advertised "Manager Psychology", "behavioral profiles" and "your own profile is always free"
 * described something that no longer exists (and the last claim was already false).
 *
 * 🛑 The feature ID is load-bearing — gates, the plan matrix and `coreDepthAccess` read it — so the
 * positive control is that `manager_psychology` is still the key, still gated to the same plans.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTITLEMENTS } from '@/lib/monetization/entitlements'
import { resolveToolLaunches } from '@/lib/chimmy-orchestration/tool-routing-map'

const ROOT = path.resolve(__dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')
const RETIRED = /psycholog|behavioral profile|always free|Opponent Behavior/i

describe('manager_psychology entitlement — the id stays, the copy says Competitive Edge', () => {
  const ent = ENTITLEMENTS.manager_psychology

  it('keeps its key and plans (positive control)', () => {
    expect(ent.key).toBe('manager_psychology')
    expect([...ent.requiredPlan]).toEqual(['af_pro', 'af_war_room', 'af_supreme'])
    expect(ent.highlightParam).toBe('manager_psychology')
  })

  it('describes what the plan opens, with no psychology or free-profile claim', () => {
    expect(ent.label).toBe('Competitive Edge')
    expect(ent.upgradeLabel).toBe('Unlock Competitive Edge')
    expect(ent.description).toMatch(/trades, draft picks and waiver bids/)
    for (const copy of [ent.label, ent.description, ent.upgradeLabel]) expect(copy).not.toMatch(RETIRED)
  })
})

describe("Chimmy's tool launch for the manager_psychology intent", () => {
  it('names Competitive Edge and describes recorded moves, not profiles', () => {
    const withLeague = resolveToolLaunches('manager_psychology', { leagueId: 'L1', sport: 'NFL' })
    const withoutLeague = resolveToolLaunches('manager_psychology', { sport: 'NFL' })
    for (const r of [withLeague, withoutLeague]) {
      // Positive control: the intent still launches something.
      expect(r.primary).toBeTruthy()
      expect(r.primary!.label).toBe('Competitive Edge')
      expect(`${r.primary!.label} ${r.primary!.description} ${decodeURIComponent(r.primary!.href)}`).not.toMatch(
        /psychology\.|Behavioral profiles|read manager behavior/i,
      )
    }
  })
})

describe('customer copy that sold the retired feature', () => {
  it('the af-legacy compare tab is "Manager Comparison", not "Opponent Behavior"', () => {
    for (const f of ['app/af-legacy/layout.tsx', 'app/af-legacy/page.tsx', 'lib/monetization/feature-monetization-matrix.ts']) {
      const src = read(f)
      expect(src, f).not.toMatch(/Opponent Behavior/)
    }
    expect(read('app/af-legacy/layout.tsx')).toMatch(/tab=compare", label: "Manager Comparison"/)
  })

  it('the Partners page no longer offers "manager psychology" to media partners', () => {
    const src = read('components/core-app/screens/Partners.tsx')
    expect(src).toMatch(/Media & creators/)
    expect(src).not.toMatch(/Manager psychology/i)
    // The capability card sold labels outright: "who overpays, who never streams".
    expect(src).not.toMatch(/who overpays|never streams/i)
  })
})
