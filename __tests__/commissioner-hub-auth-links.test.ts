import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    'app',
    'commissioner-hub',
    'CommissionerHubPageClient.tsx',
  ),
  'utf8',
)

describe('commissioner hub auth-sensitive CTA wiring', () => {
  it('sends unauthenticated create flows back to create-league after login', () => {
    expect(source).toContain(
      "const primaryHeroHref = isAuthenticated ? '/create-league' : buildLoginHref('/create-league')",
    )
    expect(source).toContain(
      "const emptyPrimaryHref = isAuthenticated ? '/create-league' : buildLoginHref('/create-league')",
    )
  })

  it('disables prefetch for create/import auth-sensitive links and their login callbacks', () => {
    expect(source).toContain("if (pathname === '/create-league' || pathname === '/import') return true")
    expect(source).toContain("if (pathname !== '/login') return false")
    expect(source).toContain("return callbackUrl === '/create-league' || callbackUrl === '/import'")
  })

  it('routes migration cards to provider-specific import tabs', () => {
    expect(source).toContain("href: '/import?provider=sleeper'")
    expect(source).toContain("href: '/import?provider=espn'")
    expect(source).toContain("href: '/import?provider=yahoo'")
    expect(source).toContain("href: '/import?provider=fantrax'")
    expect(source).toContain("href: '/import?provider=mfl'")
  })
})
