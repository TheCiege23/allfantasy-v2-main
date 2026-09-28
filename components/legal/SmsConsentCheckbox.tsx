'use client'

import Link from 'next/link'
import {
  SMS_PROGRAM_BRAND,
  SMS_PROGRAM_OPERATOR,
} from '@/lib/legal/smsProgram'

/**
 * SMS opt-in checkbox shown next to every phone-number entry point.
 *
 * ⚠ UNCHECKED BY DEFAULT, AND THAT IS A CARRIER REQUIREMENT, NOT A STYLE CHOICE.
 * A pre-checked box is not consent under CTIA guidelines and gets an A2P campaign
 * rejected. The wording must stay in step with SMS_CONSENT_TEXT in
 * lib/legal/smsProgram.ts — that string is what gets recorded as agreed-to.
 */
export function SmsConsentCheckbox({
  checked,
  onChange,
  id = 'sms-consent',
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  id?: string
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        fontSize: 12,
        lineHeight: 1.5,
        cursor: 'pointer',
        color: 'var(--muted, inherit)',
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, flexShrink: 0 }}
      />
      <span>
        I agree to receive SMS from {SMS_PROGRAM_BRAND} (operated by {SMS_PROGRAM_OPERATOR}),
        including verification codes, account alerts, and optional league notifications. Msg
        frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
        Consent is not a condition of purchase. See our{' '}
        <Link href="/terms#sms-terms" style={{ textDecoration: 'underline' }}>
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy#sms-communications" style={{ textDecoration: 'underline' }}>
          Privacy Policy
        </Link>
        .
      </span>
    </label>
  )
}

export default SmsConsentCheckbox
