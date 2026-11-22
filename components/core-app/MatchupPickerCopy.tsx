'use client'

/**
 * The matchup picker's own words, in the reader's language (2026-10-03).
 *
 * `page.tsx` is a server component and reads no language, and switching language re-renders only
 * client components — so text it writes inline stays English for a Spanish reader. These pieces are
 * client components for that reason: they follow the language switch at once.
 */
import { useMessages } from '@/components/i18n/useMessages'
import { matchupPickerMessages } from '@/lib/core-app/messages/matchupPicker'

export function MatchupPickerBlurb() {
  const m = useMessages(matchupPickerMessages)
  return <>{m.blurb}</>
}
