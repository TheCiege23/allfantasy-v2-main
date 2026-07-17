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
      // Production refusal is delegated to the single shared guard.
      expect(src).toContain('refuseIfNotNonProduction')
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

  // Positive control. The previous version of this test re-implemented the guard inline
  // (`host.includes('ep-spring-tooth')`) and asserted that its own copy matched itself — a
  // tautology that stayed green while the real marker named a dev clone and production went
  // unguarded. Exercise the ACTUAL shared guard instead, so a regression in it fails here.
  it('the shared guard these scripts call really does refuse production and permit local dev', async () => {
    const { classifyDatabaseTarget } = await import('@/scripts/db-target-identity')
    const at = (host: string, db: string) => `postgresql://u:p@${host}.c-2.us-east-1.aws.neon.tech/${db}`

    expect(classifyDatabaseTarget(at('ep-curly-block-ad0dlt9o', 'neondb')).classification).toBe('production')
    expect(classifyDatabaseTarget(at('ep-curly-block-ad0dlt9o-pooler', 'mydb_shadow')).classification).toBe(
      'non-production',
    )
    expect(classifyDatabaseTarget(at('ep-winter-salad-67890', 'neondb')).classification).toBe('unknown')
  })
})
