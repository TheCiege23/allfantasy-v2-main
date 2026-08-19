import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage } from '../../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/iframe/src/reactChild`.
 *
 * This is the ONE sanctioned exception to "adapters never depend on other
 * adapters" (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md decision D2) — it
 * deliberately composes `sdk-runtime/react` and `sdk-runtime/iframe`. What
 * must still hold, even here:
 *   - allowed imports: local modules, sibling files one level up (the
 *     Phase 7.9-7.14 iframe layer), `sdk-runtime/react` (the sanctioned
 *     exception), `sdk-runtime/core` (shared foundation, not an adapter),
 *     lib/decision-os/sdk, lib/decision-os/presentation
 *   - forbidden: lib/decision-os/behavioral/* (Phase 5/6 internals),
 *     lib/decision-os/world/*, Prisma
 *   - no internal Decision OS terminology outside of import paths
 *   - no database write operations
 *   - the sdk-runtime/react import is CONFIRMED present (proving the
 *     sanctioned exception is actually exercised here, not just
 *     theoretically permitted) — and confirmed ABSENT from every OTHER
 *     iframe-layer file (those checks already exist in the top-level/
 *     browser/facade import-boundary suites and are unaffected by this file)
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const REACT_CHILD_FILES = [
  'sdk-runtime/iframe/src/reactChild/types.ts',
  'sdk-runtime/iframe/src/reactChild/IframeChildWidgetBridge.tsx',
  'sdk-runtime/iframe/src/reactChild/index.ts',
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
  if (specifier.startsWith('../') && !specifier.startsWith('../../')) return true // one level up: the iframe layer itself
  if (specifier.startsWith('../../../react/src')) return true // the sanctioned adapter exception
  if (specifier.startsWith('../../../core/src')) return true // shared foundation, not an adapter
  if (specifier.startsWith('../../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/iframe/reactChild import boundary', () => {
  it('every import specifier is local, one level up, the sanctioned react exception, core, or the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
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
    const allowedReact = "import { useAllFantasyWidget, WidgetRenderBoundary } from '../../../react/src/index'"
    const allowedCore = "import type { RuntimeClock } from '../../../core/src/index'"
    const allowedLocal = "import type { ReactIframeChildBridgeConfig } from './types'"
    const allowedFacade = "import { createAllFantasyWidgetIframeClientFromUrl } from '../facade/index'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedReact)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedCore)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedFacade)[0])).toBe(true)
  })

  it('the sdk-runtime/react import is actually present — the sanctioned exception is exercised, not just theoretically allowed', () => {
    const allSpecifiers = REACT_CHILD_FILES.flatMap(([, src]) => extractImportSpecifiers(src))
    expect(allSpecifiers.some((s) => s.startsWith('../../../react/src'))).toBe(true)
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })
})

describe('architecture: sdk-runtime/iframe/reactChild computes no intelligence', () => {
  it('no file imports lib/decision-os/presentation/tokens (the score/severity computation module)', () => {
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: tokens.ts import present = ${/presentation\/tokens/.test(src)}`).toBe(
        `${path}: tokens.ts import present = false`,
      )
    }
  })

  it('no file compares a score/health variable against a numeric threshold', () => {
    const thresholdCompare = /\b\w*[Ss]core\w*\s*[<>]=?\s*\d/
    for (const [path, src] of REACT_CHILD_FILES) {
      expect(`${path}: score threshold comparison present = ${thresholdCompare.test(src)}`).toBe(
        `${path}: score threshold comparison present = false`,
      )
    }
  })
})

describe('architecture: sdk-runtime/iframe/reactChild contains no internal Decision OS terminology', () => {
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const REACT_CHILD_FILES_NO_IMPORTS = REACT_CHILD_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths', () => {
    for (const [path, src] of REACT_CHILD_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This bridge exposes Decision OS internals')).toBe(true)
  })
})
