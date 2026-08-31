/**
 * Commissioner OS · `lib/domain/` must not depend on `lib/white-label/`.
 *
 * TENANCY.md §3.8. Two different things in this repo are called the tenant id:
 *
 *   lib/white-label/  resolves a BRAND from NEXT_PUBLIC_TENANT_ID — client-side,
 *                     in the bundle, readable and overridable by any viewer
 *   lib/domain/       carries the tenant identity RLS is scoped to
 *
 * Same concept, same name, and only one is a security boundary. The dependency
 * is the bug, so this forbids the dependency rather than trusting a review to
 * notice which of the two a line refers to.
 *
 * ⚠ Cheap and worth having BEFORE T-102, not after: once policies are live the
 * failure is silent — every page renders correctly and cross-tenant reads
 * succeed. There is no red test to work backwards from.
 *
 * This is a lint rule in test form. T-005 owns the real ESLint boundary; when
 * that lands with a `no-restricted-imports` entry for `lib/white-label` inside
 * `lib/domain`, this file can go.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const DOMAIN_DIR = path.resolve(process.cwd(), 'lib/domain')

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return tsFilesUnder(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

/**
 * All four import forms, because a census that checks only `from '@/lib/x'`
 * gives the wrong answer — the root CLAUDE.md records four separate occasions
 * in this repo where it missed relative imports, dynamic `await import(...)`,
 * re-export facades and test mocks.
 */
const FORBIDDEN = [
  /from\s+['"]@\/lib\/white-label/,
  /from\s+['"][./]+white-label/,
  /import\s*\(\s*['"][^'"]*white-label/,
  /require\s*\(\s*['"][^'"]*white-label/,
]

describe('lib/domain does not import lib/white-label', () => {
  const files = tsFilesUnder(DOMAIN_DIR)

  it('finds the domain modules at all (positive control)', () => {
    // Without this, a wrong path yields an empty file list and every assertion
    // below passes having read nothing.
    expect(files.length).toBeGreaterThan(0)
    expect(files.map((f) => path.basename(f))).toContain('actorContext.ts')
  })

  it('the matchers actually match a white-label import (positive control)', () => {
    // And without this, a broken regex reports a clean codebase forever.
    const specimen = `import { resolveTenantBrand } from '@/lib/white-label'`
    expect(FORBIDDEN.some((re) => re.test(specimen))).toBe(true)
  })

  it.each(FORBIDDEN.map((re, i) => [i, re] as const))(
    'matcher %i catches its own form',
    (_i, re) => {
      const specimens = [
        `import x from '@/lib/white-label/resolveTenant'`,
        `import x from '../white-label/resolveTenant'`,
        `const x = await import('@/lib/white-label')`,
        `const x = require('@/lib/white-label')`,
      ]
      expect(specimens.some((s) => re.test(s))).toBe(true)
    },
  )

  it('no domain file imports it, in any form', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return FORBIDDEN.some((re) => re.test(source))
    })

    expect(
      offenders.map((f) => path.relative(process.cwd(), f)),
      'lib/domain must not reach lib/white-label — see TENANCY.md §3.8',
    ).toEqual([])
  })
})
