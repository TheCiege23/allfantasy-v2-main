/**
 * Positive controls for scripts/verify-node-modules.cjs.
 *
 * 🛑 THE POINT OF THIS FILE IS TO MAKE THE CHECK GO RED ON PURPOSE. A guard that
 * has only ever been observed green is not evidence — it is the most expensive
 * kind of comfort, and this repo has paid for it repeatedly: a `tsc` that OOMed
 * and emitted nothing read as a clean typecheck, a `pgrep` that was not installed
 * exited 127 and read as "the process finished", a `git diff` on an untracked
 * file printed nothing and read as "restored". Each was a check that could not
 * fail. So every assertion in verify-node-modules is exercised here against a
 * deliberately broken fixture tree and required to report the failure.
 *
 * ⚠ AND THE DISCRIMINATION MATTERS AS MUCH AS THE FAILURE. A check that fails on
 * everything is as useless as one that passes on everything — and the second of
 * those is not hypothetical here: the FIRST version of the tree-completeness
 * assertion required every package-lock placement to exist, which can never pass
 * on Windows because 162 of this repo's 1,043 placements are platform-gated. So
 * these tests pin both directions: red on real damage, green on a healthy tree,
 * and green on platform-gated packages that are legitimately absent.
 */

import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyNodeModules, report, ENFORCING, PRISMA_CLIENT_MIN_BYTES } = require('../scripts/verify-node-modules.cjs')

type Check = { ok: boolean; name: string; detail: string }

const byName = (results: Check[], name: string): Check => {
  const found = results.find((r) => r.name === name)
  if (!found) throw new Error(`no assertion named ${name} — found: ${results.map((r) => r.name).join(', ')}`)
  return found
}

/** Same platform logic the check itself uses, so this suite is correct on Linux CI too. */
const BIN_PROBE = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'

const made: string[] = []

/**
 * A tree that satisfies every assertion, so "red" is provably not the only outcome.
 *
 * Deliberately includes a platform-gated lock entry that is ABSENT from disk: on a
 * correct install npm skips those, and the healthy case must stay green with it
 * missing. That single line is what pins the can-never-pass bug shut.
 */
function healthyFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vnm-'))
  made.push(root)
  const nm = path.join(root, 'node_modules')

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'vnm-fixture', version: '1.0.0' }))
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'vnm-fixture' },
        'node_modules/left-pad': { version: '1.3.0' },
        'node_modules/@scope/pkg': { version: '1.0.0' },
        // Present in the lock, absent on disk, and that is CORRECT off-platform.
        'node_modules/@esbuild/darwin-arm64': { version: '0.1.0', os: ['darwin'], cpu: ['arm64'], optional: true },
        'node_modules/fsevents': { version: '2.0.0', os: ['darwin'], optional: true },
        // Bare optional, NO os/cpu — absence is allowed but must be NAMED, not silent.
        'node_modules/@emnapi/core': { version: '1.0.0', optional: true },
        // Nested placement — not a top-level entry, must be ignored entirely.
        'node_modules/left-pad/node_modules/inner': { version: '1.0.0' },
      },
    })
  )

  for (const pkg of ['left-pad', '@scope/pkg']) {
    fs.mkdirSync(path.join(nm, pkg), { recursive: true })
    fs.writeFileSync(path.join(nm, pkg, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0' }))
  }

  // npm's finished-install marker.
  fs.writeFileSync(path.join(nm, '.package-lock.json'), JSON.stringify({ name: 'vnm-fixture', packages: {} }))

  // A generated Prisma client that both EXISTS at size and RESOLVES.
  const generated = path.join(nm, '.prisma', 'client')
  fs.mkdirSync(generated, { recursive: true })
  fs.writeFileSync(path.join(generated, 'index.d.ts'), 'x'.repeat(PRISMA_CLIENT_MIN_BYTES + 1))
  const client = path.join(nm, '@prisma', 'client')
  fs.mkdirSync(client, { recursive: true })
  fs.writeFileSync(path.join(client, 'package.json'), JSON.stringify({ name: '@prisma/client', main: 'index.js' }))
  fs.writeFileSync(path.join(client, 'index.js'), 'exports.PrismaClient = function PrismaClient() {}\n')

  fs.mkdirSync(path.join(nm, '.bin'), { recursive: true })
  fs.writeFileSync(path.join(nm, '.bin', BIN_PROBE), '@echo off\n')

  return root
}

afterAll(() => {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // A leftover temp dir is harmless; failing teardown would mask a real result.
    }
  }
})

