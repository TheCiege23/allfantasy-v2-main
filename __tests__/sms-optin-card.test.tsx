import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * The "Get alerts by text" nudge on My Team. It never collects consent itself — it links to
 * Settings › Security, the one flow that records it — and "Not now" snoozes it for 30 days.
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { SmsOptInCard } from '@/components/notifications/SmsOptInCard'

beforeEach(() => window.localStorage.clear())
afterEach(() => cleanup())

describe('SmsOptInCard', () => {
  it('shows for an eligible account and links to the Security consent flow', () => {
    render(<SmsOptInCard eligible />)
    expect(screen.getByTestId('sms-optin-card')).toBeTruthy()
    expect(screen.getByTestId('sms-optin-cta').getAttribute('href')).toBe('/settings?tab=security')
    // No consent button of its own: the only action besides the link is "Not now".
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Not now'])
  })

  it('never shows for an account that has agreed (or a failed read)', () => {
    render(<SmsOptInCard eligible={false} />)
    expect(screen.queryByTestId('sms-optin-card')).toBeNull()
  })

  it('"Not now" hides it and keeps it hidden for 30 days, then it may ask again', () => {
    render(<SmsOptInCard eligible />)
    fireEvent.click(screen.getByTestId('sms-optin-dismiss'))
    expect(screen.queryByTestId('sms-optin-card')).toBeNull()
    cleanup()
    render(<SmsOptInCard eligible />)
    expect(screen.queryByTestId('sms-optin-card')).toBeNull()
    cleanup()
    window.localStorage.setItem('af-sms-optin-dismissed-at', String(Date.now() - 31 * 24 * 60 * 60 * 1000))
    render(<SmsOptInCard eligible />)
    expect(screen.getByTestId('sms-optin-card')).toBeTruthy()
  })
})
