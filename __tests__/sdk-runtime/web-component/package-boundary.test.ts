import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Decision OS — Phase 7.27 @allfantasy/widget-web-component package verification.
 *
 * `__tests__/sdk-runtime/web-component/import-boundary.test.ts` (Phase 7.16)
 * already comprehensively covers SOURCE-level import boundaries — this file
 * does NOT duplicate that. It covers what is genuinely NEW in this ticket:
 * the package.json artifact (React as a REAL dependency, not a peer — the
 * OPPOSITE strategy from widget-react/widget-iframe, per
 * PHASE_7_22_SDK_PACKAGING_ADR.md D6), the single-entry-point build config,
 * and the BUILT `dist/` output — mirroring the same checks Phase
 * 7.23/7.24/7.25/7.26 already established for the four sibling packages.
 */

const PACKAGE_ROOT = resolve(process.cwd(), 'sdk-runtime/web-component')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')
const DIST_INDEX_DTS = join(DIST_DIR, 'sdk-runtime/web-component/src/index.d.ts')

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

describe('@allfantasy/widget-web-component — package.json', () => {
  it('is private:true — the technical guardrail against accidental npm publish', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.private).toBe(true)
  })

  it('declares sideEffects:false — customElements.define is caller-invoked, never a module-load effect', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.sideEffects).toBe(false)
  })

  it('has exactly one entry point (unlike widget-iframe\'s four subpaths)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(Object.keys(pkg.exports).sort()).toEqual(['.', './package.json'])
  })

  it('declares react and react-dom as REAL dependencies, not peers — the OPPOSITE strategy from widget-react/widget-iframe (ADR D6)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.dependencies?.react).toBeDefined()
    expect(pkg.dependencies?.['react-dom']).toBeDefined()
    expect(pkg.peerDependencies ?? {}).toEqual({})
  })

  it('the react/react-dom dependency versions match the root app\'s installed version', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const rootPkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.dependencies.react).toBe(rootPkg.dependencies.react)
    expect(pkg.dependencies['react-dom']).toBe(rootPkg.dependencies['react-dom'])
  })

  it('has no dependency on any other embed-adapter package (widget-iframe, widget-js)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    expect(allDeps['@allfantasy/widget-iframe']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-js']).toBeUndefined()
  })

  it('the package name matches the ticket-requested @allfantasy/widget-web-component', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@allfantasy/widget-web-component')
  })
})

describe('@allfantasy/widget-web-component — build config', () => {
  it('tsconfig.build.json is a NEW file — the pre-existing tsconfig.json (Phase 7.16) is untouched', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'tsconfig.build.json'))).toBe(true)
    const existing = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.json'), 'utf8'))
    expect(existing.compilerOptions.noEmit).toBe(true)
    expect(existing.compilerOptions.jsx).toBe('react-jsx')
  })

  it('tsconfig.build.json agrees with the existing config on jsx/lib and adds declaration-only emission', () => {
    const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.build.json'), 'utf8'))
    expect(config.compilerOptions.jsx).toBe('react-jsx')
    expect(config.compilerOptions.lib).toEqual(expect.arrayContaining(['DOM']))
    expect(config.compilerOptions.emitDeclarationOnly).toBe(true)
  })
})

// ── Build-output verification ─────────────────────────────────────────────────
// Requires `npm run build` (tsc, declaration-only) to have run first inside
// sdk-runtime/web-component/ — SKIPS (not fails) if dist/ does not exist yet.

const distExists = existsSync(DIST_DIR)

describe.skipIf(!distExists)('@allfantasy/widget-web-component — build output (dist/)', () => {
  it('dist/.../index.d.ts exists (the public entry point actually built)', () => {
    expect(existsSync(DIST_INDEX_DTS)).toBe(true)
  })

  it('is a type-only build — zero .js files anywhere in dist/ (emitDeclarationOnly)', () => {
    const files = walkFiles(DIST_DIR)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    expect(jsFiles).toEqual([])
  })

  it('dist/.../index.d.ts includes a spot-check of expected exports', () => {
    const content = readFileSync(DIST_INDEX_DTS, 'utf8')
    for (const expected of [
      'AllFantasyWidgetElement',
      'defineAllFantasyWidgetElement',
      'DEFAULT_TAG_NAME',
      'parseElementAttributes',
      'buildWidgetConfigFromAttributes',
      'attachShadowMountRoot',
      'setElementCredentials',
      'defaultFetchImpl',
    ]) {
      expect(`index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('never references an iframe-adapter or js-embed–specific concept anywhere in the built .d.ts tree', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const forbiddenTerms = [
      'IframeEmbedConfig',
      'IFRAME_PROTOCOL_VERSION',
      'createAllFantasyWidget', // js-embed's exact factory name (no suffix) — this package has no colliding export, plain substring check is safe here
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

  it('known limitation (matches Phase 7.23-7.26): the transitive closure still mirrors lib/decision-os/behavioral/api/contracts.d.ts, sdk-runtime/core, and sdk-runtime/react into dist/ — content-safety re-confirmed here', () => {
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

    // This package composes sdk-runtime/core and sdk-runtime/react via real relative
    // paths (not package references) — same "not yet a real bundled dependency" gap
    // Phase 7.24/7.25/7.26 documented from the other sides.
    const coreFile = files.find((f) => f.includes(join('sdk-runtime', 'core', 'src', 'index.d.ts')))
    const reactFile = files.find((f) => f.includes(join('sdk-runtime', 'react', 'src', 'index.d.ts')))
    expect(coreFile).toBeDefined()
    expect(reactFile).toBeDefined()
  })
})
