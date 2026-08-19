import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Decision OS — Phase 7.25 @allfantasy/widget-react package verification.
 *
 * `__tests__/sdk-runtime/react/import-boundary.test.ts` (Phase 7.8)
 * already comprehensively covers SOURCE-level import boundaries (only
 * react/local/sdk-runtime-core/frozen-sdk-presentation imports, no
 * behavioral/world/Prisma, no local intelligence derivation, no internal
 * terminology leakage) — this file does NOT duplicate that. It covers
 * what is genuinely NEW in this ticket: the package.json artifact
 * (React as a PEER dependency, per PHASE_7_22_SDK_PACKAGING_ADR.md D6 —
 * the opposite bundling strategy from web-component/js-embed), the
 * JSX-aware build config, and the BUILT `dist/` output — mirroring the
 * same checks Phase 7.23/7.24 already established for the two sibling
 * packages.
 */

const PACKAGE_ROOT = resolve(process.cwd(), 'sdk-runtime/react')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')
const DIST_INDEX_DTS = join(DIST_DIR, 'sdk-runtime/react/src/index.d.ts')

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

describe('@allfantasy/widget-react — package.json', () => {
  it('is private:true — the technical guardrail against accidental npm publish', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.private).toBe(true)
  })

  it('declares sideEffects:false', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.sideEffects).toBe(false)
  })

  it('declares react and react-dom as PEER dependencies, never bundled (ADR D6 — opposite of widget-web-component/widget-js)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.peerDependencies?.react).toBeDefined()
    expect(pkg.peerDependencies?.['react-dom']).toBeDefined()
    // Never a regular (bundled) dependency — this is the whole point of
    // peer-dependency status: exactly one React instance in the consumer's tree.
    const regularDeps = pkg.dependencies ?? {}
    expect(regularDeps.react).toBeUndefined()
    expect(regularDeps['react-dom']).toBeUndefined()
  })

  it('the peer range matches the currently installed React major (18.x)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.peerDependencies.react).toMatch(/\^18\./)
    expect(pkg.peerDependencies['react-dom']).toMatch(/\^18\./)
  })

  it('has no dependency on any embed-adapter package (widget-iframe, widget-web-component, widget-js)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    expect(allDeps['@allfantasy/widget-iframe']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-web-component']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-js']).toBeUndefined()
  })

  it('the package name matches the ticket-requested @allfantasy/widget-react', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@allfantasy/widget-react')
  })
})

describe('@allfantasy/widget-react — JSX-aware build config', () => {
  it('tsconfig.build.json enables jsx: react-jsx (distinct from the pre-existing no-DOM sibling packages)', () => {
    const tsconfig = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.build.json'), 'utf8'))
    expect(tsconfig.compilerOptions.jsx).toBe('react-jsx')
  })

  it('tsconfig.build.json includes DOM libs (unlike widget-core, which deliberately has none)', () => {
    const tsconfig = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.build.json'), 'utf8'))
    expect(tsconfig.compilerOptions.lib).toEqual(expect.arrayContaining(['DOM']))
  })

  it('the pre-existing tsconfig.json (typecheck-only, Phase 7.8) is unchanged and still agrees on jsx/lib', () => {
    const existing = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.json'), 'utf8'))
    expect(existing.compilerOptions.jsx).toBe('react-jsx')
    expect(existing.compilerOptions.noEmit).toBe(true)
  })
})

// ── Build-output verification ─────────────────────────────────────────────────
// Requires `npm run build` (tsc, declaration-only) to have run first inside
// sdk-runtime/react/ — SKIPS (not fails) if dist/ does not exist yet.

const distExists = existsSync(DIST_DIR)

describe.skipIf(!distExists)('@allfantasy/widget-react — build output (dist/)', () => {
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
      'useAllFantasyWidget',
      'WidgetRenderBoundary',
      'AllFantasyWidget',
      'resolveThemedColorTokenHex',
      'resolveWidgetChromeHex',
      'mapLifecycleToRenderState',
      'extractHeadline',
    ]) {
      expect(`dist index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `dist index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('never references an iframe-adapter, web-component, or js-embed concept anywhere in the built .d.ts tree', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const forbiddenTerms = [
      'IframeEmbedConfig',
      'postMessage',
      'AllFantasyWidgetElement',
      'attachShadowMountRoot',
      'createAllFantasyWidget',
      'attachAllFantasyGlobal',
    ]
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      for (const term of forbiddenTerms) {
        expect(`${file.replace(PACKAGE_ROOT, '')}: contains '${term}' = ${content.includes(term)}`).toBe(
          `${file.replace(PACKAGE_ROOT, '')}: contains '${term}' = false`,
        )
      }
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

  it('known limitation (matches Phase 7.23/7.24): the transitive closure still mirrors lib/decision-os/behavioral/api/contracts.d.ts and sdk-runtime/core into dist/ — content-safety re-confirmed here', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const behavioralFile = files.find((f) => f.includes(join('lib', 'decision-os', 'behavioral')))
    if (!behavioralFile) return // acceptable if a future bundler has already eliminated this
    const rawContent = readFileSync(behavioralFile, 'utf8')
    expect(rawContent).toContain('EXTERNAL types for the hosted Intelligence API')
    const code = stripComments(rawContent)
    expect(code).not.toMatch(/\bwarnings\s*:/)
    expect(code).not.toMatch(/\bderivedFrom\s*:/)
    expect(code).not.toMatch(/\blookbackDays\s*:/)
    expect(code).not.toMatch(/\bprovenance\s*:/)

    // sdk-runtime/core mirrors in too (useAllFantasyWidget.ts imports
    // LifecycleController/RefreshEngine via a real relative path) — same
    // "not yet a real bundled dependency" gap Phase 7.24 documented from
    // the other side.
    const coreFile = files.find((f) => f.includes(join('sdk-runtime', 'core', 'src', 'index.d.ts')))
    expect(coreFile).toBeDefined()
  })
})
