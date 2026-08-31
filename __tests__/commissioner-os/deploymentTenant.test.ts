/**
 * Commissioner OS · this deployment's tenant identity.
 *
 * The tests that matter here are about what the resolver REFUSES, because the
 * dangerous failure is not an error — it is a confident wrong answer that
 * assigns rows to a tenant nobody chose. RLS cannot catch that: the rows are
 * legitimately readable by whichever tenant they were written to.
 */

import { describe, it, expect } from 'vitest'
import {
  DEPLOYMENT_TENANT_ENV,
  resolveDeploymentTenantId,
  requireDeploymentTenantId,
} from '@/lib/domain/deploymentTenant'

describe('resolveDeploymentTenantId', () => {
  it('returns the configured tenant', () => {
    const r = resolveDeploymentTenantId({ [DEPLOYMENT_TENANT_ENV]: 'allfantasy' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('allfantasy')
  })

  it('trims, because a trailing newline from a secret store is not a tenant', () => {
    const r = resolveDeploymentTenantId({ [DEPLOYMENT_TENANT_ENV]: '  allfantasy\n' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('allfantasy')
  })

  it('🛑 refuses when unset — and does NOT fall back to allfantasy', () => {
    const r = resolveDeploymentTenantId({})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVARIANT')
    // The assertion with teeth. 'allfantasy' is the right answer today, which is
    // exactly why a fallback would never be noticed until a second operator
    // exists and it starts being wrong.
    expect(JSON.stringify(r.error)).not.toMatch(/"allfantasy"/)
  })

  it('🛑 refuses an EMPTY value, which is not the same as unset to a config UI', () => {
    // `COMMISH_TENANT_ID=` in a dashboard is trivially easy to produce and is
    // truthy-adjacent in enough languages to be worth pinning.
    for (const blank of ['', '   ', '\n', '\t']) {
      const r = resolveDeploymentTenantId({ [DEPLOYMENT_TENANT_ENV]: blank })
      expect(r.ok, `blank value ${JSON.stringify(blank)} was accepted`).toBe(false)
    }
  })

  it('🛑 never reads NEXT_PUBLIC_TENANT_ID, even when it is the only one set', () => {
    // The core of TENANCY.md §3.4. That variable ships in the client bundle:
    // every viewer can read it and every viewer can change it. A resolver that
    // "helpfully" fell back to it would work perfectly in every environment and
    // hand tenant identity to the browser.
    const r = resolveDeploymentTenantId({ NEXT_PUBLIC_TENANT_ID: 'apex' })
    expect(r.ok).toBe(false)
  })

  it('does not let NEXT_PUBLIC_TENANT_ID override the server value', () => {
    const r = resolveDeploymentTenantId({
      [DEPLOYMENT_TENANT_ENV]: 'operator-a',
      NEXT_PUBLIC_TENANT_ID: 'operator-b',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('operator-a')
  })
})

describe('requireDeploymentTenantId', () => {
  it('returns the value when configured', () => {
    expect(requireDeploymentTenantId({ [DEPLOYMENT_TENANT_ENV]: 't1' })).toBe('t1')
  })

  it('throws rather than returning a guess', () => {
    expect(() => requireDeploymentTenantId({})).toThrow(/COMMISH_TENANT_ID/)
  })
})

describe('the module itself', () => {
  it('🛑 contains no default tenant constant to be reached for', () => {
    // A structural assertion, because the risk is not that today's code uses a
    // default — it is that a constant sitting in the file gets wired in later
    // by someone fixing a failing deploy at speed. If it does not exist, it
    // cannot be reached for.
    //
    // ⚠ Deliberately reads the SOURCE, not the exports: a non-exported constant
    // would be invisible to an export check and just as available to the next
    // edit in the same file.
    const src = readSource()
    const code = stripComments(src)
    expect(code).not.toMatch(/['"]allfantasy['"]/)
    expect(code).not.toMatch(/NEXT_PUBLIC_TENANT_ID/)
  })

  it('the source check can actually see code (positive control)', () => {
    // Without this, a stripComments() that returned '' would make the test above
    // pass forever while checking nothing.
    const code = stripComments(readSource())
    expect(code).toMatch(/COMMISH_TENANT_ID/)
    expect(code.length).toBeGreaterThan(200)
  })
})

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as typeof import('node:path')
  return fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'lib', 'domain', 'deploymentTenant.ts'),
    'utf8',
  )
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}
