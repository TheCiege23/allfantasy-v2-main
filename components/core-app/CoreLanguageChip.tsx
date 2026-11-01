'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useSelectLanguage } from '@/components/i18n/LanguageToggle'
import { useMessages } from '@/components/i18n/useMessages'
import { coreLanguageChipMessages } from '@/lib/core-app/messages/coreLanguageChip'
import { getLanguageDisplayName, SELECTABLE_LANGUAGES } from '@/lib/i18n/constants'

/**
 * The language switch, as a top-bar chip beside the theme chip on /core.
 *
 * ⚠ IT USED TO LIVE ONLY IN /settings, which leaves /core — so switching language
 * meant abandoning the screen you were on. /core does not mount GlobalTopNav or the
 * mobile drawer, the two other places the picker renders.
 *
 * A button rather than a <select>: there are two selectable languages, so one tap
 * cycles, and it matches the theme chip's shape. Persistence is the shared
 * `useSelectLanguage`, identical to the settings picker.
 */
export function CoreLanguageChip({ className }: { className?: string }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(coreLanguageChipMessages)
  const selectLanguage = useSelectLanguage()
  const options = SELECTABLE_LANGUAGES
  const at = options.indexOf(language)
  const next = options[(at + 1) % options.length] ?? options[0]
  const current = getLanguageDisplayName(language)
  const label = m.label(current, getLanguageDisplayName(next))

  if (options.length < 2) return null

  return (
    <button
      type="button"
      className={className}
      onClick={() => selectLanguage(next)}
      title={label}
      aria-label={label}
      lang={language}
      suppressHydrationWarning
    >
      {language.toUpperCase()}
    </button>
  )
}

export default CoreLanguageChip
