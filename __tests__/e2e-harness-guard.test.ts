// @vitest-environment node
/**
 * The /e2e test harnesses are not served in production (2026-09-29). One layout guards them all;
 * before it, 12 of the harness pages answered 200 on allfantasy.ai.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import E2eHarnessLayout from '@/app/e2e/layout'

afterEach(() => vi.unstubAllEnvs())

describe('app/e2e/layout.tsx', () => {
  it('404s every harness in a production build', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => E2eHarnessLayout({ children: 'harness' })).toThrow()
  })

  it('serves the harness in development, where the Playwright suite runs', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(E2eHarnessLayout({ children: 'harness' })).toBe('harness')
  })

  it('is the ONLY layout between the app root and the harness pages, so it wraps all of them', () => {
    const dir = path.join(process.cwd(), 'app/e2e')
    const pages: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'page.tsx' || e.name === 'page.ts') pages.push(p)
      }
    }
    walk(dir)
    // Positive control: the harnesses exist, including ones that carried no guard of their own.
    expect(pages.length).toBeGreaterThan(50)
    expect(pages.some((p) => p.endsWith(path.join('e2e', 'roster', 'page.tsx')))).toBe(true)
    // Every harness sits under app/e2e, so the layout wraps it; a route group cannot opt out of a parent layout.
    for (const p of pages) expect(p.startsWith(dir + path.sep)).toBe(true)
  })

  it('both Playwright configs run `next dev`, so the guard cannot break the suite', () => {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    expect(read('playwright.native-testdb.config.ts')).toMatch(/next dev/)
    expect(read('playwright.config.ts')).toMatch(/playwright-dev-server\.cjs/)
  })
})
