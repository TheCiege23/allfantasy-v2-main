// @vitest-environment jsdom
/**
 * The optional Partner code box on /signup (2026-11-24). Someone who saw a commissioner's code on a
 * share image and installed the app has no /with/CODE cookie, so typing the code is how they count.
 * Pins: folded away by default, opened and prefilled by ?code=, and sent to /api/auth/register as
 * `partnerCode` only when there is one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ signIn: vi.fn(async () => ({ error: undefined })) }))
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
vi.mock('@/lib/auth/SocialProviderResolver', () => ({ isSocialProviderEnabled: () => false }))

import { AuthV4 } from '@/components/core-app/screens/AuthV4'

const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true }),
  text: async () => JSON.stringify({ ok: true, userId: 'u1' }),
}))
beforeEach(() => {
  fetchMock.mockClear()
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
