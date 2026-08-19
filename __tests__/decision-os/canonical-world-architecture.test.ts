import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Architecture Regression Suite for the Phase 2 Canonical World Assembly substrate.
 *
 * Enforces the read-only guarantee STRUCTURALLY: the pure layer (facts/derive/assemble/index) imports
 * no prisma and performs no reads/writes; only `port.ts` may touch prisma, and only via read methods.
 * Also guards origin-blindness: business-fact assembly must not branch on provider names.
 */
/**
 * Strip block + line comments so the guards scan actual CODE, not documentation. The pure layer's
 * doc comments legitimately name the write-prone debt (`resolveRedraftRosterLookup`,
 * `prisma.redraftRoster.update`) they deliberately avoid; those references must not trip the guard.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const PURE_LAYER = [
  'lib/decision-os/world/facts.ts',
  'lib/decision-os/world/derive.ts',
  'lib/decision-os/world/assemble.ts',
  'lib/decision-os/world/index.ts',
  // Phase E.1 — the reusable Canonical Asset contract is pure-layer too (no IO, no prisma, no trade import).
  'lib/decision-os/world/assets.ts',
  // Native-redraft roster projection (ADR_CANONICAL_WORLD_REDRAFT_COVERAGE) — pure mapping, no prisma/IO.
  'lib/decision-os/world/redraftRoster.ts',
].map((p) => [p, read(p)] as const)

const PORT = ['lib/decision-os/world/port.ts'].map((p) => [p, read(p)] as const)

describe('architecture: the Canonical World pure layer performs NO IO', () => {
  it('facts/derive/assemble do NOT import prisma or call find/write methods', () => {
    // index.ts orchestrates the port but must not import prisma directly.
    for (const [path, src] of PURE_LAYER) {
      expect(`${path}:${src.includes('@/lib/prisma')}`).toBe(`${path}:false`)
      expect(`${path}:${/prisma\./.test(src)}`).toBe(`${path}:false`)
      expect(`${path}:${/\.(findMany|findFirst|findUnique)\(/.test(src)}`).toBe(`${path}:false`)
    }
  })

  it('the pure layer performs ZERO writes', () => {
    for (const [path, src] of PURE_LAYER) {
      expect(`${path}:${/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)}`).toBe(
        `${path}:false`,
      )
    }
  })

  it('the substrate NEVER imports the write-capable resolveRedraftRosterLookup or WRITES the redraft store (read-only redraft projection is allowed)', () => {
    // Ban the write-capable symbol but permit `resolveRedraftRosterLookupReadOnly` — the bridge seam.
    const writeCapableResolver = /resolveRedraftRosterLookup(?!ReadOnly)/
    // The substrate may READ the native redraft store (`prisma.redraftRoster.findMany` in the port +
    // the pure `redraftRoster.ts` projection per ADR_CANONICAL_WORLD_REDRAFT_COVERAGE), but must NEVER
    // write it — that owner-repair debt (`prisma.redraftRoster.update`) stays out of the world module.
    const redraftWrite = /redraftRoster\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/i
    for (const [path, src] of [...PURE_LAYER, ...PORT]) {
      expect(`${path}:${writeCapableResolver.test(src)}`).toBe(`${path}:false`)
      expect(`${path}:${redraftWrite.test(src)}`).toBe(`${path}:false`)
    }
  })

  it('the write-capable-import guard flags the write-capable symbol but allows the read-only one', () => {
    // Positive control: proves the guard above actually catches an accidental write-capable import.
    const writeCapableResolver = /resolveRedraftRosterLookup(?!ReadOnly)/
    const offending = "import { resolveRedraftRosterLookup } from '@/lib/redraft/redraftRosterIdentity'"
    const allowed = "import { resolveRedraftRosterLookupReadOnly } from '@/lib/redraft/redraftRosterIdentity'"
    expect(writeCapableResolver.test(offending)).toBe(true)
    expect(writeCapableResolver.test(allowed)).toBe(false)
  })
})

describe('architecture: the port is read-only', () => {
  it('port.ts touches prisma but performs ZERO writes', () => {
    for (const [path, src] of PORT) {
      expect(src).toContain('@/lib/prisma')
      expect(`${path}:${/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(src)}`).toBe(
        `${path}:false`,
      )
    }
  })
})

describe('architecture: assembled facts are origin-blind', () => {
  it('assemble.ts does not branch business logic on provider names', () => {
    const [, assemble] = PURE_LAYER.find(([p]) => p.endsWith('assemble.ts'))!
    // Provider names must live only in provenance/adapters, never as a branch in fact assembly.
    expect(assemble).not.toMatch(/===\s*['"]sleeper['"]/)
    expect(assemble).not.toMatch(/===\s*['"]espn['"]/)
    expect(assemble).not.toMatch(/===\s*['"]yahoo['"]/)
  })
})
