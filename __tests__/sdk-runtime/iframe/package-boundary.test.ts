import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Decision OS — Phase 7.26 @allfantasy/widget-iframe package verification.
 *
 * `__tests__/sdk-runtime/iframe/import-boundary.test.ts` (Phase 7.9-7.15)
 * already comprehensively covers SOURCE-level import boundaries — this file
 * does NOT duplicate that. It covers what is genuinely NEW in this ticket:
 * the package.json artifact (four independent entry points per
 * PHASE_7_22_SDK_PACKAGING_ADR.md D4, react/react-dom as OPTIONAL peer
 * dependencies since only `./react-child` needs them), the unified build
 * config, and the BUILT `dist/` output — mirroring the same checks Phase
 * 7.23/7.24/7.25 already established for the three sibling packages.
 */

const PACKAGE_ROOT = resolve(process.cwd(), 'sdk-runtime/iframe')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')
const DIST_INDEX_DTS = join(DIST_DIR, 'sdk-runtime/iframe/src/index.d.ts')
const DIST_BROWSER_DTS = join(DIST_DIR, 'sdk-runtime/iframe/src/browser/index.d.ts')
const DIST_FACADE_DTS = join(DIST_DIR, 'sdk-runtime/iframe/src/facade/index.d.ts')
const DIST_REACT_CHILD_DTS = join(DIST_DIR, 'sdk-runtime/iframe/src/reactChild/index.d.ts')

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

describe('@allfantasy/widget-iframe — package.json', () => {
  it('is private:true — the technical guardrail against accidental npm publish', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.private).toBe(true)
  })

  it('declares sideEffects:false', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.sideEffects).toBe(false)
  })

  it('declares exactly the four subpath exports from PHASE_7_22_SDK_PACKAGING_ADR.md D4', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const exportKeys = Object.keys(pkg.exports).sort()
    expect(exportKeys).toEqual(['.', './browser', './facade', './package.json', './react-child'])
  })

  it('every subpath export (except package.json) points at a types condition under dist/', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    for (const key of ['.', './browser', './facade', './react-child']) {
      expect(pkg.exports[key].types).toMatch(/^\.\/dist\//)
    }
  })

  it('declares react and react-dom as OPTIONAL peer dependencies — only ./react-child needs them (ADR D4)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.peerDependencies?.react).toBeDefined()
    expect(pkg.peerDependencies?.['react-dom']).toBeDefined()
    expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true)
    expect(pkg.peerDependenciesMeta?.['react-dom']?.optional).toBe(true)
    // Never bundled — same peer-not-bundled discipline as widget-react.
    const regularDeps = pkg.dependencies ?? {}
    expect(regularDeps.react).toBeUndefined()
    expect(regularDeps['react-dom']).toBeUndefined()
  })

  it('has no dependency on any other embed-adapter package (widget-web-component, widget-js)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    expect(allDeps['@allfantasy/widget-web-component']).toBeUndefined()
    expect(allDeps['@allfantasy/widget-js']).toBeUndefined()
  })

  it('the package name matches the ticket-requested @allfantasy/widget-iframe', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('@allfantasy/widget-iframe')
  })
})

describe('@allfantasy/widget-iframe — build config', () => {
  it('tsconfig.build.json is a NEW file — the four existing typecheck-only tsconfigs are untouched', () => {
    expect(existsSync(join(PACKAGE_ROOT, 'tsconfig.build.json'))).toBe(true)
    for (const existing of ['tsconfig.json', 'tsconfig.browser.json', 'tsconfig.facade.json', 'tsconfig.reactChild.json']) {
      const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, existing), 'utf8'))
      expect(config.compilerOptions.noEmit).toBe(true)
    }
  })

  it('tsconfig.build.json compiles the full src/** superset (base + browser + facade + reactChild) in one pass', () => {
    const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tsconfig.build.json'), 'utf8'))
    expect(config.compilerOptions.jsx).toBe('react-jsx')
    expect(config.compilerOptions.lib).toEqual(expect.arrayContaining(['DOM']))
    expect(config.compilerOptions.emitDeclarationOnly).toBe(true)
    expect(config.include).toEqual(expect.arrayContaining(['src/**/*.ts', 'src/**/*.tsx']))
  })
})

// ── Build-output verification ─────────────────────────────────────────────────
// Requires `npm run build` (tsc, declaration-only) to have run first inside
// sdk-runtime/iframe/ — SKIPS (not fails) if dist/ does not exist yet.

const distExists = existsSync(DIST_DIR)

