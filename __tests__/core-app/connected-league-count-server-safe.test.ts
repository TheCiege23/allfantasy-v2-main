import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * `HomeCards` is a server component. It called `connectedLeagueCount` imported from
 * `Dashboard3A.tsx`, a `'use client'` module — and Next.js makes every export of a client module a
 * client reference, so the call threw on every Core home render and the Chimmy card never drew
 * (seen in CI's server log: "Attempted to call connectedLeagueCount() from the server").
 */
describe('connectedLeagueCount is callable from the server', () => {
  it('lives in a module with no client directive', () => {
    const src = readFileSync('lib/core-app/connectedLeagueCount.ts', 'utf8')
    expect(src).not.toMatch(/^\s*['"]use client['"]/m)
  })

  it('is what the server component imports, not the client screen', () => {
    const src = readFileSync('components/core-app/home/HomeCards.tsx', 'utf8')
    expect(src).not.toMatch(/^\s*['"]use client['"]/m)
    expect(src).toMatch(/import \{ connectedLeagueCount \} from '@\/lib\/core-app\/connectedLeagueCount'/)
    const fromClient = src.match(/import[^;]*?\{([^}]*)\}\s*from '@\/components\/core-app\/screens\/Dashboard3A'/)
    expect(fromClient?.[1] ?? '').not.toMatch(/\bconnectedLeagueCount\b/)
  })
})
