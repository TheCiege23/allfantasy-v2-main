/**
 * The profile form at /onboarding (2026-11-24, the simplify pass): the avatar presets and the time zone /
 * language pair are closed rows (the whole form fits a 390px phone), and the phone hint is one sentence.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/signup/UsernameAvailabilityService', () => ({
  checkUsernameAvailability: vi.fn(async () => ({ available: true })),
  suggestUsername: vi.fn(async () => 'sam_r'),
}))

import OnboardingForm from '@/app/onboarding/OnboardingForm'

afterEach(cleanup)

function form(phoneVerified = false) {
  return render(
    <OnboardingForm
      defaultName="Sam Rivera"
      defaultUsername=""
      defaultPhone=""
      defaultTimezone="America/New_York"
      defaultLanguage="en"
      defaultAvatarPreset={null}
      currentAvatarUrl={null}
      phoneVerified={phoneVerified}
      isVerified
    />,
  )
}

describe('onboarding profile form', () => {
  it('the avatar presets sit in a closed "Choose an avatar" row', () => {
    form()
    const avatar = screen.getByTestId('onboarding-avatar') as HTMLDetailsElement
    expect(avatar.tagName).toBe('DETAILS')
    expect(avatar.open).toBe(false)
    expect(avatar.querySelector('summary')?.textContent).toContain('Choose an avatar')
    // The presets and the upload are still there, inside the fold.
    expect(avatar.textContent).toContain('Upload image')
  })

  it('time zone and language are one closed row that says what is set; both fields are inside', () => {
    form()
    const locale = screen.getByTestId('onboarding-locale') as HTMLDetailsElement
    expect(locale.open).toBe(false)
    expect(screen.getByTestId('onboarding-locale-value').textContent).toMatch(/·/)
    expect(locale.querySelector('#ob-tz')).not.toBeNull()
    expect(locale.querySelector('#ob-lang')).not.toBeNull()
  })

  it('the phone hint is one flowing sentence, not a flex row the link splits into columns', () => {
    const { container } = form()
    const hint = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes('account recovery'))!
    expect(hint.textContent).toBe('Add a number for account recovery. Verify it for extra security.')
    expect(hint.style.display).not.toBe('inline-flex')
  })
})
