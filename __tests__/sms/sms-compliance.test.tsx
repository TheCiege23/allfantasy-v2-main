import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { hasSmsConsent } from '@/lib/sms/smsConsent'
import { maskPhone, maskPhonesInText } from '@/lib/sms/maskPhone'
import { getDeliveryMethodAvailability } from '@/lib/notification-settings/DeliveryMethodResolver'
import { SMS_CONSENT_TEXT } from '@/lib/legal/smsProgram'
import { SmsConsentCheckbox } from '@/components/legal/SmsConsentCheckbox'

afterEach(cleanup)

const CONSENT = { smsConsent: { consentedAt: '2026-09-01T00:00:00Z', phone: '+12015550123' } }

describe('hasSmsConsent — the stored opt-in, for the number being texted', () => {
  it('is true for the consented number, in any typed form', () => {
    expect(hasSmsConsent(CONSENT, '+12015550123')).toBe(true)
    expect(hasSmsConsent(CONSENT, '2015550123')).toBe(true)
    expect(hasSmsConsent(CONSENT, '12015550123')).toBe(true)
  })

  it('is false with no record, no phone, a different number, or a revoked record', () => {
    expect(hasSmsConsent(null, '+12015550123')).toBe(false)
    expect(hasSmsConsent({}, '+12015550123')).toBe(false)
    expect(hasSmsConsent(CONSENT, null)).toBe(false)
    expect(hasSmsConsent(CONSENT, '+13615550199')).toBe(false)
    expect(hasSmsConsent({ smsConsent: { ...CONSENT.smsConsent, revokedAt: '2026-09-20T00:00:00Z' } }, '+12015550123')).toBe(false)
  })

  it('covers the current number when the record predates storing one', () => {
    expect(hasSmsConsent({ smsConsent: { consentedAt: '2026-09-01T00:00:00Z' } }, '+12015550123')).toBe(true)
  })
})

describe('SMS availability needs consent when the sender supplies it', () => {
  it('is off for a verified phone without consent, on with it', () => {
    expect(getDeliveryMethodAvailability({ hasEmail: true, phoneVerified: true, smsConsented: false }).sms).toBe(false)
    expect(getDeliveryMethodAvailability({ hasEmail: true, phoneVerified: true, smsConsented: true }).sms).toBe(true)
    expect(getDeliveryMethodAvailability({ hasEmail: true, phoneVerified: false, smsConsented: true }).sms).toBe(false)
  })
})

describe('phone masking', () => {
  it('masks numbers inside Twilio-style error text, keeping the last two digits', () => {
    const out = maskPhonesInText("The 'To' number +12015550123 is not a valid phone number")
    expect(out).not.toContain('2015550123')
    expect(out).toContain('***23')
  })

  it('leaves codes, error numbers and ordinary text alone', () => {
    expect(maskPhonesInText('Error 21610: unsubscribed recipient, code 123456')).toBe(
      'Error 21610: unsubscribed recipient, code 123456',
    )
  })

  it('masks a single number', () => {
    expect(maskPhone('+12015550123')).toBe('***23')
    expect(maskPhone(null)).toBeNull()
  })
})

describe('the consent checkbox says exactly what is recorded as agreed-to', () => {
  /*
   * SMS_CONSENT_TEXT is stored with every opt-in as proof of what the user agreed to; the box
   * renders its own copy of the words (with links). This fails the moment the two drift.
   */
  it('renders the same words as SMS_CONSENT_TEXT', () => {
    const { container } = render(<SmsConsentCheckbox checked={false} onChange={() => {}} />)
    const shown = (container.querySelector('label')?.textContent ?? '').replace(/\s+/g, ' ').trim()
    expect(shown).toBe(SMS_CONSENT_TEXT)
  })
})
