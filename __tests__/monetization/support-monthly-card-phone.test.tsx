// @vitest-environment jsdom
/**
 * The optional phone box on the /support card (app/support/SupportMonthlyCard): a number typed
 * here is handed to the thank-you page in sessionStorage (lib/monetization/supportPhoneHandoff),
 * never sent to Stripe, and only with the SMS consent box ticked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const auth = vi.hoisted(() => ({ status: 'unauthenticated' as 'unauthenticated' | 'authenticated' }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: auth.status }), signIn: vi.fn() }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
vi.mock('@/lib/platform/isTrustedWebActivity', () => ({ isTrustedWebActivity: () => false }))
vi.mock('@/lib/monetization/google-play-client', () => ({ useGooglePlayPrices: () => ({ prices: {} }) }))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn(async () => ({ ok: true, url: '/x' })) }))

import SupportMonthlyCard from '@/app/support/SupportMonthlyCard'

const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ code: 'stop_here' }), { status: 400 }))
const stored = () => window.sessionStorage.getItem('af:support-phone')

beforeEach(() => {
  auth.status = 'unauthenticated'
  window.sessionStorage.clear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function agreeAndPay() {
  fireEvent.click(screen.getByTestId('support-monthly-agree'))
  fireEvent.click(screen.getByTestId('support-monthly-button'))
}

describe('support card phone box', () => {
  it('is optional: blank goes straight to payment and leaves nothing behind', async () => {
    window.sessionStorage.setItem('af:support-phone', 'stale')
    render(<SupportMonthlyCard />)
    expect(screen.queryByRole('checkbox', { name: /SMS/i })).toBeNull() // no consent box until a number is typed
    agreeAndPay()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/monetization/checkout/support-guest', expect.anything()))
    expect(stored()).toBeNull()
  })

  it('will not pay on with a number but no consent', async () => {
    render(<SupportMonthlyCard />)
    fireEvent.change(screen.getByTestId('support-monthly-phone-input'), { target: { value: '(201) 555-0123' } })
    agreeAndPay()
    expect((await screen.findByRole('alert')).textContent).toContain('text-message box')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored()).toBeNull()
  })

  it('hands the number to the thank-you page, and does not send it to Stripe', async () => {
    render(<SupportMonthlyCard />)
    fireEvent.change(screen.getByTestId('support-monthly-phone-input'), { target: { value: '(201) 555-0123' } })
    fireEvent.click(document.getElementById('support-monthly-sms-consent')!)
    agreeAndPay()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(stored()!)).toEqual({ phone: '(201) 555-0123', smsConsent: true })
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('555')
  })

  it('turns away a number we cannot text before paying — +1 is not enough (Jamaica)', async () => {
    render(<SupportMonthlyCard />)
    fireEvent.change(screen.getByTestId('support-monthly-phone-input'), { target: { value: '+1 876 555 0123' } })
    fireEvent.click(document.getElementById('support-monthly-sms-consent')!)
    agreeAndPay()
    expect((await screen.findByRole('alert')).textContent).toContain('US and Canadian')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored()).toBeNull()
  })

  it('refuses a number that is too short', async () => {
    render(<SupportMonthlyCard />)
    fireEvent.change(screen.getByTestId('support-monthly-phone-input'), { target: { value: '555 1234' } })
    fireEvent.click(document.getElementById('support-monthly-sms-consent')!)
    agreeAndPay()
    expect((await screen.findByRole('alert')).textContent).toContain('area code')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is not offered to someone already signed in', () => {
    auth.status = 'authenticated'
    render(<SupportMonthlyCard />)
    expect(screen.queryByTestId('support-monthly-phone')).toBeNull()
  })
})
