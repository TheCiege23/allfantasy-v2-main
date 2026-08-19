import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage } from '../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/js-embed`.
 *
 * This is the SAME category of sanctioned exception to "adapters never
 * depend on other adapters" (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md
 * decision D2) that `sdk-runtime/iframe/src/reactChild` (Phase 7.15) and
 * `sdk-runtime/web-component` (Phase 7.16) established — it deliberately
 * composes `sdk-runtime/react`. What must still hold:
 *   - allowed imports: local modules, `sdk-runtime/react` (the sanctioned
 *     exception), `sdk-runtime/core` (shared foundation, not an adapter),
 *     lib/decision-os/sdk, lib/decision-os/presentation, 'react', 'react-dom'
 *   - forbidden: `sdk-runtime/iframe` AND `sdk-runtime/web-component` (both
 *     PEER adapters — proves independence still holds except the one
 *     sanctioned react import), lib/decision-os/behavioral/* (Phase 5/6
 *     internals), lib/decision-os/world/*, Prisma
 *   - no internal Decision OS terminology outside of import paths
 *   - no database write operations
 *   - no postMessage usage at all (js_embed has no cross-frame boundary —
 *     SDKEmbedCapabilities['js_embed'].supportsPostMessage is false)
 *   - the sdk-runtime/react import is CONFIRMED present
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const JS_EMBED_FILES = [
  'sdk-runtime/js-embed/src/types.ts',
  'sdk-runtime/js-embed/src/containerValidation.ts',
  'sdk-runtime/js-embed/src/config.ts',
  'sdk-runtime/js-embed/src/defaults.ts',
  'sdk-runtime/js-embed/src/AllFantasyWidgetBridge.tsx',
  'sdk-runtime/js-embed/src/createWidget.ts',
  'sdk-runtime/js-embed/src/namespace.ts',
  'sdk-runtime/js-embed/src/index.ts',
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
  if (specifier === 'react') return true
  if (specifier.startsWith('react-dom')) return true
  if (specifier.startsWith('./')) return true
  if (specifier.startsWith('../../react/src')) return true // the sanctioned adapter exception
  if (specifier.startsWith('../../core/src')) return true // shared foundation, not an adapter
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/js-embed import boundary', () => {
  it('every import specifier is local, the sanctioned react exception, core, or the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      const specifiers = extractImportSpecifiers(src)
      for (const specifier of specifiers) {
        expect(`${path}: ${specifier} → allowed:${isAllowedSpecifier(specifier)}`).toBe(
          `${path}: ${specifier} → allowed:true`,
        )
      }
    }
  })

  it('the allowlist guard actually catches a disallowed import (positive control)', () => {
    const offendingBehavioral = "import { checkIntelligenceGate } from '../../../lib/decision-os/behavioral/api/gate'"
    const offendingWorld = "import { resolveCanonicalWorld } from '../../../lib/decision-os/world'"
    const offendingPrisma = "import { prisma } from '@/lib/prisma'"
    const offendingIframe = "import { createAllFantasyWidgetHost } from '../iframe/src/facade/index'"
    const offendingWebComponent = "import { AllFantasyWidgetElement } from '../web-component/src/AllFantasyWidgetElement'"
    const allowedReact = "import { useAllFantasyWidget, WidgetRenderBoundary } from '../../react/src/index'"
    const allowedCore = "import type { RuntimeClock } from '../../core/src/index'"
    const allowedLocal = "import type { JsEmbedWidgetConfig } from './types'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingIframe)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWebComponent)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedReact)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedCore)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
  })

  it('the sdk-runtime/react import is actually present — the sanctioned exception is exercised, not just theoretically allowed', () => {
    const allSpecifiers = JS_EMBED_FILES.flatMap(([, src]) => extractImportSpecifiers(src))
    expect(allSpecifiers.some((s) => s.startsWith('../../react/src'))).toBe(true)
  })

  it('no file imports sdk-runtime/iframe (a peer adapter)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: iframe import present = ${/from\s+['"][^'"]*\/iframe\//.test(src)}`).toBe(
        `${path}: iframe import present = false`,
      )
    }
  })

  it('no file imports sdk-runtime/web-component (a peer adapter)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: web-component import present = ${/from\s+['"][^'"]*\/web-component\//.test(src)}`).toBe(
        `${path}: web-component import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })

  it('no file calls or references postMessage (js_embed has no cross-frame boundary to cross)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: postMessage reference present = ${/postMessage/.test(src)}`).toBe(
        `${path}: postMessage reference present = false`,
      )
    }
  })

  it('createWidget.ts never assigns auth or apiKey as a property of the returned instance object', () => {
    const createWidgetSrc = JS_EMBED_FILES.find(([p]) => p.endsWith('createWidget.ts'))![1]
    // The returned object literal's own keys — structural check that no
    // `auth:`/`apiKey:` property assignment appears in the return statement.
    const returnBlockMatch = createWidgetSrc.match(/return\s*\{[\s\S]*?\n\s*\}/)
    expect(returnBlockMatch).not.toBeNull()
    const returnBlock = returnBlockMatch![0]
    expect(/\bauth\s*[:,]/.test(returnBlock)).toBe(false)
    expect(/\bapiKey\s*[:,]/.test(returnBlock)).toBe(false)
  })
})

describe('architecture: sdk-runtime/js-embed computes no intelligence', () => {
  it('no file imports lib/decision-os/presentation/tokens (the score/severity computation module)', () => {
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: tokens.ts import present = ${/presentation\/tokens/.test(src)}`).toBe(
        `${path}: tokens.ts import present = false`,
      )
    }
  })

  it('no file compares a score/health variable against a numeric threshold', () => {
    const thresholdCompare = /\b\w*[Ss]core\w*\s*[<>]=?\s*\d/
    for (const [path, src] of JS_EMBED_FILES) {
      expect(`${path}: score threshold comparison present = ${thresholdCompare.test(src)}`).toBe(
        `${path}: score threshold comparison present = false`,
      )
    }
  })
})

describe('architecture: sdk-runtime/js-embed contains no internal Decision OS terminology', () => {
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const JS_EMBED_FILES_NO_IMPORTS = JS_EMBED_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths', () => {
    for (const [path, src] of JS_EMBED_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This embed exposes Decision OS internals')).toBe(true)
  })
})
