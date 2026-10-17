// @vitest-environment node
/**
 * The sign-up first run goes from "verify your email" straight to the importer (Guap, 2026-09-29).
 *
 * Before, the verification link returned to /onboarding: a legacy-styled profile form, then a
 * 5-step tour, then /core — 7+ screens before a new user saw anything of theirs. The UI audit named
 * it the biggest drop-off in the first run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

describe('the verification links land on the importer', () => {
  it('the sign-up email returns to /import', () => {
    const src = read('app/api/auth/register/route.ts')
    expect(src).toContain('&returnTo=${encodeURIComponent("/import")}`')
    expect(src).not.toMatch(/returnTo=\$\{encodeURIComponent\("\/onboarding"\)\}/)
  })

  it('the confirm-email reminder returns to /import too', () => {
    const src = read('lib/onboarding-retention/runConfirmEmailReminder.ts')
    expect(src).toContain("&returnTo=${encodeURIComponent('/import')}`")
    expect(src).not.toMatch(/returnTo=\$\{encodeURIComponent\('\/onboarding'\)\}/)
  })

  /**
   * 🛑 WHY SKIPPING /onboarding IS SAFE, PINNED: age confirmation does not live there alone. The
   * global chrome mounts the age prompt on every non-auth page. If that ever moves, this test is the
   * one that says the shortened first run now skips a legal gate.
   */
  it('age confirmation is still enforced app-wide, so nothing required is skipped', () => {
    const chrome = read('components/shell/SafeGlobalChrome.tsx')
    expect(chrome).toMatch(/isAuthPath\(pathname\) \? null : <AgeConfirmationPrompt \/>/)
  })
})

describe('the sign-up screen promises only what happens', () => {
  const auth = read('components/core-app/screens/AuthV4.tsx')

  it('does not claim a 3-step journey it does not route', () => {
    expect(auth).not.toContain('Step 1 of 3 · free forever for players.')
    expect(auth).toContain('Next: verify your email, then choose how to start.')
  })

  it('says the one-click Sleeper import comes after the email is verified', () => {
    expect(auth).not.toContain('your Sleeper leagues import in one click after signup')
    expect(auth).toContain('once your email is verified, your Sleeper leagues import in one click')
  })
})

describe('the importer offers both first league paths', () => {
  it('links a new user to the existing league creator', () => {
    const importer = read('components/core-app/screens/ImportV4.tsx')
    expect(importer).toContain('href="/create-league" data-testid="import-create-league"')
    expect(importer).toContain('Create a new league')
  })
})
