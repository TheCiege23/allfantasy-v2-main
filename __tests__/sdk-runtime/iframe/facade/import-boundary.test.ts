import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage } from '../../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/iframe/src/facade`.
 *
 * Covers both the host facade (Phase 7.12) and the child facade
 * (Phase 7.13). Same posture as the browser layer (DOM access expected here
 * — this is the layer that calls mountIframeWidget / createBrowserWindowBridge),
 * with the same non-negotiables:
 *   - allowed imports: local modules, sibling files one level up (the
 *     Phase 7.9/7.10 contract/bootstrap layer + the Phase 7.11 browser
 *     bridge), lib/decision-os/sdk, lib/decision-os/presentation
 *   - forbidden: lib/decision-os/behavioral/*, lib/decision-os/world/*,
 *     Prisma, sdk-runtime/react (adapters never depend on other adapters —
 *     "Keeps React adapter independent" is an explicit Phase 7.12/7.13
 *     requirement)
 *   - no internal Decision OS terminology outside of import paths
 *   - no database write operations
 *   - never reads sdkConfig.auth directly in the host facade (must always
 *     route credential-bearing config through buildInitPayloadFromSdkConfig)
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const FACADE_FILES = [
  'sdk-runtime/iframe/src/facade/types.ts',
  'sdk-runtime/iframe/src/facade/widgetHost.ts',
  'sdk-runtime/iframe/src/facade/iframeClientTypes.ts',
  'sdk-runtime/iframe/src/facade/widgetIframeClient.ts',
  'sdk-runtime/iframe/src/facade/widgetIframeClientFromUrl.ts',
  'sdk-runtime/iframe/src/facade/index.ts',
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
  if (specifier.startsWith('../') && !specifier.startsWith('../../')) return true // one level up: src/ + browser/
  if (specifier.startsWith('../../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/iframe/facade import boundary', () => {
  it('every import specifier is local, one level up, or the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of FACADE_FILES) {
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
    const allowedLocal = "import type { AllFantasyWidgetHost } from './types'"
    const allowedParentLayer = "import { mountIframeWidget } from '../browser/mount'"
    const allowedSdk = "import type { SDKConfig } from '../../../../lib/decision-os/sdk/types'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingReactAdapter)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedParentLayer)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
  })

  it('no file imports sdk-runtime/react (adapters never depend on other adapters)', () => {
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: react-adapter import present = ${/sdk-runtime\/react|\.\.\/\.\.\/\.\.\/react/.test(src)}`).toBe(
        `${path}: react-adapter import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of FACADE_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })
})

describe('architecture: the facade never reads sdkConfig.auth directly', () => {
  it('widgetHost.ts only touches sdkConfig.auth via buildInitPayloadFromSdkConfig, never a bare .auth. access', () => {
    const [, src] = FACADE_FILES.find(([p]) => p.endsWith('widgetHost.ts'))!
    expect(src).toContain('buildInitPayloadFromSdkConfig')
    // A bare `.auth.` access (e.g. `config.sdkConfig.auth.credential`) would
    // be a direct read; the facade must route exclusively through the
    // already-proven-safe Phase 7.9 extractor instead.
    expect(src).not.toMatch(/\.auth\./)
  })

  it('the positive control actually catches a direct .auth. access', () => {
    const offending = 'const token = config.sdkConfig.auth.credential'
    expect(/\.auth\./.test(offending)).toBe(true)
  })
})

describe('architecture: sdk-runtime/iframe/facade contains no internal Decision OS terminology', () => {
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const FACADE_FILES_NO_IMPORTS = FACADE_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths', () => {
    for (const [path, src] of FACADE_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This facade exposes Decision OS internals')).toBe(true)
  })
})
