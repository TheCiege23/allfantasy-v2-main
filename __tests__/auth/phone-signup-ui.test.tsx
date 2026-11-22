// @vitest-environment jsdom
/**
 * /signup with a phone number instead of an email (2026-11-14): the number is proven by a texted
 * code before the account exists, the account is created as a PHONE sign-up with no email, and
 * the new person is signed in with their phone number and password.
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

const fetchMock = vi.fn(async (url: unknown, _init?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true }),
  text: async () => JSON.stringify(url === '/api/auth/register' ? { ok: true, userId: 'u9' } : { ok: true }),
}))
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

const bodyOf = (url: string) => {
  const call = fetchMock.mock.calls.find((c) => c[0] === url)
  return call ? JSON.parse((call[1] as { body: string }).body) : null
}

function fillPhoneForm() {
  fireEvent.click(screen.getByTestId('signup-use-phone'))
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Pat' } })
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '(201) 555-0123' } })
  fireEvent.change(screen.getByPlaceholderText('8+ characters'), { target: { value: 'goodpass1' } })
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)
}

describe('sign up with a phone number', () => {
  it('texts a code first, then creates a PHONE account with no email and signs in by phone', async () => {
    render(<AuthV4 mode="signup" />)
    await screen.findByTestId('signup-use-phone')
    fillPhoneForm()
    expect(screen.getByText('Email (optional)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    await screen.findByTestId('signup-code-step')
    expect(bodyOf('/api/auth/phone/signup/start')).toEqual({ phone: '(201) 555-0123' })
    expect(bodyOf('/api/auth/register')).toBeNull()

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())

    const reg = bodyOf('/api/auth/register')
    expect(reg).toMatchObject({
      verificationMethod: 'PHONE',
      phone: '(201) 555-0123',
      phoneVerificationCode: '123456',
      displayName: 'Pat',
      password: 'goodpass1',
    })
    expect('email' in reg).toBe(false)
    expect(signIn.mock.calls[0][0]).toBe('credentials')
    expect(signIn.mock.calls[0][1]).toMatchObject({ login: '(201) 555-0123', password: 'goodpass1' })
    await waitFor(() => expect(replace).toHaveBeenCalled())
  })

  it('a short number is caught before any text is sent', async () => {
    render(<AuthV4 mode="signup" />)
    await screen.findByTestId('signup-use-phone')
    fillPhoneForm()
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '555' } })
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/area code/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('switching back to email restores the required email field', async () => {
    render(<AuthV4 mode="signup" />)
    fireEvent.click(await screen.findByTestId('signup-use-phone'))
    fireEvent.click(screen.getByTestId('signup-use-email'))
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy()
  })
})
