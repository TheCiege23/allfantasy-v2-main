import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Architecture Regression Suite for `manager.waiver.claim` (Slice 2). Tests the ARCHITECTURE, not
 * fantasy: the decision layer flows through DCO + Rule Framework, read-only, no prisma, and is NOT
 * coupled to the out-of-scope Sleeper dashboard widget (fetchWaiverDashboard).
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const PURE_LAYER = [
  'lib/decision-os/waiver/world.ts',
  'lib/decision-os/waiver/dco.ts',
  'lib/decision-os/waiver/decision.ts',
  'lib/decision-os/waiver/rules.ts',
  'lib/decision-os/waiver/parity.ts',
].map((p) => [p, read(p)] as const)

const ALL_WAIVER = [
  ...PURE_LAYER.map(([p]) => p),
  'lib/decision-os/waiver/loader.ts',
  'lib/decision-os/waiver/deps.ts',
  'lib/decision-os/waiver/shadow.ts',
  'lib/decision-os/waiver/index.ts',
  'lib/decision-os/waiver/waiverCardAdapter.ts',
  'lib/decision-os/waiver/outcome.ts',
].map((p) => [p, read(p)] as const)

describe('architecture: the waiver decision layer consumes only the DCO (no prisma/config reads)', () => {
  it('world/dco/decision/rules/parity perform NO prisma reads', () => {
    for (const [path, src] of PURE_LAYER) {
      expect(`${path}:${src.includes('@/lib/prisma')}`).toBe(`${path}:false`)
      expect(`${path}:${/prisma\./.test(src)}`).toBe(`${path}:false`)
      expect(`${path}:${/\.(findMany|findFirst|findUnique)\(/.test(src)}`).toBe(`${path}:false`)
    }
  })

  it('decision.ts contains NO direct engine/settings imports (recommender + rules are injected)', () => {
    const [, decision] = PURE_LAYER.find(([p]) => p.endsWith('decision.ts'))!
    expect(decision).not.toContain('@/lib/waiver-wire/transaction-eligibility')
    expect(decision).not.toContain('getEffectiveLeagueWaiverSettings')
    // It WRAPS the recommender via injected deps — it may import the engine *types*, never call prisma.
  })
})

describe('architecture: World / DCO are read-only', () => {
  it('world.ts and dco.ts perform ZERO writes and no prisma', () => {
    for (const [, src] of [PURE_LAYER[0], PURE_LAYER[1]]) {
      expect(src).not.toContain('@/lib/prisma')
      expect(src).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/)
    }
  })
})

describe('architecture: NO coupling to the out-of-scope Sleeper dashboard widget', () => {
  it('no waiver decision-os module references fetchWaiverDashboard or dashboard-strip', () => {
    for (const [path, src] of ALL_WAIVER) {
      expect(`${path}:${src.includes('fetchWaiverDashboard')}`).toBe(`${path}:false`)
      expect(`${path}:${src.includes('dashboard-strip')}`).toBe(`${path}:false`)
    }
  })
})