describe('verify-node-modules — the check can go GREEN', () => {
  it('passes every assertion on a complete tree', () => {
    expect(verifyNodeModules(healthyFixture()).filter((r: Check) => !r.ok)).toEqual([])
  })

  it('stays green when PLATFORM-GATED packages are absent', () => {
    // 🛑 THE REGRESSION TEST FOR A CHECK THAT COULD NEVER PASS. The first draft
    // required every package-lock placement on disk; 162 of this repo's 1,043 are
    // os/cpu/optional, so it failed on every Windows machine. The healthy fixture
    // has two such entries absent by design — this pins that they are skipped.
    const tree = byName(verifyNodeModules(healthyFixture()), 'tree complete')
    expect(tree.ok).toBe(true)
    expect(tree.detail).not.toContain('fsevents')
    expect(tree.detail).not.toContain('darwin-arm64')
  })

  it('NAMES a bare-optional absence instead of silently skipping it', () => {
    /*
     * ⚠ Skipping every `optional` entry outright is wider than necessary — it would
     * hide real damage to an optional package that IS installed on this platform.
     * A bare optional (no os/cpu) is allowed to be absent, but the pass must say so
     * by name, so a human eyeballs a short list rather than trusting a silent skip.
     */
    const tree = byName(verifyNodeModules(healthyFixture()), 'tree complete')
    expect(tree.ok).toBe(true)
    expect(tree.detail).toContain('@emnapi/core')
    expect(tree.detail).toContain('optional absent')
  })
})

describe('verify-node-modules — the check can go RED (positive controls)', () => {
  it('reports an unfinished install via the .package-lock.json marker', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '.package-lock.json'), { force: true })

    const r = byName(verifyNodeModules(root), 'install finished')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('did not complete')
  })

  it('reports a missing REQUIRED package BY NAME', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '@scope', 'pkg'), { recursive: true, force: true })

    const r = byName(verifyNodeModules(root), 'tree complete')
    expect(r.ok).toBe(false)
    // The name, not just a count — a count cannot be acted on.
    expect(r.detail).toContain('@scope/pkg')
  })

  it('catches a TRANSITIVE package that npm ls --depth=0 is structurally blind to', () => {
    /*
     * 🛑 THIS IS THE ASSERTION THAT REPLACED `npm ls --depth=0`. left-pad is in the
     * lock but NOT in the fixture's package.json dependencies, so it is transitive.
     * npm ls --depth=0 inspects declared direct deps only and reports such a tree
     * as healthy — measured on 2026-09-03, it reported 8 missing on a tree missing
     * far more, and would have passed it.
     */
    const root = healthyFixture()
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toBeUndefined() // left-pad is genuinely not declared
    fs.rmSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true, force: true })

    const r = byName(verifyNodeModules(root), 'tree complete')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('left-pad')
  })

  it('reports a missing prisma client, and says how to fix it', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '.prisma'), { recursive: true, force: true })

    const r = byName(verifyNodeModules(root), 'prisma client')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('index.d.ts is missing')
    // A guard that reports a problem without the remedy just relocates the debugging.
    expect(r.detail).toContain('prisma/build/index.js generate')
  })

  it('reports a TRUNCATED prisma client, the case a plain existence check misses', () => {
    const root = healthyFixture()
    // An interrupted generate leaves the file present but tiny. existsSync alone
    // calls this healthy: present is not the same as usable.
    fs.writeFileSync(path.join(root, 'node_modules', '.prisma', 'client', 'index.d.ts'), '// interrupted\n')

    const r = byName(verifyNodeModules(root), 'prisma client')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('bytes')
  })

  it('reports a prisma client that exists on disk but does not RESOLVE', () => {
    const root = healthyFixture()
    // The generated .d.ts stays intact — only the importable module is broken, so
    // this can only be caught by the resolve assertion, not the file one.
    fs.rmSync(path.join(root, 'node_modules', '@prisma'), { recursive: true, force: true })

    const results: Check[] = verifyNodeModules(root)
    expect(byName(results, 'prisma resolves').ok).toBe(false)
    expect(byName(results, 'prisma client').ok).toBe(true)
  })

  it('reports missing .bin shims by NAMED binary, not by entry count', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '.bin'), { recursive: true, force: true })

    const r = byName(verifyNodeModules(root), '.bin shims')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain(BIN_PROBE)
  })

  it('reports an EMPTY .bin as broken — the count-based read that already went wrong', () => {
    const root = healthyFixture()
    // .bin exists but holds nothing. On 2026-09-02 a count-based probe reported
    // this state as "1 entry" (the count included the lister's own error line) and
    // it read as healthy. An existence check on a named binary cannot do that.
    fs.rmSync(path.join(root, 'node_modules', '.bin', BIN_PROBE), { force: true })

    expect(byName(verifyNodeModules(root), '.bin shims').ok).toBe(false)
  })
})

