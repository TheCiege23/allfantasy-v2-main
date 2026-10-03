import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/*
 * Inputs the settings audit found unnamed: the referral code / link fields (their <label>s were not
 * tied to the inputs) and the delete-account confirm box (placeholder only). A placeholder is not
 * a name — it disappears as you type and many screen readers skip it — so these must resolve by
 * LABEL, which is what getByLabelText / getByRole({ name }) check.
 */

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, error: null, hasAnyPaid: false, isAdminBypassAccount: false }),
}))
vi.mock('@/lib/pwa/signOutAndPurge', () => ({ signOutAndPurge: vi.fn() }))
vi.mock('@/components/referral/ReferralShareBar', () => ({ ReferralShareBar: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { ReferralSection } from '@/components/settings/ReferralSection'
import { AccountSettingsSection } from '@/app/settings/components/sections/AccountSettingsSection'

afterEach(() => vi.unstubAllGlobals())

describe('settings input labels', () => {
  it('names the referral code and link fields by their visible labels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(url.includes('/link') ? { code: 'GUAP42', link: 'https://allfantasy.ai/r/GUAP42' } : {}),
          { status: 200 },
        ),
      ),
    )
    render(<ReferralSection />)
    expect(((await screen.findByLabelText('Your referral code')) as HTMLInputElement).value).toBe('GUAP42')
    expect((screen.getByLabelText('Your referral link') as HTMLInputElement).value).toBe('https://allfantasy.ai/r/GUAP42')
  })

  it('names the delete confirm box and describes what deleting does', () => {
    render(<AccountSettingsSection accountCreatedAt={null} planLabel={null} />)
    fireEvent.click(screen.getByTestId('settings-account-delete-open'))
    const box = screen.getByRole('textbox', { name: 'Type DELETE to confirm' })
    const descId = box.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)?.textContent).toMatch(/DELETE/)
  })
})
