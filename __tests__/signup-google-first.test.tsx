/**
 * Sign-up leads with the social buttons (2026-10-11).
 *
 * Measured in production over 60 days: Google sign-ups confirmed their email 32 of 32;
 * email-and-password sign-ups 33 of 71, and the 30 still stuck on 09-26 never came back. The buttons
 * sat below the whole form behind "Or continue with". Now Google leads, the 18+ / not-in-WA facts go
 * with the buttons that skip the form, and the choice is counted. Sign-in is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const signIn = vi.fn(async () => undefined)
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signIn(...(a as [])) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth/SocialProviderResolver', () => ({
  isSocialProviderEnabled: (p: string) => p === 'google' || p === 'discord',
}))

import { AuthV4 } from '@/components/core-app/screens/AuthV4'

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
const tracked = () =>
  fetchMock.mock.calls
    .filter((c) => (c as unknown[])[0] === '/api/analytics/track')
    .map((c) => JSON.parse(((c as unknown[])[1] as { body: string }).body))

beforeEach(() => {
  signIn.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('sign-up', () => {
  it('Google comes BEFORE the form, full-labelled', async () => {
    render(<AuthV4 mode="signup" />)
    const google = await screen.findByRole('button', { name: 'Continue with Google' })
    const createAccount = screen.getByRole('button', { name: 'Create account' })
    // DOCUMENT_POSITION_FOLLOWING: the submit button comes after Google in the page.
    expect(google.compareDocumentPosition(createAccount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Or sign up with email')).toBeTruthy()
    expect(screen.queryByText('Or continue with')).toBeNull()
  })

  it('the 18+ / not-in-WA facts sit with the buttons that skip the form', async () => {
    render(<AuthV4 mode="signup" />)
    const lead = await screen.findByTestId('signup-oauth-lead')
    expect(lead.textContent).toContain('adults 18+')
    expect(lead.textContent).toContain('Not available in WA')
    const hrefs = [...lead.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['/terms', '/privacy', '/disclaimer?from=signup']))
  })

  it('counts the choice: a social button, or the email form', async () => {
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('google', expect.anything()))
    expect(tracked()).toEqual([expect.objectContaining({ event: 'signup_method_chosen', meta: { method: 'google' } })])
  })

  it('the email form still works on its own, and is counted as email', async () => {
    render(<AuthV4 mode="signup" />)
    fireEvent.change(await screen.findByPlaceholderText('Your name'), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: 'sam@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('8+ characters'), { target: { value: 'longenough1' } })
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c as unknown[])[0] === '/api/auth/register')).toBe(true))
    expect(tracked().map((e) => e.meta.method)).toEqual(['email'])
  })
})

describe('sign-in is unchanged', () => {
  it('social buttons stay below the form, with no notice and no counting', async () => {
    render(<AuthV4 mode="signin" />)
    // Sign-in's grid labels the tile plainly, under "Or continue with".
    const google = await screen.findByRole('button', { name: 'Google' })
    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Or continue with')).toBeTruthy()
    expect(screen.queryByTestId('signup-oauth-lead')).toBeNull()
    fireEvent.click(google)
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('google', expect.anything()))
    expect(tracked()).toEqual([])
  })
})
