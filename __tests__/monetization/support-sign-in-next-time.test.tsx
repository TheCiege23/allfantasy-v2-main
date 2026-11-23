// @vitest-environment jsdom
/**
 * The support thank-you page's "How do you want to sign in next time?" (app/support/welcome/
 * SignInNextTime). Only fetch and the passkey capability check are faked: the phone calls go
 * through the real lib/security-settings client, so the request bodies asserted here are the ones
 * the server receives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const passkeys = vi.hoisted(() => ({ available: false }))
vi.mock('@/lib/auth/passkey-client', () => ({
  canUsePasskeys: async () => passkeys.available,
  deviceUnlockName: () => 'Face ID',
  addPasskey: vi.fn(),
  hasSavedPasskey: vi.fn(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

import SignInNextTime from '@/app/support/welcome/SignInNextTime'

type Reply = { status: number; body: Record<string, unknown> }
let replies: Record<string, Reply>
const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
  const reply = replies[String(url)] ?? { status: 404, body: {} }
  return new Response(JSON.stringify(reply.body), { status: reply.status })
})
const bodyOf = (url: string) => {
  const call = fetchMock.mock.calls.find(([u]) => u === url)
  return call ? JSON.parse(String(call[1]?.body)) : null
}

beforeEach(() => {
  passkeys.available = false
  replies = {
    '/api/verify/phone/start': { status: 200, body: { ok: true } },
    '/api/verify/phone/check': { status: 200, body: { ok: true } },
  }
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function toPhoneStep() {
  render(<SignInNextTime />)
  fireEvent.click(screen.getByTestId('sign-in-next-time-phone'))
}

describe('sign in next time', () => {
  it('asks one question, with Face ID only where the device can do it', async () => {
    render(<SignInNextTime />)
    expect(screen.getByText('How do you want to sign in next time?')).toBeTruthy()
    expect(screen.getByTestId('sign-in-next-time-phone')).toBeTruthy()
    await Promise.resolve()
    expect(screen.queryByTestId('sign-in-next-time-passkey')).toBeNull()
    cleanup()

    passkeys.available = true
    render(<SignInNextTime />)
    await waitFor(() => expect(screen.getByTestId('sign-in-next-time-passkey').textContent).toContain('Use Face ID'))
  })

  it('texts nothing until the consent box is ticked', async () => {
    await toPhoneStep()
    fireEvent.change(screen.getByTestId('sign-in-next-time-phone-input'), { target: { value: '(555) 123-4567' } })
    fireEvent.click(screen.getByTestId('sign-in-next-time-send'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies the number, recording consent, and then says how to sign in', async () => {
    await toPhoneStep()
    fireEvent.change(screen.getByTestId('sign-in-next-time-phone-input'), { target: { value: '(555) 123-4567' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('sign-in-next-time-send'))

    await screen.findByTestId('sign-in-next-time-code')
    expect(bodyOf('/api/verify/phone/start')).toEqual({ phone: '+15551234567', smsConsent: true, consentSource: 'support_welcome' })
    expect(screen.getByText(/•••-•••-4567/)).toBeTruthy()

    fireEvent.change(screen.getByTestId('sign-in-next-time-code'), { target: { value: '123 456' } })
    fireEvent.click(screen.getByTestId('sign-in-next-time-confirm'))
    const done = await screen.findByTestId('sign-in-next-time-done')
    expect(bodyOf('/api/verify/phone/check')).toEqual({ phone: '+15551234567', code: '123456' })
    expect(done.textContent).toContain('Text me a code')
    expect(done.textContent).toContain('4567')
  })

  it('says so when the number belongs to another account, and stays on the number', async () => {
    replies['/api/verify/phone/start'] = { status: 409, body: { error: 'PHONE_ALREADY_IN_USE' } }
    await toPhoneStep()
    fireEvent.change(screen.getByTestId('sign-in-next-time-phone-input'), { target: { value: '5551234567' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('sign-in-next-time-send'))
    expect((await screen.findByRole('alert')).textContent).toContain('already used by another AllFantasy account')
    expect(screen.getByTestId('sign-in-next-time').getAttribute('data-step')).toBe('phone')
  })

  it('keeps them on the code after a wrong one', async () => {
    replies['/api/verify/phone/check'] = { status: 400, body: { error: 'INVALID_CODE' } }
    await toPhoneStep()
    fireEvent.change(screen.getByTestId('sign-in-next-time-phone-input'), { target: { value: '5551234567' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('sign-in-next-time-send'))
    fireEvent.change(await screen.findByTestId('sign-in-next-time-code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByTestId('sign-in-next-time-confirm'))
    expect((await screen.findByRole('alert')).textContent).toContain("didn't work")
    expect(screen.queryByTestId('sign-in-next-time-done')).toBeNull()
  })

  it('"Not now" closes it without calling anything', () => {
    render(<SignInNextTime />)
    fireEvent.click(screen.getByTestId('sign-in-next-time-skip'))
    expect(screen.queryByTestId('sign-in-next-time')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
