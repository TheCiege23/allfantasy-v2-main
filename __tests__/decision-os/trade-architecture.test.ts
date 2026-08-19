import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Architecture Regression Suite for `manager.trade.evaluate` (Slice 3). Tests the ARCHITECTURE: the
 * decision layer flows through DCO + Rule Framework, read-only, no prisma; and NO trade module
 * imports settlement/execution or AI/war-room surfaces, and never calls captureRedraftTradeValueSnapshot.
 */
// Strip block + line comments so the forbidden-token scan checks real code/imports, not the
// explanatory comments (which legitimately say "never calls captureRedraftTradeValueSnapshot", etc.).
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const PURE_LAYER = [
  'lib/decision-os/trade/world.ts',
  'lib/decision-os/trade/dco.ts',
  'lib/decision-os/trade/decision.ts',
  'lib/decision-os/trade/rules.ts',
  'lib/decision-os/trade/parity.ts',
].map((p) => [p, read(p)] as const)

const ALL_TRADE = [
  ...PURE_LAYER.map(([p]) => p),
  'lib/decision-os/trade/loader.ts',
  'lib/decision-os/trade/deps.ts',
  'lib/decision-os/trade/shadow.ts',
  'lib/decision-os/trade/index.ts',
  'lib/decision-os/trade/tradeCardAdapter.ts',
  'lib/decision-os/trade/outcome.ts',
].map((p) => [p, read(p)] as const)

// Execution / mutation / AI surfaces the Decision OS trade slice must NEVER import or consume.
const FORBIDDEN = [
  'tradeSettlement',
  'settleRedraftTrade',
  'captureRedraftTradeValueSnapshot',
  'trade-votes',
  'dual-brain-trade-analyzer',
  'redraft-war-room',
  'redraft/ai/tradeAnalyzer',
  'openChimmyWithPrompt',
  'redraftTradeEngine',
]

describe('architecture: trade decision layer consumes only the DCO (no prisma)', () => {
  it('world/dco/decision/rules/parity perform NO prisma reads', () => {
    for (const [path, src] of PURE_LAYER) {
      expect(`${path}:${src.includes('@/lib/prisma')}`).toBe(`${path}:false`)
      expect(`${path}:${/prisma\./.test(src)}`).toBe(`${path}:false`)
      expect(`${path}:${/\.(findMany|findFirst|findUnique)\(/.test(src)}`).toBe(`${path}:false`)
    }
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

describe('architecture: NO execution / settlement / AI coupling (evaluate-only)', () => {
  it('no trade decision-os module imports settlement, execution routes, AI, or war-room engines', () => {
    for (const [path, src] of ALL_TRADE) {
      for (const token of FORBIDDEN) {
        expect(`${path} imports ${token}: ${src.includes(token)}`).toBe(`${path} imports ${token}: false`)
      }
    }
  })

  it('no trade module performs writes (create/update/delete/settle/vote/accept/process)', () => {
    for (const [path, src] of ALL_TRADE) {
      expect(`${path}:${/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)}`).toBe(`${path}:false`)
    }
  })
})
