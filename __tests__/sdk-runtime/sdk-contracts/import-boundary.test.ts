import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasInternalLeakage } from '../../../lib/decision-os/sdk/privacy'

/**
 * Architecture regression suite for `sdk-runtime/sdk-contracts` — the
 * dependency-graph ROOT package (PHASE_7_22_SDK_PACKAGING_ADR.md D2).
 *
 * Two layers of proof:
 *   1. SOURCE-level — `src/index.ts` only imports from the two approved
 *      trees (`lib/decision-os/sdk`, `lib/decision-os/presentation`), and
 *      the source text never even mentions the deliberately-excluded
 *      names (see the file's own header comment for the exclusion list).
 *   2. BUILD-output-level — after `npm run build` (`tsc`, declaration-only
 *      per PHASE_7_23_SDK_CONTRACTS_PACKAGE_CHECKPOINT.md), the actual
 *      `dist/` content is scanned for internal terminology / secret-shaped
 *      leakage, and the PUBLIC entry point (`dist/index.d.ts`) is checked
 *      to make sure the excluded names never appear THERE (the surface a
 *      real `import {...} from '@allfantasy/sdk-contracts'` actually sees),
 *      even though the checkpoint documents that OTHER files deeper in
 *      `dist/` currently exist as an accepted, named limitation of the
 *      tsc-only (no bundler yet) build.
 */

const PACKAGE_ROOT = resolve(process.cwd(), 'sdk-runtime/sdk-contracts')
const SRC_INDEX = join(PACKAGE_ROOT, 'src/index.ts')
const DIST_DIR = join(PACKAGE_ROOT, 'dist')
// KNOWN LIMITATION (documented in PHASE_7_23_SDK_CONTRACTS_PACKAGE_CHECKPOINT.md):
// plain `tsc` (no bundler, no rootDir — rootDir conflicts with declaration
// emission for files outside src/) computes the emit root as the nearest
// common ancestor of every file in the transitive closure, which is the
// REPO ROOT — so this package's own entry point lands at this nested path,
// not a clean top-level `dist/index.d.ts`. package.json's `types`/`exports`
// fields point here for the same reason.
const DIST_INDEX_DTS = join(DIST_DIR, 'sdk-runtime/sdk-contracts/src/index.d.ts')

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const readSrcIndex = () => readFileSync(SRC_INDEX, 'utf8')
const readSrcIndexNoComments = () => stripComments(readSrcIndex())

// src/index.ts is a pure RE-EXPORT barrel (`export {...} from '...'` /
// `export type {...} from '...'`) — it contains zero `import` statements,
// so the specifier-extraction regex must match `export ... from` too.
const IMPORT_SPECIFIER_RE = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)from\s+['"]([^'"]+)['"]/g

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
  if (specifier.startsWith('../../../lib/decision-os/sdk')) return true
  if (specifier.startsWith('../../../lib/decision-os/presentation')) return true
  return false
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}

// ── Deliberately excluded names (see src/index.ts's own header) ───────────────

const EXCLUDED_PRESENTATION_INPUT_TYPES = [
  'IpmEngagementDimension',
  'IpmManagerInput',
  'IpmLeagueInput',
  'IpmPlatformInput',
  'IpmCompanyInput',
]

const EXCLUDED_BUILDER_FUNCTIONS = [
  'buildManagerBadges',
  'buildLeagueBadges',
  'buildCommissionerBadges',
  'buildPlatformBadges',
  'buildGaugeGraph',
  'buildHealthCard',
  'buildRecommendationCard',
  'buildCompactWidget',
  'buildManagerApiPresentation',
  'buildLeagueApiPresentation',
  'buildPlatformApiPresentation',
  'buildCompanyApiPresentation',
]

const EXCLUDED_WHITE_LABEL_VALUES = [
  'WHITE_LABEL_CONFIGS',
  'resolveColorToken',
  'resolveIconToken',
  'getWhiteLabelConfig',
  'isSectionVisible',
]

const EXCLUDED_TOKEN_RESOLUTION_VALUES = [
  'scoreToSeverity',
  'percentileToColorToken',
  'IDENTITY_DISPLAY_LABELS',
  'ARCHETYPE_DISPLAY_LABELS',
]

// Known real platform names that must never appear anywhere in a
// re-exported VALUE (types describing a generic shape, like
// `WhiteLabelConfig`, are fine — the DATA that names real partners is not).
const KNOWN_PROVIDER_NAMES = ['sleeper', 'yahoo', 'espn', 'fantrax', 'draftkings', 'fanduel', 'underdog']

