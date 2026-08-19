import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Architecture regression suite for `sdk-runtime/core`.
 *
 * Enforces the Phase 7.5 ADR boundary STRUCTURALLY (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md,
 * decision D1): `sdk-runtime/core` may import ONLY from `lib/decision-os/sdk` and
 * `lib/decision-os/presentation` (the frozen contract layers) plus its own local modules.
 * It must NEVER import `lib/decision-os/behavioral/*`, `lib/decision-os/world/*`, Prisma,
 * React, or any Node-specific module — and must never call a bare global `fetch`.
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const CORE_FILES = [
  'sdk-runtime/core/src/types.ts',
  'sdk-runtime/core/src/httpClient.ts',
  'sdk-runtime/core/src/authPreCheck.ts',
  'sdk-runtime/core/src/lifecycleController.ts',
  'sdk-runtime/core/src/errorMapper.ts',
  'sdk-runtime/core/src/refreshEngine.ts',
  'sdk-runtime/core/src/index.ts',
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
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/core import boundary', () => {
  it('every import specifier is either local or from the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of CORE_FILES) {
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
    const offendingReact = "import { useState } from 'react'"
    const allowedSdk = "import { buildSDKError } from '../../../lib/decision-os/sdk/errors'"
    const allowedPresentation = "import type { WidgetApiCall } from '../../../lib/decision-os/presentation/widget-contracts'"
    const allowedLocal = "import type { HttpClientConfig } from './types'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingReact)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedPresentation)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file imports React or any UI framework', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: react import present = ${/from\s+['"]react/.test(src)}`).toBe(
        `${path}: react import present = false`,
      )
    }
  })

  it('no file calls a bare global setTimeout()/setInterval() — all timers go through the injected RuntimeClock', () => {
    // types.ts is excluded: it only DECLARES the RuntimeClock interface's
    // `setTimeout(...)` method signature (the contract implementors fulfill),
    // never CALLS a global timer — a legitimate declaration, not a violation.
    const bareSetTimeout = /(?<![\w.])setTimeout\(/
    const bareSetInterval = /(?<![\w.])setInterval\(/
    for (const [path, src] of CORE_FILES) {
      if (path.endsWith('types.ts')) continue
      expect(`${path}: bare setTimeout() call present = ${bareSetTimeout.test(src)}`).toBe(
        `${path}: bare setTimeout() call present = false`,
      )
      expect(`${path}: bare setInterval() call present = ${bareSetInterval.test(src)}`).toBe(
        `${path}: bare setInterval() call present = false`,
      )
    }
  })

  it('the bare-timer guard actually catches a violation but allows clock.setTimeout (positive control)', () => {
    const bareSetTimeout = /(?<![\w.])setTimeout\(/
    const bareSetInterval = /(?<![\w.])setInterval\(/
    const offendingTimeout = 'const handle = setTimeout(callback, 1000)'
    const offendingInterval = 'const handle = setInterval(callback, 1000)'
    const allowed = 'const handle = this.deps.clock.setTimeout(callback, delayMs)'
    expect(bareSetTimeout.test(offendingTimeout)).toBe(true)
    expect(bareSetInterval.test(offendingInterval)).toBe(true)
    expect(bareSetTimeout.test(allowed)).toBe(false)
  })

  it('no file references DOM globals (window, document)', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: window reference = ${/\bwindow\./.test(src)}`).toBe(`${path}: window reference = false`)
      expect(`${path}: document reference = ${/\bdocument\./.test(src)}`).toBe(`${path}: document reference = false`)
    }
  })

  it('no file calls a bare global fetch() — all network calls go through the injected fetchImpl', () => {
    // Negative lookbehind excludes `config.fetchImpl(` / `.fetchImpl(` style calls.
    const bareFetchCall = /(?<![\w.])fetch\(/
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: bare fetch() call present = ${bareFetchCall.test(src)}`).toBe(
        `${path}: bare fetch() call present = false`,
      )
    }
  })

  it('the bare-fetch guard actually catches a violation but allows fetchImpl (positive control)', () => {
    const bareFetchCall = /(?<![\w.])fetch\(/
    const offending = 'const response = await fetch(url, init)'
    const allowed = 'const response = await config.fetchImpl(url, init)'
    expect(bareFetchCall.test(offending)).toBe(true)
    expect(bareFetchCall.test(allowed)).toBe(false)
  })

  it('no file performs a database write operation (create/update/upsert/createMany/updateMany/deleteMany)', () => {
    // Bare "delete" is deliberately excluded: Map/Set.delete() is a legitimate
    // built-in used by refreshEngine.ts's timer bookkeeping and collides with
    // the token; the Prisma-flavored variants below are distinctive enough
    // not to collide with standard-library collection methods.
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of CORE_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })
})