describe('verify-node-modules — assertions are independent', () => {
  it('leaves other assertions GREEN while prisma is RED', () => {
    // ⚠ A check that fails on everything is as useless as one that passes on
    // everything. One assertion red, the rest green, same run, same tree.
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '.prisma'), { recursive: true, force: true })

    const results: Check[] = verifyNodeModules(root)
    expect(byName(results, 'prisma client').ok).toBe(false)
    expect(byName(results, 'tree complete').ok).toBe(true)
    expect(byName(results, 'install finished').ok).toBe(true)
    expect(byName(results, '.bin shims').ok).toBe(true)
  })
})

describe('verify-node-modules — an unrunnable check never reports a pass', () => {
  it('reports NOT CHECKED when package-lock.json is absent', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'package-lock.json'), { force: true })

    const r = byName(verifyNodeModules(root), 'tree complete')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('NOT CHECKED')
  })

  it('reports NOT CHECKED when package-lock.json is unparseable', () => {
    const root = healthyFixture()
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{ this is not json')

    const r = byName(verifyNodeModules(root), 'tree complete')
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('NOT CHECKED')
  })
})

describe('verify-node-modules — staged rollout', () => {
  it('report() returns 0 on a healthy tree', () => {
    expect(report(verifyNodeModules(healthyFixture()))).toBe(0)
  })

  it('report() honours ENFORCING for a broken tree', () => {
    const root = healthyFixture()
    fs.rmSync(path.join(root, 'node_modules', '.prisma'), { recursive: true, force: true })
    // Derived from the exported constant, so this stays correct on both sides of
    // the rollout flip rather than needing an edit.
    expect(report(verifyNodeModules(root))).toBe(ENFORCING ? 1 : 0)
  })

  it('is still REPORT-ONLY — this assertion is the tripwire for the flip', () => {
    /*
     * 🛑 WHEN THIS FAILS, SOMEONE FLIPPED ENFORCING, AND THAT IS A DEPLOY-AFFECTING
     * CHANGE, NOT A TEST TO UPDATE IN PASSING. Flipping it means prebuild can fail a
     * production build. Before changing this line, confirm the check has run green
     * through several real Railway builds — it had ZERO Railway runtime history as
     * of 2026-09-03.
     */
    expect(ENFORCING).toBe(false)
  })
})
