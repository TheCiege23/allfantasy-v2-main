// @vitest-environment jsdom
/**
 * The optional Partner code box on /signup (2026-11-24). Someone who saw a commissioner's code on a
 * share image and installed the app has no /with/CODE cookie, so typing the code is how they count.
 * Pins: folded away by default, opened and prefilled by ?code=, and sent to /api/auth/register as
 * `partnerCode` only when there is one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const auth = vi.hoisted(() => ({
  signIn: vi.fn(async (..._a: unknown[]) => ({ error: undefined as string | undefined })),
  social: false,
}))
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => auth.signIn(...a) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/auth/SocialProviderResolver', () => ({ isSocialProviderEnabled: (p: string) => auth.social && p === 'google' }))

import { AuthV4 } from '@/components/core-app/screens/AuthV4'

let rememberStatus = 200
const fetchMock = vi.fn(async (url: unknown, _init?: unknown) => {
  if (url === '/api/partner-codes/remember') {
    const ok = rememberStatus === 200
    return {
      ok,
      status: rememberStatus,
      json: async () => (ok ? { ok: true, code: 'TheCiege' } : { error: "We don't recognize that partner code. Check it, or leave the box empty." }),
    }
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
    text: async () => JSON.stringify({ ok: true, userId: 'u1' }),
  }
})
beforeEach(() => {
  fetchMock.mockClear()
  auth.signIn.mockClear()
  auth.social = false
  rememberStatus = 200
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

function registerBody() {
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/register')
  return call ? JSON.parse((call[1] as { body: string }).body) : null
}

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Pat' } })
  fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: 'pat@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('8+ characters'), { target: { value: 'goodpass1' } })
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: /create account/i }))
}

describe('sign-up Partner code box', () => {
  it('is folded away by default and sends no partnerCode', async () => {
    render(<AuthV4 mode="signup" />)
    expect(await screen.findByTestId('signup-partner-code-open')).toBeTruthy()
    expect(screen.queryByTestId('signup-partner-code')).toBeNull()
    fillAndSubmit()
    await waitFor(() => expect(registerBody()).not.toBeNull())
    expect(registerBody()).not.toHaveProperty('partnerCode')
  })

  it('opens on tap and sends what was typed, letters and numbers only', async () => {
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByTestId('signup-partner-code-open'))
    fireEvent.change(screen.getByPlaceholderText('Their code'), { target: { value: 'The Ciege!' } })
    fillAndSubmit()
    await waitFor(() => expect(registerBody()).not.toBeNull())
    expect(registerBody().partnerCode).toBe('TheCiege')
  })

  it('arrives open and prefilled from a /with link (?code=)', async () => {
    window.history.replaceState(null, '', '/signup?code=TheCiege')
    render(<AuthV4 mode="signup" />)
    const input = (await screen.findByPlaceholderText('Their code')) as HTMLInputElement
    expect(input.value).toBe('TheCiege')
    fillAndSubmit()
    await waitFor(() => expect(registerBody()).not.toBeNull())
    expect(registerBody().partnerCode).toBe('TheCiege')
  })
})

describe('the code box with Apple and Google sign-in', () => {
  const calls = () => fetchMock.mock.calls.map((c) => c[0])

  it('sits above the social buttons', async () => {
    auth.social = true
    render(<AuthV4 mode="signup" />)
    const open = await screen.findByTestId('signup-partner-code-open')
    const grid = screen.getByTestId('signup-oauth-lead')
    expect(open.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('saves a typed code before Google opens', async () => {
    auth.social = true
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByTestId('signup-partner-code-open'))
    fireEvent.change(screen.getByPlaceholderText('Their code'), { target: { value: 'TheCiege' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith('google', expect.anything()))
    expect(calls()).toContain('/api/partner-codes/remember')
    const body = JSON.parse((fetchMock.mock.calls.find((c) => c[0] === '/api/partner-codes/remember')![1] as { body: string }).body)
    expect(body).toEqual({ code: 'TheCiege' })
    // Saved first, then the provider: the order is what makes the new account carry the code.
    const rememberAt = fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.findIndex((c) => c[0] === '/api/partner-codes/remember')]
    expect(rememberAt).toBeLessThan(auth.signIn.mock.invocationCallOrder[0])
  })

  it('a code that does not check out stops Google and says why', async () => {
    auth.social = true
    rememberStatus = 400
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByTestId('signup-partner-code-open'))
    fireEvent.change(screen.getByPlaceholderText('Their code'), { target: { value: 'Typo1' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't recognize that partner code/)
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('with no code, Google opens straight away and nothing is saved', async () => {
    auth.social = true
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }))
    await waitFor(() => expect(auth.signIn).toHaveBeenCalled())
    expect(calls()).not.toContain('/api/partner-codes/remember')
  })
})
