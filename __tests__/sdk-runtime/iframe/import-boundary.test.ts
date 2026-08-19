import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasInternalLeakage } from '../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/iframe`.
 *
 * Enforces the Phase 7.9/7.10 boundaries STRUCTURALLY:
 *   - allowed imports: local modules, the frozen lib/decision-os/sdk and
 *     lib/decision-os/presentation contract layers
 *   - forbidden: lib/decision-os/behavioral/* (Phase 5/6 internals),
 *     lib/decision-os/world/*, Prisma, AND sdk-runtime/react — adapters
 *     never depend on other adapters
 *     (PHASE_7_5_WIDGET_RUNTIME_BOUNDARY_ADR.md decision D2)
 *   - no internal Decision OS terminology outside of import paths
 *   - no unguarded global `window`/`document` reference anywhere — every
 *     Phase 7.10 send/listen path takes an injected WindowLike instead
 *   - every outbound send in iframeHost.ts/iframeClient.ts routes through
 *     the safePostMessage wrapper — never a raw `.postMessage()` call
 */

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (rel: string) => stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'))

const IFRAME_FILES = [
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
  'sdk-runtime/iframe/src/urlHandshake.ts',
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
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

describe('architecture: sdk-runtime/iframe import boundary', () => {
  it('every import specifier is either local or from the frozen sdk/presentation contract layers', () => {
    for (const [path, src] of IFRAME_FILES) {
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
    const offendingReactAdapter = "import { useAllFantasyWidget } from '../../react/src/useAllFantasyWidget'"
    const allowedLocal = "import type { IframeEmbedConfig } from './types'"
    const allowedSdk = "import { buildSDKError } from '../../../lib/decision-os/sdk/errors'"
    const allowedPresentation = "import type { WidgetMode } from '../../../lib/decision-os/presentation/widget-contracts'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingReactAdapter)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedLocal)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedPresentation)[0])).toBe(true)
  })

  it('no file imports sdk-runtime/react (adapters never depend on other adapters)', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: react-adapter import present = ${/sdk-runtime\/react|\.\.\/\.\.\/react/.test(src)}`).toBe(
        `${path}: react-adapter import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/behavioral (Phase 5/6 internals)', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: behavioral import present = ${/decision-os\/behavioral/.test(src)}`).toBe(
        `${path}: behavioral import present = false`,
      )
    }
  })

  it('no file imports lib/decision-os/world (Canonical World internals)', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: world import present = ${/decision-os\/world/.test(src)}`).toBe(
        `${path}: world import present = false`,
      )
    }
  })

  it('no file imports Prisma or a database client', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: prisma reference present = ${/prisma/i.test(src)}`).toBe(
        `${path}: prisma reference present = false`,
      )
    }
  })

  it('no file performs a database write operation', () => {
    const writeOp = /\.(create|update|upsert|createMany|updateMany|deleteMany)\(/
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: write op present = ${writeOp.test(src)}`).toBe(`${path}: write op present = false`)
    }
  })

  it('no file references a Stage 1 Decision OS soak flag', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: soak flag reference = ${/DECISION_OS_COMMISSIONER_HEALTH_LIVE/.test(src)}`).toBe(
        `${path}: soak flag reference = false`,
      )
    }
  })

  it('no file calls window.postMessage or window.addEventListener — contract only, no runtime DOM wiring yet', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: window.postMessage present = ${/window\.postMessage/.test(src)}`).toBe(
        `${path}: window.postMessage present = false`,
      )
      expect(`${path}: window.addEventListener present = ${/window\.addEventListener/.test(src)}`).toBe(
        `${path}: window.addEventListener present = false`,
      )
    }
  })

  it('no file references window or document globals at all', () => {
    for (const [path, src] of IFRAME_FILES) {
      expect(`${path}: window reference = ${/\bwindow\./.test(src)}`).toBe(`${path}: window reference = false`)
      expect(`${path}: document reference = ${/\bdocument\./.test(src)}`).toBe(`${path}: document reference = false`)
    }
  })

  it('iframeHost.ts and iframeClient.ts never call .postMessage() directly — only through the safePostMessage wrapper', () => {
    const directMethodCall = /\.postMessage\(/
    const files = IFRAME_FILES.filter(([p]) => p.endsWith('iframeHost.ts') || p.endsWith('iframeClient.ts'))
    expect(files).toHaveLength(2)
    for (const [path, src] of files) {
      expect(`${path}: direct .postMessage() call present = ${directMethodCall.test(src)}`).toBe(
        `${path}: direct .postMessage() call present = false`,
      )
      expect(`${path}: uses safePostMessage = ${/safePostMessage\(/.test(src)}`).toBe(
        `${path}: uses safePostMessage = true`,
      )
    }
  })

  it('postMessageSafety.ts is the only file that calls .postMessage() directly', () => {
    const directMethodCall = /\.postMessage\(/
    for (const [path, src] of IFRAME_FILES) {
      const isTheWrapperItself = path.endsWith('postMessageSafety.ts')
      expect(`${path}: direct call = ${directMethodCall.test(src)}, isWrapper = ${isTheWrapperItself}`).toBe(
        `${path}: direct call = ${isTheWrapperItself}, isWrapper = ${isTheWrapperItself}`,
      )
    }
  })
})

describe('architecture: sdk-runtime/iframe contains no internal Decision OS terminology', () => {
  const stripImportLines = (src: string) => src.replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  const IFRAME_FILES_NO_IMPORTS = IFRAME_FILES.map(([path, src]) => [path, stripImportLines(src)] as const)

  it('no source file leaks internal terminology outside of import paths', () => {
    for (const [path, src] of IFRAME_FILES_NO_IMPORTS) {
      const leaked = hasInternalLeakage(src)
      expect(`${path}: internal terminology leaked = ${leaked}`).toBe(`${path}: internal terminology leaked = false`)
    }
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This message payload references Decision OS internals')).toBe(true)
  })
})

describe('architecture: sdk-runtime/iframe never sends auth/credential fields', () => {
  it('no payload type definition includes an "auth" or "credential" field', () => {
    const [, typesSrc] = IFRAME_FILES.find(([p]) => p.endsWith('types.ts'))!
    // Scoped to the payload interfaces only (excludes IframeEmbedConfig, which
    // legitimately wraps a full SDKConfig containing auth — that object is a
    // local config value, never itself serialized across postMessage).
    const payloadInterfaces = typesSrc.match(/export interface Iframe\w*Payload\s*\{[^}]*\}/g) ?? []
    expect(payloadInterfaces.length).toBeGreaterThan(0)
    for (const block of payloadInterfaces) {
      expect(block).not.toMatch(/\bauth\b/)
      expect(block).not.toMatch(/\bcredential\b/)
      expect(block).not.toMatch(/\btenantId\b/)
    }
  })
})
