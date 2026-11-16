// @vitest-environment jsdom
/**
 * /login: "Text me a code instead" swaps the password form for phone → code, and the
 * header offers the other mode as a button with the rest behind a menu (2026-11-14).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const signIn = vi.fn(async (..._a: unknown[]) => ({ error: undefined as string | undefined }))
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signIn(...a) }))
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

const fetchMock = vi.fn(async (..._a: unknown[]) => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
beforeEach(() => {
  signIn.mockClear()
  replace.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sign in with a text code', () => {
  it('sends the code, then signs in with the phone-code provider', async () => {
    render(<AuthV4 mode="signin" />)
    fireEvent.click(await screen.findByTestId('signin-use-code'))
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '(201) 555-0123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))

    await screen.findByTestId('signin-code-form')
    const [url, init] = fetchMock.mock.calls.find((c) => c[0] === '/api/auth/phone/login/start')!
    expect(url).toBe('/api/auth/phone/login/start')
    expect(JSON.parse((init as { body: string }).body)).toEqual({ phone: '(201) 555-0123' })
    expect(screen.getByRole('status').textContent).toMatch(/If \(201\) 555-0123 is on an AllFantasy account/)

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(signIn.mock.calls[0][0]).toBe('phone-code')
    expect(signIn.mock.calls[0][1]).toMatchObject({ phone: '(201) 555-0123', code: '123456', redirect: false })
    await waitFor(() => expect(replace).toHaveBeenCalled())
  })

  it('a wrong code says so and keeps the person on the code step', async () => {
    signIn.mockResolvedValueOnce({ error: 'CredentialsSignin' })
    render(<AuthV4 mode="signin" />)
    fireEvent.click(await screen.findByTestId('signin-use-code'))
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '2015550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/That code didn’t work/)
    expect(replace).not.toHaveBeenCalled()
  })

  it('a short number is caught before any text is sent, and the password form is one click back', async () => {
    render(<AuthV4 mode="signin" />)
    fireEvent.click(await screen.findByTestId('signin-use-code'))
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '555' } })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/area code/)
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('signin-use-password'))
    expect(screen.getByText('Email, username or phone')).toBeTruthy()
  })
})

describe('auth header', () => {
  it('/login offers Sign up as a button, /signup offers Sign in, and the menu reaches home, demo, pricing, commissioners', async () => {
    const { unmount } = render(<AuthV4 mode="signin" />)
    const up = await screen.findByTestId('auth-switch')
    expect(up.textContent).toBe('Sign up')
    expect(up.getAttribute('href')).toBe('/signup')
    expect(up.closest('details')).toBeNull()
    const menu = [...document.querySelectorAll('.af-au-menu a')].map((a) => a.getAttribute('href'))
    expect(menu).toEqual(['/', '/demo', '/pricing', '/commissioners'])
    unmount()
    render(<AuthV4 mode="signup" />)
    const inn = await screen.findByTestId('auth-switch')
    expect(inn.textContent).toBe('Sign in')
    expect(inn.getAttribute('href')).toBe('/login')
  })

  it('with no social provider enabled, sign-up shows no orphan "Or sign up with email" divider', async () => {
    render(<AuthV4 mode="signup" />)
    await screen.findByRole('button', { name: 'Create account' })
    expect(screen.queryByText('Or sign up with email')).toBeNull()
  })
})