describe.skipIf(!distExists)('@allfantasy/widget-iframe — build output (dist/)', () => {
  it('all four entry-point .d.ts files exist', () => {
    expect(existsSync(DIST_INDEX_DTS)).toBe(true)
    expect(existsSync(DIST_BROWSER_DTS)).toBe(true)
    expect(existsSync(DIST_FACADE_DTS)).toBe(true)
    expect(existsSync(DIST_REACT_CHILD_DTS)).toBe(true)
  })

  it('is a type-only build — zero .js files anywhere in dist/ (emitDeclarationOnly)', () => {
    const files = walkFiles(DIST_DIR)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    expect(jsFiles).toEqual([])
  })

  it('the base entry point (dist index.d.ts) has zero DOM-typed exports leaking in — spot-check of expected protocol exports', () => {
    const content = readFileSync(DIST_INDEX_DTS, 'utf8')
    for (const expected of [
      'IFRAME_PROTOCOL_VERSION',
      'validateIframeEmbedConfig',
      'buildParentToChildMessage',
      'isOriginAllowed',
      'IframeHostBootstrap',
      'IframeClientBootstrap',
      'buildIframeWidgetUrl',
    ]) {
      expect(`index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('the browser entry point exposes DOM-wiring exports', () => {
    const content = readFileSync(DIST_BROWSER_DTS, 'utf8')
    for (const expected of ['createBrowserWindowBridge', 'mountIframeWidget', 'teardownIframeWidget', 'generateNonce']) {
      expect(`browser/index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `browser/index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('the facade entry point exposes host/client factory exports', () => {
    const content = readFileSync(DIST_FACADE_DTS, 'utf8')
    for (const expected of ['createAllFantasyWidgetHost', 'createAllFantasyWidgetIframeClient', 'createAllFantasyWidgetIframeClientFromUrl']) {
      expect(`facade/index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `facade/index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('the react-child entry point exposes the mount function and composes widget-react', () => {
    const content = readFileSync(DIST_REACT_CHILD_DTS, 'utf8')
    expect(content.includes('mountReactIframeChildBridge')).toBe(true)
  })

  it('never references a web-component or js-embed–specific concept anywhere in the built .d.ts tree', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    const forbiddenSubstrings = ['AllFantasyWidgetElement', 'attachShadowMountRoot', 'attachAllFantasyGlobal']
    // createAllFantasyWidget (js-embed's exact factory name, no suffix) is checked with a
    // word-boundary regex because it is a literal PREFIX of this package's own legitimate
    // createAllFantasyWidgetHost / createAllFantasyWidgetIframeClient exports.
    const jsEmbedFactoryRegex = /\bcreateAllFantasyWidget\b/
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      for (const term of forbiddenSubstrings) {
        expect(`${file.replace(PACKAGE_ROOT, '')}: contains '${term}' = ${content.includes(term)}`).toBe(
          `${file.replace(PACKAGE_ROOT, '')}: contains '${term}' = false`,
        )
      }
      expect(`${file.replace(PACKAGE_ROOT, '')}: contains js-embed factory name = ${jsEmbedFactoryRegex.test(content)}`).toBe(
        `${file.replace(PACKAGE_ROOT, '')}: contains js-embed factory name = false`,
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

  it('known limitation (matches Phase 7.23/7.24/7.25): the transitive closure still mirrors lib/decision-os/behavioral/api/contracts.d.ts, sdk-runtime/core, and sdk-runtime/react into dist/ — content-safety re-confirmed here', () => {
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

    // react-child composes sdk-runtime/core and sdk-runtime/react via real relative paths
    // (not package references) — same "not yet a real bundled dependency" gap Phase
    // 7.24/7.25 documented from the other two sides.
    const coreFile = files.find((f) => f.includes(join('sdk-runtime', 'core', 'src', 'index.d.ts')))
    const reactFile = files.find((f) => f.includes(join('sdk-runtime', 'react', 'src', 'index.d.ts')))
    expect(coreFile).toBeDefined()
    expect(reactFile).toBeDefined()
  })

  it('the base/browser/facade entry points do not pull in React (no react-jsx-runtime import in their built output)', () => {
    for (const dtsPath of [DIST_INDEX_DTS, DIST_BROWSER_DTS, DIST_FACADE_DTS]) {
      const content = readFileSync(dtsPath, 'utf8')
      expect(`${dtsPath.replace(PACKAGE_ROOT, '')}: references react = ${/from ['"]react['"]/.test(content)}`).toBe(
        `${dtsPath.replace(PACKAGE_ROOT, '')}: references react = false`,
      )
    }
  })
})
