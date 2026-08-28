import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-shape test: this is a large client screen whose branches depend on
 * search params and session state, and the defect was structural — an early
 * `return` making later outcome handlers unreachable. That is exactly what a
 * source assertion catches and a render test would not.
 */
const SRC = fs.readFileSync(
  path.join(process.cwd(), 'components', 'core-app', 'screens', 'VerifyEmailV4.tsx'),
  'utf8',
)

/** The expired / invalid / error branch — the screen a dead link lands on. */
const BAD_LINK_AT = SRC.indexOf("if (state === 'expired' || state === 'invalid' || state === 'error')")
const BAD_LINK_BLOCK = SRC.slice(BAD_LINK_AT, BAD_LINK_AT + 3500)

describe('the expired-link screen reports what happened', () => {
  it('has the branch this test is about', () => {
    expect(BAD_LINK_AT).toBeGreaterThan(-1)
  })

  /*
   * ⚠ THE BUG. This branch rendered ONLY `send_failed`, and the full-page
   * handlers for the other outcomes sit BELOW its early return, so they could
   * never run. A successful send showed no confirmation and a rate-limited one
   * showed nothing at all — the button silently relabelled to "Resend in 59s".
   * Reported by the owner as "no new link was sent".
   */
  it('does not report only the failure case', () => {
    expect(BAD_LINK_BLOCK).not.toMatch(/\{outcome === 'send_failed' \? \(\s*<div[\s\S]{0,400}\) : null\}/)
  })

  it.each(['sent', 'rate_limited', 'already', 'login_required'])(
    'surfaces the %s outcome on this screen',
    (outcome) => {
      expect(BAD_LINK_BLOCK).toContain(`'${outcome}'`)
    },
  )

  /* A success must tell the reader to go and look, and where. */
  it('names the inbox and the one-hour lifetime on success', () => {
    expect(BAD_LINK_BLOCK).toMatch(/Check \$\{email/)
    expect(BAD_LINK_BLOCK).toMatch(/one hour/i)
  })

  /*
   * A rate limit must say NOTHING WAS SENT. Otherwise the reader waits on an
   * email that was never going to arrive — which is the failure that started
   * this, one level up.
   */
  it('says plainly that a rate-limited attempt sent nothing', () => {
    expect(BAD_LINK_BLOCK).toMatch(/nothing was sent/i)
  })

  /*
   * The button is still correctly gated on the session: a signed-out visitor
   * gets a sign-in link rather than a control that can only 401.
   */
  it('offers sign-in rather than a doomed button when signed out', () => {
    expect(BAD_LINK_BLOCK).toContain('signedIn ?')
    expect(BAD_LINK_BLOCK).toMatch(/Sign in to resend/)
  })
})
