import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage } from '../../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/iframe/src/browser`.
 *
 * Unlike the top-level iframe files (Phase 7.9/7.10, which must NEVER
 * reference window/document), this layer's entire purpose is bridging to
 * real browser globals — so DOM references are expected and allowed here.
 * What must still hold:
 *   - allowed imports: local modules, sibling files ONE level up (the
 *     Phase 7.9/7.10 contract/bootstrap layer), lib/decision-os/sdk,
 *     lib/decision-os/presentation
 *   - forbidden: lib/decision-os/behavioral/*, lib/decision-os/world/*,
 *     Prisma, sdk-runtime/react
 *   - no internal Decision OS terminology outside of import paths
 *   - no database write operations
 *   - the top-level Phase 7.9/7.10 files remain UNCHANGED — still zero
 *     window/document references, proving the isolation actually held
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const BROWSER_FILES = [
  'sdk-runtime/iframe/src/browser/windowBridge.ts',
  'sdk-runtime/iframe/src/browser/iframeElementAdapter.ts',
  'sdk-runtime/iframe/src/browser/nonce.ts',
  'sdk-runtime/iframe/src/browser/mount.ts',
  'sdk-runtime/iframe/src/browser/teardown.ts',
  'sdk-runtime/iframe/src/browser/index.ts',
].map((p) => [p, read(p)] as const)

const TOP_LEVEL_IFRAME_FILES = [
  'sdk-runtime/iframe/src/types.ts',
  'sdk-runtime/iframe/src/origin.ts',
  'sdk-runtime/iframe/src/security.ts',
  'sdk-runtime/iframe/src/lifecycleMapping.ts',
  'sdk-runtime/iframe/src/protocol.ts',
  'sdk-runtime/iframe/src/config.ts',
  'sdk-runtime/iframe/src/windowLike.ts',
  'sdk-runtime/iframe/src/postMessageSafety.ts',
  'sdk-runtime/iframe/src/messageListener.ts',
  'sdk-runtime/iframe/src/iframeHost.ts',
  'sdk-runtime/iframe/src/iframeClient.ts',
  'sdk-runtime/iframe/src/index.ts',
].map((p) => [p, read(p)] as const)

const IMPORT_SPECIFIER_RE = /import\s+(?:type\s+)?(?:[\s\S]*?)from\s+['"]([^'"]+)['"]/g

function extractImportSpecifiers(src: string): string[] {
  const specifiers: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(IMPORT_SPECIFIER_RE)
  while ((match = re.exec(src)) !== null) {
    specifiers.push(match[1])
  }
  return specifiers
}

function isAllowedSpecifier(specifier: string): boolean {
  if (specifier.startsWith('./')) return true
  if (specifier.startsWith('../') && !specifier.startsWith('../../')) return true // one level up: the 7.9/7.10 layer
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/iframe/browser import boundary', () => {
  it('every import specifier is local, one level up (the 7.9/7.10 layer), or the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of BROWSER_FILES) {
      const specifiers = extractImportSpecifiers(src)
      for (const specifier of specifiers) {
        expect(`${path}: ${specifier} → allowed:${isAllowedSpecifier(specifier)}`).toBe(
          `${path}: ${specifier} → allowed:true`,
        )
      }
    }
  })

  it('the allowlist guard actually catches a disallowed import (positive control)', () => {
    const offendingBehavioral = "import { checkIntelligenceGate } from '../../../../lib/decision-os/behavioral/api/gate'"
    const offendingWorld = "import { resolveCanonicalWorld } from '../../../../lib/decision-os/world'"
    const offendingPrisma = "import { prisma } from '@/lib/prisma'"
    const offendingReactAdapter = "import { useAllFantasyWidget } from '../../../react/src/useAllFantasyWidget'"
    const allowedLocal = "import { createBrowserWindowBridge } from './windowBridge'"
    const allowedParentLayer = "import { IframeHostBootstrap } from '../iframeHost'"
    const allowedSdk = "import { buildSDKError } from '../../../lib/decision-os/sdk/errors'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingReactAdapter)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedParentLayer)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
  })

  it('no file imports sdk-runtime/react (adapters never depend on other adapters)', () => {
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: react-adapter import present = ${/sdk-runtime\/react|\.\.\/\.\.\/\.\.\/react/.test(src)}`).toBe(
        `${path}: react-adapter import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of BROWSER_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })
})

describe('architecture: browser DOM access IS expected here (contrast with the top-level layer)', () => {
  it('at least one browser file references window/document/HTMLIFrameElement — this layer exists to do exactly that', () => {
    const anyDomReference = BROWSER_FILES.some(
      ([, src]) => /\bwindow\b/.test(src) || /\bdocument\b/.test(src) || /HTMLIFrameElement/.test(src) || /\bcrypto\b/.test(src),
    )
    expect(anyDomReference).toBe(true)
  })
})

describe('architecture: the top-level Phase 7.9/7.10 layer is UNCHANGED — isolation actually held', () => {
  it('no top-level iframe file references window or document globals', () => {
    for (const [path, src] of TOP_LEVEL_IFRAME_FILES) {
      expect(`${path}: window reference = ${/\bwindow\./.test(src)}`).toBe(`${path}: window reference = false`)
      expect(`${path}: document reference = ${/\bdocument\./.test(src)}`).toBe(`${path}: document reference = false`)
    }
  })

  it('no top-level iframe file imports from ./browser', () => {
    for (const [path, src] of TOP_LEVEL_IFRAME_FILES) {
      expect(`${path}: browser import present = ${/from\s+['"]\.\/browser/.test(src)}`).toBe(
        `${path}: browser import present = false`,
      )
    }
  })

  it('the main package index.ts does not re-export anything from ./browser', () => {
    const [, indexSrc] = TOP_LEVEL_IFRAME_FILES.find(([p]) => p.endsWith('/src/index.ts'))!
    expect(indexSrc).not.toMatch(/from\s+['"]\.\/browser/)
  })
})

describe('architecture: sdk-runtime/iframe/browser contains no internal Decision OS terminology', () => {
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const BROWSER_FILES_NO_IMPORTS = BROWSER_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths', () => {
    for (const [path, src] of BROWSER_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This bridge exposes Decision OS internals')).toBe(true)
  })
})
