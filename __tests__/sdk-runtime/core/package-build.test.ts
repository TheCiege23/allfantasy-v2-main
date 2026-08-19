import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Decision OS — Phase 7.24 @allfantasy/widget-core package verification.
 *
 * `__tests__/sdk-runtime/core/import-boundary.test.ts` (Phase 7.6/7.7)
 * already comprehensively covers SOURCE-level import boundaries (no React,
 * no DOM, no behavioral/world/Prisma, no bare fetch/timers, no writes, no
 * soak flags) — this file does NOT duplicate that. It covers what is
 * genuinely NEW in this ticket: the package.json artifact itself, and the
 * BUILT `dist/` output, mirroring the same checks
 * `__tests__/sdk-runtime/sdk-contracts/import-boundary.test.ts` (Phase
 * 7.23) already established for the sibling package.
 */

const PACKAGE_ROOT = resolve(process.cwd(), 'sdk-runtime/core')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')
const DIST_INDEX_DTS = join(DIST_DIR, 'sdk-runtime/core/src/index.d.ts')

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}

describe('@allfantasy/widget-core — package.json', () => {
  it('is private:true — the technical guardrail against accidental npm publish', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.private).toBe(true)
  })

  it('declares sideEffects:false (every module is genuinely side-effect-free at import time)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.sideEffects).toBe(false)
  })

  it('has no runtime dependency on React, DOM libraries, or any other embed adapter package', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }
    expect(allDeps.react).toBeUndefined()
    expect(allDeps['react-dom']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-react']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-iframe']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-web-component']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-js']).toBeUndefined()
  })

  it('the package name matches the ticket-requested @allfantasy/widget-core', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@allfantasy/widget-core')
  })
})

// ── Build-output verification ─────────────────────────────────────────────────
// Requires `npm run build` (tsc, declaration-only) to have run first inside
// sdk-runtime/core/ — SKIPS (not fails) if dist/ does not exist yet, so
// `vitest run` alone never reports a false failure.

const distExists = existsSync(DIST_DIR)

describe.skipIf(!distExists)('@allfantasy/widget-core — build output (dist/)', () => {
  it('dist/.../index.d.ts exists (the public entry point actually built)', () => {
    expect(existsSync(DIST_INDEX_DTS)).toBe(true)
  })

  it('is a type-only build — zero .js files anywhere in dist/ (emitDeclarationOnly)', () => {
    const files = walkFiles(DIST_DIR)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    expect(jsFiles).toEqual([])
  })

  it('dist/.../index.d.ts (the actual public surface) includes a spot-check of expected exports', () => {
    const content = readFileSync(DIST_INDEX_DTS, 'utf8')
    for (const expected of [
      'RuntimeFetch',
      'RuntimeClock',
      'HttpClientConfig',
      'buildQueryString',
      'fetchPresentation',
      'authPreCheck',
      'LifecycleController',
      'InvalidLifecycleTransitionError',
      'classifyHttpStatus',
      'mapHttpFailureToSDKError',
      'RefreshEngine',
      'computeBackoffDelayMs',
    ]) {
      expect(`dist index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `dist index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('never references React, DOM types, or any embed-adapter concept anywhere in the built .d.ts tree', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      expect(`${file.replace(PACKAGE_ROOT, '')}: React reference = ${/\bReact\b/.test(content)}`).toBe(
        `${file.replace(PACKAGE_ROOT, '')}: React reference = false`,
      )
      expect(`${file.replace(PACKAGE_ROOT, '')}: HTMLElement reference = ${/\bHTMLElement\b/.test(content)}`).toBe(
        `${file.replace(PACKAGE_ROOT, '')}: HTMLElement reference = false`,
      )
      expect(`${file.replace(PACKAGE_ROOT, '')}: postMessage reference = ${/postMessage/.test(content)}`).toBe(
        `${file.replace(PACKAGE_ROOT, '')}: postMessage reference = false`,
      )
    }
  })

  it('no compiled output anywhere in dist/ references Prisma or a database client (excluding doc comments)', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      expect(`${file.replace(PACKAGE_ROOT, '')}: prisma reference = ${/prisma/i.test(content)}`).toBe(
        `${file.replace(PACKAGE_ROOT, '')}: prisma reference = false`,
      )
    }
  })

  it('no compiled output anywhere in dist/ contains a secret-shaped field name or a real-looking credential', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const secretShapedNames = ['rawSecret', 'rawKey', 'privateKey', 'clientSecret']
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const name of secretShapedNames) {
        expect(`${file.replace(PACKAGE_ROOT, '')}: contains '${name}' = ${content.includes(name)}`).toBe(
          `${file.replace(PACKAGE_ROOT, '')}: contains '${name}' = false`,
        )
      }
      expect(/afk_(live|test)_[A-Za-z0-9]{16,}/.test(content)).toBe(false)
    }
  })

  it('known limitation (matches Phase 7.23): the transitive closure still mirrors lib/decision-os/behavioral/api/contracts.d.ts into dist/ — content-safety re-confirmed here, not just assumed', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const behavioralFile = files.find((f) => f.includes(join('lib', 'decision-os', 'behavioral')))
    if (!behavioralFile) return // acceptable if a future bundler has already eliminated this
    const rawContent = readFileSync(behavioralFile, 'utf8')
    // The Phase 5.5 file's own header guarantees this — re-verified structurally, not just trusted.
    expect(rawContent).toContain('EXTERNAL types for the hosted Intelligence API')
    // Strip comments first: the file's OWN doc comments legitimately name
    // `warnings[]`/`derivedFrom`/`lookbackDays`/`provenance` to EXPLAIN they
    // were excluded (e.g. "Fields excluded ... `warnings[]` (internal
    // implementation notes)") — that documentation text would false-positive
    // a naive whole-file substring check. What actually matters is that none
    // of these appear as a real FIELD DECLARATION in the compiled code.
    const code = stripComments(rawContent)
    expect(code).not.toMatch(/\bwarnings\s*:/)
    expect(code).not.toMatch(/\bderivedFrom\s*:/)
    expect(code).not.toMatch(/\blookbackDays\s*:/)
    expect(code).not.toMatch(/\bprovenance\s*:/)
  })
})