describe('architecture: sdk-runtime/sdk-contracts import boundary (source)', () => {
  it('every import specifier in src/index.ts is one of the two approved trees', () => {
    const src = readSrcIndexNoComments()
    const specifiers = extractImportSpecifiers(src)
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) {
      expect(`src/index.ts: ${specifier} → allowed:${isAllowedSpecifier(specifier)}`).toBe(
        `src/index.ts: ${specifier} → allowed:true`,
      )
    }
  })

  it('the allowlist guard actually catches a disallowed import (positive control)', () => {
    const offendingBehavioral = "import type { ManagerBehavioralIntelligence } from '../../../lib/decision-os/behavioral/manager-intelligence'"
    const offendingWorld = "import { resolveCanonicalWorld } from '../../../lib/decision-os/world'"
    const offendingPrisma = "import { prisma } from '@/lib/prisma'"
    const offendingSdkRuntime = "import { useAllFantasyWidget } from '../../react/src/index'"
    const allowedSdk = "import type { SDKAuth } from '../../../lib/decision-os/sdk/types'"
    const allowedPresentation = "import type { WidgetConfig } from '../../../lib/decision-os/presentation/widget-contracts'"

    expect(isAllowedSpecifier(extractImportSpecifiers(offendingBehavioral)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingWorld)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingPrisma)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(offendingSdkRuntime)[0])).toBe(false)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedSdk)[0])).toBe(true)
    expect(isAllowedSpecifier(extractImportSpecifiers(allowedPresentation)[0])).toBe(true)
  })

  it('never imports from sdk-runtime/* (would invert the dependency graph — ADR D2)', () => {
    const src = readSrcIndexNoComments()
    expect(/from\s+['"][^'"]*\/sdk-runtime\//.test(src)).toBe(false)
    expect(/from\s+['"]\.\.\/\.\.\/(react|iframe|web-component|js-embed)\//.test(src)).toBe(false)
  })

  it('never imports from lib/decision-os/behavioral directly', () => {
    const src = readSrcIndexNoComments()
    expect(/decision-os\/behavioral/.test(src)).toBe(false)
  })

  it('never imports from lib/decision-os/world', () => {
    const src = readSrcIndexNoComments()
    expect(/decision-os\/world/.test(src)).toBe(false)
  })

  it('never imports or references Prisma', () => {
    const src = readSrcIndexNoComments()
    expect(/prisma/i.test(src)).toBe(false)
  })

  it('never performs a database write operation', () => {
    const src = readSrcIndexNoComments()
    expect(/\.(create|update|upsert|createMany|updateMany|deleteMany)\(/.test(src)).toBe(false)
  })
})

describe('architecture: sdk-runtime/sdk-contracts excludes Phase 5/6 raw intelligence + provider-specific values', () => {
  it('never mentions any of the excluded Ipm*Input structural-mirror types', () => {
    const src = readSrcIndex() // deliberately NOT comment-stripped — the header itself documents these names, this checks the actual export statements only
    const exportLines = src.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
    const exportText = exportLines.join('\n')
    for (const name of EXCLUDED_PRESENTATION_INPUT_TYPES) {
      expect(`export text contains '${name}' = ${exportText.includes(name)}`).toBe(`export text contains '${name}' = false`)
    }
  })

  it('never re-exports any build* assembler function', () => {
    const src = readSrcIndex()
    const exportLines = src.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    const exportText = exportLines.join('\n')
    for (const name of EXCLUDED_BUILDER_FUNCTIONS) {
      expect(`export text contains '${name}' = ${exportText.includes(name)}`).toBe(`export text contains '${name}' = false`)
    }
  })

  it('never re-exports the white-label VALUE layer (hardcodes real platform names)', () => {
    const src = readSrcIndex()
    const exportLines = src.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    const exportText = exportLines.join('\n')
    for (const name of EXCLUDED_WHITE_LABEL_VALUES) {
      expect(`export text contains '${name}' = ${exportText.includes(name)}`).toBe(`export text contains '${name}' = false`)
    }
  })

  it('never re-exports the token-resolution VALUE layer', () => {
    const src = readSrcIndex()
    const exportLines = src.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    const exportText = exportLines.join('\n')
    for (const name of EXCLUDED_TOKEN_RESOLUTION_VALUES) {
      expect(`export text contains '${name}' = ${exportText.includes(name)}`).toBe(`export text contains '${name}' = false`)
    }
  })

  it('never mentions a known real partner platform name outside of a comment', () => {
    const src = readSrcIndexNoComments()
    for (const name of KNOWN_PROVIDER_NAMES) {
      expect(`code (no comments) contains '${name}' = ${src.toLowerCase().includes(name)}`).toBe(
        `code (no comments) contains '${name}' = false`,
      )
    }
  })
})

describe('architecture: sdk-runtime/sdk-contracts contains no internal Decision OS terminology', () => {
  it('no internal terminology leaks in src/index.ts outside of import paths', () => {
    const stripImportLines = (src: string) => src.replace(/^(?:import|export)\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
    const src = stripImportLines(readSrcIndexNoComments())
    const leaked = hasInternalLeakage(src)
    expect(`src/index.ts: internal terminology leaked = ${leaked}`).toBe('src/index.ts: internal terminology leaked = false')
  })

  it('the denylist guard actually catches a violation (positive control)', () => {
    expect(hasInternalLeakage('This package exposes Decision OS internals')).toBe(true)
  })
})

// ── Build-output verification ─────────────────────────────────────────────────
// These tests require `npm run build` (tsc, declaration-only) to have run
// first inside sdk-runtime/sdk-contracts/ — they SKIP (not fail) if dist/
// does not exist yet, so `vitest run` alone (without a prior build step)
// never reports a false failure.

const distExists = existsSync(DIST_DIR)

describe.skipIf(!distExists)('build output: sdk-runtime/sdk-contracts/dist/', () => {
  it('dist/index.d.ts exists (the public entry point actually built)', () => {
    expect(existsSync(DIST_INDEX_DTS)).toBe(true)
  })

  it('is a type-only build — zero .js files anywhere in dist/ (emitDeclarationOnly)', () => {
    const files = walkFiles(DIST_DIR)
    const jsFiles = files.filter((f) => f.endsWith('.js'))
    expect(jsFiles).toEqual([])
  })

  it('dist/index.d.ts (the actual public surface) includes a spot-check of expected exports', () => {
    const content = readFileSync(DIST_INDEX_DTS, 'utf8')
    for (const expected of ['SDK_VERSION', 'validateSDKAuth', 'PARTNER_ONBOARDING_VERSION', 'PRESENTATION_VERSION', 'validateWidgetConfig', 'WIDGET_CONTRACT_VERSION']) {
      expect(`dist/index.d.ts contains '${expected}' = ${content.includes(expected)}`).toBe(
        `dist/index.d.ts contains '${expected}' = true`,
      )
    }
  })

  it('dist/index.d.ts (the actual public surface) never re-exports an excluded name', () => {
    // Strip comments first — this very file's own header DOC COMMENT names
    // every excluded identifier as documentation (see src/index.ts), and
    // declaration emission preserves leading JSDoc/block comments verbatim.
    // A naive text search would false-positive on its own explanation.
    const content = stripComments(readFileSync(DIST_INDEX_DTS, 'utf8'))
    const allExcluded = [
      ...EXCLUDED_PRESENTATION_INPUT_TYPES,
      ...EXCLUDED_BUILDER_FUNCTIONS,
      ...EXCLUDED_WHITE_LABEL_VALUES,
      ...EXCLUDED_TOKEN_RESOLUTION_VALUES,
    ]
    for (const name of allExcluded) {
      // dist/index.d.ts is a barrel of `export {...} from './...'`
      // re-export statements plus type-only `export type {...}` — an
      // excluded name could only appear here (post comment-strip) as a
      // literal exported identifier.
      const re = new RegExp(`\\b${name}\\b`)
      expect(`dist/index.d.ts references '${name}' = ${re.test(content)}`).toBe(
        `dist/index.d.ts references '${name}' = false`,
      )
    }
  })

  it('no compiled output anywhere in dist/ contains a real partner platform name in code (comments aside)', () => {
    const files = walkFiles(DIST_DIR).filter((f) => f.endsWith('.d.ts'))
    for (const file of files) {
      const content = stripComments(readFileSync(file, 'utf8'))
      for (const name of KNOWN_PROVIDER_NAMES) {
        const leaked = content.toLowerCase().includes(name)
        if (leaked) {
          expect(`${file.replace(PACKAGE_ROOT, '')}: contains provider name '${name}'`).toBe('should not leak')
        }
      }
    }
  })

  it('no compiled output anywhere in dist/ references Prisma or a database client (excluding doc comments, e.g. "never a Prisma model")', () => {
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
      // No literal afk_live_/afk_test_ credential-shaped string values (only
      // the PREFIX FORMAT regex itself, which is fine — never a real key).
      expect(/afk_(live|test)_[A-Za-z0-9]{16,}/.test(content)).toBe(false)
    }
  })

  it('package.json is private:true — the technical guardrail against accidental npm publish', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    expect(pkg.private).toBe(true)
  })
})
