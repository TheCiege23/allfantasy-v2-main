'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * "Get alerts by text": a dismissible nudge for accounts that have not agreed to texts (owner's
 * call, 2026-10-03: "opt-in prompt + texts on after consent").
 *
 * 🛑 IT NEVER COLLECTS CONSENT ITSELF — IT LINKS TO THE ONE PLACE THAT DOES. Settings › Security
 * owns the phone + verification + `SmsConsentCheckbox` flow, which records the consent with its
 * exact wording and version (lib/legal/smsProgram). A second "Yes, text me" button here would be a
 * second consent record, and the A2P campaign promises one. This is a signpost, as
 * GameDayAlertsBanner is for push.
 *
 * Once the user agrees, the time-sensitive alerts default to text on their own
 * (SMS_DEFAULT_ON_AFTER_CONSENT_CATEGORY_IDS); this card disappears because the page stops passing
 * `eligible`.
 *
 * Dismissal snoozes for 30 days, not forever: "not now" is not "never ask".
 */

const SNOOZE_KEY = 'af-sms-optin-dismissed-at'
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

function snoozed(now: number): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY))
    return Number.isFinite(at) && at > 0 && now - at < SNOOZE_MS
  } catch {
    return false
  }
}

export function SmsOptInCard({ eligible }: { eligible: boolean }) {
  const { t } = useOptionalLanguage()
  const [show, setShow] = useState(false)

  // Read after mount: localStorage exists only in the browser, so the server render stays empty.
  useEffect(() => {
    setShow(eligible && !snoozed(Date.now()))
  }, [eligible])

  if (!show) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()))
    } catch {
      // Private mode: the card simply comes back next visit.
    }
    setShow(false)
  }

  // The same classes as GameDayAlertsBanner (af-core.css), so the two home nudges read as one system.
  return (
    <div className="af-gdb" role="region" aria-label={t('notifications.smsOptIn.aria')} data-testid="sms-optin-card">
      <div className="af-gdb-body">
        <p className="af-gdb-title">{t('notifications.smsOptIn.title')}</p>
        <p className="af-gdb-sub">{t('notifications.smsOptIn.body')}</p>
      </div>
      <div className="af-gdb-actions">
        <Link href="/settings?tab=security" className="af-gdb-go" data-testid="sms-optin-cta">
          {t('notifications.smsOptIn.cta')}
        </Link>
        <button type="button" onClick={dismiss} className="af-gdb-dismiss" data-testid="sms-optin-dismiss">
          {t('notifications.smsOptIn.notNow')}
        </button>
      </div>
    </div>
  )
}
