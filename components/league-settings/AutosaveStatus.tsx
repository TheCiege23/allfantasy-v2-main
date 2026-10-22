'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

const SAVED_VISIBLE_MS = 4000

/**
 * The visible half of `useLeagueSettingsSectionAutosave`. Autosaving sections have no Save button,
 * so without this a commissioner cannot tell whether a change took: "Saving…" while the PATCH is in
 * flight, "✓ Saved" for a few seconds after it lands, the error when it fails, and otherwise a quiet
 * "Saves automatically" so the missing button reads as a choice rather than a bug.
 */
export function AutosaveStatus({
  saving,
  savedAt,
  error,
  className = '',
}: {
  saving: boolean
  savedAt: number | null
  error?: string | null
  className?: string
}) {
  const { t } = useLanguage()
  const [recent, setRecent] = useState(false)

  useEffect(() => {
    if (savedAt == null) return
    setRecent(true)
    const timer = setTimeout(() => setRecent(false), SAVED_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [savedAt])

  let tone = 'text-white/40'
  let label = t('lsHub.autosave.idle')
  if (saving) {
    tone = 'text-cyan-300/80'
    label = t('lsHub.saving')
  } else if (error) {
    tone = 'text-rose-300'
    label = error
  } else if (recent) {
    tone = 'text-emerald-300'
    label = t('lsHub.autosave.saved')
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={`shrink-0 text-[11px] font-semibold ${tone} ${className}`}
      data-testid="league-settings-autosave-status"
    >
      {label}
    </span>
  )
}
