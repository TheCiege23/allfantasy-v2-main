'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { appLinkHint, appLinkLanding, phoneOs, type AppLinkLanding } from '@/lib/core-app/nativeApp'

/**
 * The line under a platform button that says where the tap will land on THIS
 * phone — "Opens in the Yahoo app when it’s installed", or the honest
 * opposite for Sleeper on an iPhone (lib/core-app/nativeApp.ts holds the
 * measurement). Renders nothing until mounted, so the server and the first
 * client paint agree, and nothing at all on a desktop: the device is read
 * from the user agent, and only a phone gets a claim.
 *
 * Spanish (2026-10-04): the hint is built in the reader's language (`appLinkHint`'s `language`).
 */
export function AppLinkHint({ platform, screen }: { platform: string | null | undefined; screen: string | null | undefined }) {
  const { language } = useOptionalLanguage()
  const [state, setState] = useState<{ hint: string; landing: AppLinkLanding } | null>(null)
  useEffect(() => {
    const os = phoneOs(typeof navigator === 'undefined' ? null : navigator.userAgent)
    const hint = appLinkHint(platform, screen, os, language)
    const landing = appLinkLanding(platform, screen, os)
    setState(hint && landing ? { hint, landing } : null)
  }, [platform, screen, language])
  if (!state) return null
  return (
    <small className="af-pf-app-hint" data-landing={state.landing}>
      {state.hint}
    </small>
  )
}

export default AppLinkHint
