'use client'

/**
 * The matchup picker's own words, in the reader's language (2026-10-03).
 *
 * `page.tsx` is a server component and reads no language, and switching language re-renders only
 * client components — so text it writes inline stays English for a Spanish reader. These pieces are
 * client components for that reason: they follow the language switch at once.
 */
import Link from 'next/link'
import { useMessages } from '@/components/i18n/useMessages'
import { matchupPickerMessages } from '@/lib/core-app/messages/matchupPicker'

export function MatchupPickerBlurb() {
  const m = useMessages(matchupPickerMessages)
  return <>{m.blurb}</>
}

/**
 * Above the picker: a failed all-leagues read says it failed (it must not read like a quiet week),
 * and the explicit all-leagues view links back to the board.
 */
export function MatchupPickerNotice({ failed }: { failed: boolean }) {
  const m = useMessages(matchupPickerMessages)
  if (failed) {
    return (
      <div className="af-card" role="alert" style={{ padding: 16, marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          {m.boardFailed}
        </p>
        <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          {m.failedDetail}
          <a href="/core/matchup">{m.tryAgain}</a>.
        </p>
      </div>
    )
  }
  return (
    <p>
      <Link href="/core/matchup">{m.backToStanding}</Link>
    </p>
  )
}
