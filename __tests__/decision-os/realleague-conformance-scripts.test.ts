import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * ADR-DOS-F1 — boundary guards for the read-only real-league conformance scripts (lineup/waiver/
 * commissioner). They must mirror the trade conformance contract: prod-host refusal, DB gating, prisma
 * imported AFTER the gate, argv targeting, and ZERO direct prisma writes (they validate read-only).
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const SCRIPTS = [
  { path: 'scripts/decision-os-lineup-conformance.ts', sentinel: 'LINEUP_CONFORMANCE_OK' },
  { path: 'scripts/decision-os-waiver-conformance.ts', sentinel: 'WAIVER_CONFORMANCE_OK' },
  { path: 'scripts/decision-os-commissioner-conformance.ts', sentinel: 'COMMISSIONER_CONFORMANCE_OK' },
].map((s) => ({ ...s, src: read(s.path) }))

describe('ADR-DOS-F1: each conformance script gates + refuses prod like the trade model', () => {
  for (const { path, sentinel, src } of SCRIPTS) {
    it(`${path} — DB-gated, prod-refusing, prisma after the gate, argv-targeted, prints ${sentinel}`, () => {
      // DB gate + clean skip.
      expect(src).toContain('hasDatabaseUrl')
      expect(src).toMatch(/SKIPPED \(no DATABASE_URL\)/)
      // Prod host hard-refusal.
      expect(src).toContain('ep-spring-tooth')
      expect(src).toMatch(/refusing production DB host/i)
      // Prisma imported dynamically AFTER the gate — no top-level static prisma import.
      expect(/^import\s+[^\n]*\bprisma\b[^\n]*from\s+['"][^'"]*lib\/prisma['"]/m.test(src)).toBe(false)
      expect(src).toMatch(/await import\(['"][^'"]*lib\/prisma['"]\)/)
      // League ids by argv.
      expect(src).toMatch(/process\.argv\.slice\(2\)/)
      // Right sentinel + failure variant.
      expect(src).toContain(`${sentinel}`)
      expect(src).toMatch(new RegExp(`${sentinel.replace('_OK', '_FAILED')}`))
    })

    it(`${path} — performs ZERO direct prisma writes (read-only validation)`, () => {
      const anyWrite = /prisma\.[a-zA-Z]+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/
      expect(anyWrite.test(src)).toBe(false)
    })
  }

  it('the prod-host refusal regex actually catches a prod URL (positive control)', () => {
    const refuse = (host: string) => host.includes('ep-spring-tooth')
    expect(refuse('ep-spring-tooth-12345.aws.neon.tech')).toBe(true)
    expect(refuse('ep-winter-salad-67890.aws.neon.tech')).toBe(false)
  })
})
