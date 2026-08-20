import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { assembleCanonicalWorld } from '@/lib/decision-os/world/assemble'
import { makeImportedProviderWorld, makeNativeAfWorld } from './canonicalWorldFakes'

/**
 * ADR-DOS-F0 — boundary regression suite for the NON-PROD imported-league validation tooling.
 *
 * The runner (`scripts/decision-os-import-sleeper-nonprod.ts`) is the ONE place in this ticket that
 * writes — and it may write ONLY the existing import SOURCE tables via the audited import services, NEVER
 * Canonical World and NEVER production. These static guards + the hermetic discoverability fixture lock
 * that contract in. (Real-data execution against staging is recorded in the Final Report, not here.)
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const RUNNER = 'scripts/decision-os-import-sleeper-nonprod.ts'
const DISCOVER = 'scripts/decision-os-imported-leagues-nonprod.ts'
const runnerSrc = read(RUNNER)
const discoverSrc = read(DISCOVER)

describe('ADR-DOS-F0: both scripts gate the database the same way the conformance scripts do', () => {
  it('skip cleanly without DATABASE_URL and refuse the production host', () => {
    for (const [path, src] of [[RUNNER, runnerSrc], [DISCOVER, discoverSrc]] as const) {
      // DB-gated: import the gate helper and short-circuit (SKIPPED) before touching prisma.
      expect(`${path}:hasDatabaseUrl`).toBe(`${path}:${src.includes('hasDatabaseUrl') ? 'hasDatabaseUrl' : 'MISSING'}`)
      expect(`${path}:SKIP`).toBe(`${path}:${/SKIPPED/.test(src) ? 'SKIP' : 'MISSING'}`)
      // Prod hard-refusal, delegated to scripts/db-target-identity.cjs. The literal these scripts
      // used to carry ('ep-spring-tooth') named the dev FORK, not production, so an assertion that
      // the marker was present passed for as long as the guard was pointed at the wrong database.
      expect(`${path}:guard`).toBe(`${path}:${src.includes('assertNonProductionDbTarget') ? 'guard' : 'MISSING'}`)
      expect(`${path}:no-stale-marker`).toBe(`${path}:${src.includes('ep-spring-tooth') ? 'STALE_MARKER' : 'no-stale-marker'}`)
      // The prisma singleton is imported dynamically AFTER the gate (so the skip/refuse path never
      // evaluates it): there must be no top-of-file static `import ... '@/lib/prisma'` / `'../lib/prisma'`.
      expect(`${path}:no-static-prisma`).toBe(
        `${path}:${/^import\s+[^\n]*\bprisma\b[^\n]*from\s+['"][^'"]*lib\/prisma['"]/m.test(src) ? 'STATIC_PRISMA' : 'no-static-prisma'}`,
      )
    }
  })

  // Positive control exercising the REAL guard rather than a local re-implementation of it.
  it('the shipped guard actually refuses the real production database (positive control)', async () => {
    const { isProductionDbTarget } = await import('@/scripts/_db-target-identity')
    expect(isProductionDbTarget('postgresql://u:p@ep-curly-block-ad0dlt9o.c-2.us-east-1.aws.neon.tech/neondb')).toBe(true)
    expect(isProductionDbTarget('postgresql://u:p@ep-muddy-leaf-adigvvph-pooler.c-2.us-east-1.aws.neon.tech/neondb')).toBe(false)
  })
})

describe('ADR-DOS-F0: the runner NEVER writes Canonical World and delegates source writes to the audited services', () => {
  it('imports no Canonical World write surface — only the read resolver', () => {
    // The world module exposes no writer; the runner reads it via resolveCanonicalWorld and nothing else.
    expect(runnerSrc).toContain('resolveCanonicalWorld')
    // It must not import the port directly nor any world internals beyond the index read entrypoint.
    expect(runnerSrc).not.toMatch(/from\s+['"][^'"]*decision-os\/world\/port['"]/)
    expect(runnerSrc).not.toMatch(/from\s+['"][^'"]*decision-os\/world\/(assemble|facts|derive|assets)['"]/)
  })

  it('does NOT itself write League / LeagueTeam / Roster / RedraftRoster — persistence is delegated', () => {
    // The runner orchestrates the SAME services the import route uses; it never hand-writes league data.
    expect(runnerSrc).toContain('persistImportWithCanonicalAudit')
    const directLeagueWrite =
      /prisma\.(league|leagueTeam|roster|redraftRoster|redraftRosterPlayer)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/i
    expect(directLeagueWrite.test(runnerSrc)).toBe(false)
  })

  it('its only direct write is the dedicated non-prod importer AppUser (idempotent upsert)', () => {
    // Whitelist exactly one write: the importer user that owns the ImportRun audit row.
    const writes = runnerSrc.match(/prisma\.[a-zA-Z]+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/g) ?? []
    expect(writes).toEqual(['prisma.appUser.upsert'])
  })
})

describe('ADR-DOS-F0: the discover helper is strictly read-only', () => {
  it('performs zero writes — only findMany + resolveCanonicalWorld', () => {
    expect(discoverSrc).toContain('resolveCanonicalWorld')
    const anyWrite = /prisma\.[a-zA-Z]+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/i
    expect(anyWrite.test(discoverSrc)).toBe(false)
  })

  it('discovers imported leagues by canonical provenance, not by hardcoded provider platform strings', () => {
    // Origin-blind: the filter is `provenance.provider != null`, never `platform === 'sleeper'`.
    expect(discoverSrc).toContain('world.provenance.provider')
    expect(discoverSrc).not.toMatch(/platform\s*===\s*['"]sleeper['"]/)
  })
})

describe('ADR-DOS-F0: discoverability proof (hermetic — no DB)', () => {
  const NOW = new Date('2026-06-29T00:00:00.000Z')

  it('an imported world resolves with a non-null provider + teams + rosters (the runner success shape)', () => {
    const world = assembleCanonicalWorld(makeImportedProviderWorld(), { now: NOW })
    // This is exactly what the runner asserts after seeding: provider non-null ⇒ imported league.
    expect(world.provenance.provider).not.toBeNull()
    expect(world.teams.length).toBeGreaterThan(0)
    expect(world.rosters.length).toBeGreaterThan(0)
  })

  it('a native world is correctly NOT counted as imported (provider null) — the discover filter is honest', () => {
    const world = assembleCanonicalWorld(makeNativeAfWorld(), { now: NOW })
    expect(world.provenance.provider).toBeNull()
  })
})
