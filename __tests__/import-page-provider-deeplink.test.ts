/**
 * Part A regression — commissioner import deep-link + auth-return wiring.
 *
 * Covers the server-side /import route behavior that the LeagueImportFlow
 * component test does not:
 *
 *   - ?provider=<x> normalizes to the correct provider tab (and bad values
 *     fall back to sleeper, never crash).
 *   - Unauthenticated users are redirected to /login with a callbackUrl that
 *     preserves the provider, so they return to the intended import tab.
 *   - returnTo defaults to /create-league so the create-league auth callback
 *     lands back on /create-league.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeIncomingImportProvider } from '@/lib/import/importSearchParams'

const root = resolve(__dirname, '..')
const importPageSrc = readFileSync(resolve(root, 'app/import/page.tsx'), 'utf8')

describe('normalizeIncomingImportProvider — provider deep-link normalization', () => {
  it.each(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl'] as const)(
    'maps ?provider=%s to the matching tab',
    (provider) => {
      expect(normalizeIncomingImportProvider(provider)).toBe(provider)
    },
  )

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeIncomingImportProvider('  ESPN ')).toBe('espn')
    expect(normalizeIncomingImportProvider('Yahoo')).toBe('yahoo')
  })

  it('returns undefined for unknown providers (caller falls back to sleeper)', () => {
    expect(normalizeIncomingImportProvider('myfantasyleague')).toBeUndefined()
    expect(normalizeIncomingImportProvider('')).toBeUndefined()
    expect(normalizeIncomingImportProvider(undefined)).toBeUndefined()
  })
})

describe('/import server route — auth-return + provider seeding (source invariants)', () => {
  it('normalizes the provider query param and defaults to sleeper', () => {
    expect(importPageSrc).toMatch(/normalizeIncomingImportProvider\(providerRaw\) \?\? "sleeper"/)
  })

  it('defaults returnTo to /create-league when none/invalid is provided', () => {
    expect(importPageSrc).toMatch(/returnToRaw\?\.startsWith\("\/"\) \? returnToRaw : "\/create-league"/)
  })

  it('redirects unauthenticated users to /login preserving the provider in callbackUrl', () => {
    expect(importPageSrc).toMatch(/if \(!session\?\.user\?\.id\)/)
    expect(importPageSrc).toMatch(/if \(providerRaw\) qs\.set\("provider", providerRaw\)/)
    expect(importPageSrc).toMatch(/redirect\(`\/login\?callbackUrl=\$\{callbackUrl\}`\)/)
  })

  it('passes the resolved provider into ImportPageClient as defaultProvider', () => {
    expect(importPageSrc).toMatch(/defaultProvider=\{defaultProvider\}/)
  })
})
