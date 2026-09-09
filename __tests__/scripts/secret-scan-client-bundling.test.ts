/**
 * Which files the secret scan treats as client-bundled.
 *
 * WHY THIS IS TESTED AND THE REST OF THE SCANNER IS NOT. This decides which
 * files get scanned at all, and it fails silently in BOTH directions — the
 * dangerous one is a leak dropping out of the scanned set, and the expensive
 * one is a permanent WARN a correct file can never clear. Every other rule in
 * that scanner fails loudly when it is wrong.
 *
 * The regression this pins: the original rule skipped a file only when it was
 * not `"use client"` AND contained `'use server'`. That directive declares
 * Server Actions, while a React Server Component carries no directive at all —
 * so no `page.tsx` could ever satisfy the skip. `app/admin/bootstrap/page.tsx`
 * carried an unclearable warning for coercing two secrets to a boolean.
 *
 * Each case asserts the VERDICT rather than merely "no finding", so a future
 * change that makes everything 'server' cannot pass this file.
 */
import { describe, it, expect } from 'vitest'

import {
  classifyBundling,
  isAppRouterServerEntry,
} from '../../scripts/secret-scan-client-bundling.mjs'

describe('classifyBundling', () => {
  it('calls a "use client" module client, wherever it lives', () => {
    expect(classifyBundling({ rel: 'app/x/page.tsx', content: '"use client"\nconst a = 1' })).toBe('client')
    expect(classifyBundling({ rel: 'components/X.tsx', content: "'use client'\nconst a = 1" })).toBe('client')
  })

  it('calls a bare App Router entry file server — the case the old rule could not express', () => {
    expect(classifyBundling({ rel: 'app/admin/bootstrap/page.tsx', content: 'const a = 1' })).toBe('server')
  })

  it('still calls a bare helper under app/ unknown, because a client module can import it', () => {
    expect(classifyBundling({ rel: 'app/admin/helper.ts', content: 'const a = 1' })).toBe('unknown')
  })

  it('still calls a bare component unknown', () => {
    expect(classifyBundling({ rel: 'components/X.tsx', content: 'const a = 1' })).toBe('unknown')
  })

  it('calls a Server Actions module server', () => {
    expect(classifyBundling({ rel: 'app/x/actions.ts', content: '"use server"\nconst a = 1' })).toBe('server')
  })

  it('lets "use client" win over an entry filename', () => {
    // A page CAN be a client component. When it is, the secret genuinely ships.
    expect(classifyBundling({ rel: 'app/x/page.tsx', content: '"use client"' })).toBe('client')
  })

  it('treats a missing content string as unknown rather than throwing', () => {
    expect(classifyBundling({ rel: 'components/X.tsx', content: undefined })).toBe('unknown')
  })
})

describe('isAppRouterServerEntry', () => {
  it('accepts every reserved entry name', () => {
    for (const stem of ['page', 'layout', 'template', 'default', 'route', 'not-found', 'loading']) {
      expect(isAppRouterServerEntry(`app/x/${stem}.tsx`)).toBe(true)
    }
  })

  it('REFUSES error boundaries, which Next requires to be client components', () => {
    // A missing "use client" here is a broken boundary, not a server component,
    // so it must keep earning a finding.
    expect(isAppRouterServerEntry('app/x/error.tsx')).toBe(false)
    expect(isAppRouterServerEntry('app/global-error.tsx')).toBe(false)
  })

  it('refuses a non-entry file and anything outside app/', () => {
    expect(isAppRouterServerEntry('app/x/helper.ts')).toBe(false)
    expect(isAppRouterServerEntry('components/page.tsx')).toBe(false)
    expect(isAppRouterServerEntry('lib/page.tsx')).toBe(false)
  })

  it('refuses a name that merely CONTAINS an entry stem', () => {
    expect(isAppRouterServerEntry('app/x/page-header.tsx')).toBe(false)
    expect(isAppRouterServerEntry('app/x/my-page.tsx')).toBe(false)
  })

  it('reads Windows separators, which is what relative() yields on this box', () => {
    expect(isAppRouterServerEntry('app\\admin\\bootstrap\\page.tsx')).toBe(true)
    expect(isAppRouterServerEntry('app\\admin\\helper.ts')).toBe(false)
  })

  it('survives a dotfile and an extensionless path without claiming them', () => {
    expect(isAppRouterServerEntry('app/.eslintrc')).toBe(false)
    expect(isAppRouterServerEntry('app/page')).toBe(false)
    expect(isAppRouterServerEntry('')).toBe(false)
  })
})
