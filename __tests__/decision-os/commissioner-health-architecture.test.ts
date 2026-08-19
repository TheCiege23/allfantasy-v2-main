import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Architecture Regression Suite for `commissioner.league.health` (Slice 4). The decision layer flows
 * through DCO + Rule Framework, read-only, no prisma; and NO slice module imports execution /
 * commissioner-action / AI-commissioner-insight surfaces, nor performs any write.
 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const BASE = 'lib/decision-os/commissioner-health'
const PURE_LAYER = ['world.ts', 'dco.ts', 'decision.ts', 'rules.ts', 'parity.ts'].map((f) => [`${BASE}/${f}`, read(`${BASE}/${f}`)] as const)
const ALL = ['world.ts', 'dco.ts', 'decision.ts', 'rules.ts', 'parity.ts', 'deps.ts', 'shadow.ts', 'index.ts', 'healthCardAdapter.ts', 'outcome.ts'].map((f) => [`${BASE}/${f}`, read(`${BASE}/${f}`)] as const)

// Execution / AI / mutation surfaces the slice must NEVER import or consume.
const FORBIDDEN = [
  '@/lib/prisma',
  'ai-commissioner',
  'getAICommissionerInsights',
  'tradeSettlement',
  'process-engine',
  'sendAnnouncement',
  'monitorLeagueHealth', // must not recompute health — only wrap the built snapshot
]

describe('architecture: commissioner-health decision layer consumes only the DCO (no prisma)', () => {
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

describe('architecture: NO execution / AI-insight coupling, NO recompute (assessment-only)', () => {
  it('no commissioner-health module imports execution, AI commissioner insights, or the health engine', () => {
    for (const [path, src] of ALL) {
      for (const token of FORBIDDEN) {
        expect(`${path} imports ${token}: ${src.includes(token)}`).toBe(`${path} imports ${token}: false`)
      }
    }
  })

  it('no commissioner-health module performs writes (create/update/delete)', () => {
    for (const [path, src] of ALL) {
      expect(`${path}:${/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)}`).toBe(`${path}:false`)
    }
  })
})
