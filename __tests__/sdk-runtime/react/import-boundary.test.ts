import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage, INTERNAL_TERMINOLOGY_DENYLIST } from '../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/react`.
 *
 * Enforces the Phase 7.8 ticket's boundaries STRUCTURALLY:
 *   - allowed imports: 'react', local modules, sdk-runtime/core, the frozen
 *     lib/decision-os/sdk and lib/decision-os/presentation contract layers
 *   - forbidden: lib/decision-os/behavioral/* (Phase 5/6 internals),
 *     lib/decision-os/world/*, Prisma
 *   - no local score/severity derivation — every rendered value must be a
 *     structural read of an already-resolved wire field, never a
 *     recomputation
 *   - no internal Decision OS terminology in any string literal
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const REACT_FILES = [
  'sdk-runtime/react/src/types.ts',
  'sdk-runtime/react/src/lifecycleMapping.ts',
  'sdk-runtime/react/src/initialLoad.ts',
  'sdk-runtime/react/src/presentationHelpers.ts',
  'sdk-runtime/react/src/tokens.ts',
  'sdk-runtime/react/src/useAllFantasyWidget.ts',
  'sdk-runtime/react/src/WidgetRenderBoundary.tsx',
  'sdk-runtime/react/src/AllFantasyWidget.tsx',
  'sdk-runtime/react/src/index.ts',
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
  if (specifier.startsWith('./')) return true
  if (specifier.startsWith('../../core/src')) return true
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/react import boundary', () => {
  it('every import specifier is either react, local, sdk-runtime/core, or the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of REACT_FILES) {
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
    const allowedReact = "import { useState } from 'react'"
    const allowedCore = "import { LifecycleController } from '../../core/src/index'"
    const allowedSdk = "import { buildSDKError } from '../../../lib/decision-os/sdk/errors'"
    const allowedPresentation = "import type { WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedReact)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedCore)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedPresentation)[0])).toBe(true)
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })
})

describe('architecture: sdk-runtime/react computes no intelligence', () => {
  it('no file imports lib/decision-os/presentation/tokens (the score/severity computation module)', () => {
    // Legitimate imports are limited to `presentation/types` (pure types) and
    // `presentation/widget-contracts` (config validation) — never the module
    // that CALCULATES colors/severities from raw scores. Reading an
    // already-resolved `data.healthSeverity` is allowed; recomputing one
    // locally is not.
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: tokens.ts import present = ${/presentation\/tokens/.test(src)}`).toBe(
        `${path}: tokens.ts import present = false`,
      )
    }
  })

  it('no file re-implements a score→color/severity mapping function locally', () => {
    const forbiddenNames = /\b(function\s+scoreToColorToken|function\s+scoreToSeverity|const\s+scoreToColorToken\s*=|const\s+scoreToSeverity\s*=)\b/
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: local score-mapper defined = ${forbiddenNames.test(src)}`).toBe(
        `${path}: local score-mapper defined = false`,
      )
    }
  })

  it('no file compares a score/health variable against a numeric threshold', () => {
    // A conditional like `score < 50` or `healthScore >= 70` would be local
    // severity derivation — that logic lives exclusively in
    // lib/decision-os/presentation/tokens.ts (Phase 7.0), server-side.
    const thresholdCompare = /\b\w*[Ss]core\w*\s*[<>]=?\s*\d/
    for (const [path, src] of REACT_FILES) {
      expect(`${path}: score threshold comparison present = ${thresholdCompare.test(src)}`).toBe(
        `${path}: score threshold comparison present = false`,
      )
    }
  })

  it('the derivation guards actually catch violations (positive control)', () => {
    const forbiddenNames = /\b(function\s+scoreToColorToken|function\s+scoreToSeverity|const\s+scoreToColorToken\s*=|const\s+scoreToSeverity\s*=)\b/
    const thresholdCompare = /\b\w*[Ss]core\w*\s*[<>]=?\s*\d/
    expect(forbiddenNames.test('function scoreToColorToken(score: number) { return score > 50 ? "success" : "danger" }')).toBe(true)
    expect(thresholdCompare.test('if (healthScore < 50) return "critical"')).toBe(true)
    expect(thresholdCompare.test('const headline = extractHeadline(data)')).toBe(false)
  })

  it('extractHeadline (the only structural selector) never appears alongside a numeric literal comparison in the same file', () => {
    const [, src] = REACT_FILES.find(([p]) => p.endsWith('presentationHelpers.ts'))!
    expect(src).toContain('extractHeadline')
    expect(src).not.toMatch(/[<>]=?\s*\d/)
  })
})

describe('architecture: sdk-runtime/react contains no internal Decision OS terminology', () => {
  // The denylist bans the literal string 'decision-os' — which every import
  // path in this file legitimately contains (e.g. '../../../lib/decision-os/sdk').
  // This check is about what a USER SEES (JSX text, error messages), not
  // import paths, so import lines are stripped before scanning.
  // Non-greedy, multiline-aware: consumes a full `import ... from '...'`
  // statement even when the specifier list spans several lines.
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const REACT_FILES_NO_IMPORTS = REACT_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths (reuses the Phase 7.4 privacy denylist)', () => {
    for (const [path, src] of REACT_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This widget renders Decision OS internals directly')).toBe(true)
    expect(INTERNAL_TERMINOLOGY_DENYLIST.length).toBeGreaterThan(0)
  })
})
