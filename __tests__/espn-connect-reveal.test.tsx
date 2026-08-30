/**
 * 6b — the pasted ESPN cookies can be checked before they are submitted.
 *
 * ⚠ WHY THIS IS WORTH A TEST AND NOT JUST A SCREENSHOT. Both fields are
 * `type="password"`, correctly — SWID and espn_s2 are credentials. But they are
 * the only credentials on this screen that are COPIED rather than remembered:
 * the panel's own instructions say open devtools, find the cookie, paste it
 * here, and espn_s2 runs to a few hundred opaque characters.
 *
 * Masked with no way to look, a truncated selection or a trailing space is
 * indistinguishable from a good paste until the connect fails — and that failure
 * says ESPN rejected the values, which reads as "my cookies expired" rather than
 * "I mis-copied one". The person then goes back to devtools and repeats the
 * mistake. The toggle is the cheap fix; these are its guarantees.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { EspnConnectPanel } from '@/components/core-app/import/EspnConnectPanel'

/* The panel asks /api/league/auth on mount. Answer "not connected" so it renders
   the manual form, which is the branch under test. */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ auths: [] }),
    })) as unknown as typeof fetch,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const swidInput = () => document.querySelector('#espn-swid-input') as HTMLInputElement
const s2Input = () => document.querySelector('#espn-s2-input') as HTMLInputElement

describe('6b — the pasted cookies can be verified before submitting', () => {
  it('masks both fields until asked, then reveals both together', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(swidInput()).toBeTruthy())

    /* Masked by default. They are credentials; the default is not negotiable. */
    expect(swidInput().type).toBe('password')
    expect(s2Input().type).toBe('password')

    /* ⚠ NO TOGGLE OVER EMPTY BOXES. There is nothing to check before anything is
       pasted, and a control that does nothing is noise on a screen that is
       already mostly instructions. */
    expect(screen.queryByRole('button', { name: /show what i pasted/i })).toBeNull()

    fireEvent.change(swidInput(), { target: { value: '{ABC-DEF}' } })

    const toggle = screen.getByRole('button', { name: /show what i pasted/i })
    /* Inside the form, so it must not submit it — a submit here fires the connect
       with the half-checked values this control exists to prevent. */
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(toggle)

    /* Both, from one press: they are copied in one trip, so they are checked in one. */
    expect(swidInput().type).toBe('text')
    expect(s2Input().type).toBe('text')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(toggle)
    expect(swidInput().type).toBe('password')
    expect(s2Input().type).toBe('password')
  })

  it('never invites a password manager to store a cookie', async () => {
    render(<EspnConnectPanel />)
    await waitFor(() => expect(swidInput()).toBeTruthy())

    /*
     * ⚠ THE REVEAL MUST NOT COST THE autoComplete GUARD. Flipping type to `text`
     * is exactly when a browser starts offering to remember a field, and a
     * password manager holding a rotating session cookie under the user's ESPN
     * entry is worse than the paste error this feature fixes. Asserted in BOTH
     * states so the reveal cannot quietly drop it.
     */
    for (const el of [swidInput(), s2Input()]) {
      expect(el.getAttribute('autocomplete')).toBe('off')
      expect(el.getAttribute('spellcheck')).toBe('false')
    }

    fireEvent.change(swidInput(), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /show what i pasted/i }))

    for (const el of [swidInput(), s2Input()]) {
      expect(el.type).toBe('text')
      expect(el.getAttribute('autocomplete')).toBe('off')
    }
  })
})
