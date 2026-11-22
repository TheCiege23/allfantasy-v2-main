'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { APP_STORE_URL, shouldOfferIosApp } from '@/lib/platform/iosAppStore'
// Same look as the Android prompt (components/league-join/AndroidInviteAppPrompt.tsx).
import '@/components/brackets/android-bracket-app-option.css'

/** Shared with the Android prompt: a device is one platform, so one dismissal covers both. */
const DISMISS_KEY = 'af_join_app_prompt_dismissed'

/**
 * League invite links on an iPhone browser: join here, then get the app on the App Store. The iPhone twin
 * of AndroidInviteAppPrompt, mounted beside it; each shows only on its own platform, and never inside the
 * app. There is no "open in the app" button, because the app does not claim invite links
 * (lib/platform/iosAppStore.ts). Dismissible, and remembered on this device.
 */
export function IosInviteAppPrompt() {
  const { t } = useOptionalLanguage()
  const pathname = usePathname() ?? ''
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!shouldOfferIosApp(navigator.userAgent)) return
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* Storage blocked: show it; dismissing then hides it for this visit only. */
    }
    setShow(true)
  }, [pathname])

  // World Cup bracket invites live under /join/bracket and have their own flow.
  if (!show || pathname.startsWith('/join/bracket')) return null

  const dismiss = () => {
    setShow(false)
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* Hidden for this visit. */
    }
  }

  return (
    <aside className="af-bracket-app-option af-join-app-prompt" data-testid="ios-invite-app-prompt" aria-label={t('join.iosApp.label')}>
      <button type="button" className="af-join-app-prompt__close" onClick={dismiss} aria-label={t('join.iosApp.dismiss')} data-testid="ios-invite-app-dismiss">
        ×
      </button>
      <p>{t('join.iosApp.body')}</p>
      <div className="af-join-app-prompt__actions">
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" data-testid="ios-invite-app-store">{t('join.iosApp.appStore')}</a>
      </div>
    </aside>
  )
}
