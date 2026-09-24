'use client'

import { useState } from 'react'
import { SmsConsentCheckbox } from '@/components/legal/SmsConsentCheckbox'

/**
 * A working copy of the phone-number form, shown on the public Terms page (#sms-opt-in).
 *
 * ⚠ IT EXISTS FOR CARRIER REVIEW, AND IT LIVES ON A LEGAL PAGE ON PURPOSE. The real
 * opt-in (Settings → Security, and the Phone tab on /verify) sits behind sign-in or the
 * state and VPN gates in middleware.ts. /terms is exempt from both, so an A2P reviewer
 * anywhere, including a blocked state, can see the exact box. It renders the SAME
 * SmsConsentCheckbox the app uses, so the wording cannot drift from what users agree to.
 * It sends nothing: the phone field is read-only and the button only explains itself.
 */
export function SmsOptInExample() {
  const [checked, setChecked] = useState(false)
  const [pressed, setPressed] = useState(false)

  return (
    <div
      role="group"
      aria-label="Example of the SMS opt-in form"
      style={{
        marginTop: 12,
        padding: 16,
        maxWidth: 440,
        display: 'grid',
        gap: 12,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 }}>
        Example · the form as it appears in the app
      </span>
      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        Mobile number
        <input
          type="tel"
          readOnly
          placeholder="+1 555 123 4567"
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'transparent',
            color: 'inherit',
          }}
        />
      </label>
      <SmsConsentCheckbox
        id="terms-sms-consent-example"
        checked={checked}
        onChange={(next) => {
          setChecked(next)
          setPressed(false)
        }}
      />
      <button
        type="button"
        disabled={!checked}
        onClick={() => setPressed(true)}
        style={{
          justifySelf: 'start',
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'transparent',
          color: 'inherit',
          opacity: checked ? 1 : 0.45,
          cursor: checked ? 'pointer' : 'not-allowed',
        }}
      >
        Text me a code
      </button>
      {pressed ? (
        <p role="status" style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
          This is an example, so nothing was sent. Add your number in Settings → Security.
        </p>
      ) : null}
    </div>
  )
}

export default SmsOptInExample
