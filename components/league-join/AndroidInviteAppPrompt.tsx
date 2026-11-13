'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'
import { androidAppIntentUrl, PLAY_STORE_URL, shouldOfferAndroidApp } from '@/lib/platform/androidApp'
// The bracket invite's existing Android app option (components/brackets/AndroidBracketAppOption.tsx): same look.
import '@/components/brackets/android-bracket-app-option.css'

const DISMISS_KEY = 'af_join_app_prompt_dismissed'

/**
 * League invite links on an Android browser: open this same invite in the AllFantasy app, or get it on
 * Google Play. iPhone and desktop never see it (they stay on the website), and neither does anyone
 * already inside the app. Dismissible, and remembered on this device.
 *
 * The invite survives both ways: "Open in the app" hands the app this exact URL (code and all), and the
 * page itself is untouched, so signing in on the web still returns through `callbackUrl` as before.
 */
export function AndroidInviteAppPrompt() {
  const { t } = useOptionalLanguage()
  const pathname = usePathname() ?? ''
  const [openHref, setOpenHref] = useState<string | null>(null)

  useEffect(() => {
    if (!shouldOfferAndroidApp({ userAgent: navigator.userAgent, inTrustedWebActivity: isTrustedWebActivity() })) return
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      /* Storage blocked: show it; dismissing then hides it for this visit only. */
    }
    setOpenHref(androidAppIntentUrl(window.location.host, `${window.location.pathname}${window.location.search}`))
  }, [pathname])

  // World Cup bracket invites live under /join/bracket and have their own flow.
  if (!openHref || pathname.startsWith('/join/bracket')) return null

  const dismiss = () => {
    setOpenHref(null)
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* Hidden for this visit. */
    }
  }

  return (
    <aside className="af-bracket-app-option af-join-app-prompt" data-testid="android-invite-app-prompt" aria-label={t('join.androidApp.label')}>
      <button type="button" className="af-join-app-prompt__close" onClick={dismiss} aria-label={t('join.androidApp.dismiss')} data-testid="android-invite-app-dismiss">
        ×
      </button>
      <p>{t('join.androidApp.body')}</p>
      <div className="af-join-app-prompt__actions">
        <a href={openHref} data-testid="android-invite-app-open">{t('join.androidApp.open')}</a>
        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" data-testid="android-invite-app-play">{t('join.androidApp.play')}</a>
      </div>
    </aside>
  )
}
