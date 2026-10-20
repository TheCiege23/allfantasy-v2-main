'use client'

import type { RookieFilterState } from '@/lib/draft-room/rookieFilterState'

/**
 * Shown on a rookies-only draft whose pool carries no rookie flags (`fallback_no_rookie_data`):
 * the server keeps the full pool rather than an empty board, so veterans are listed. Without this
 * a manager sees veterans on a "rookies only" board with no explanation.
 *
 * ⚠ The copy says picks are NOT checked for rookie status, because in this state they are not:
 * `validateSpecialtyDraftPools` refuses a rookies-only pick only when the pick's metadata says
 * `isRookie: false` (or a non-zero `yearsExperience`), and the draft room sends `isRookie: true`
 * or nothing — so with no rookie data every pick is accepted.
 */
export function RookieFilterFallbackBanner({
  rookieFilterState,
  t,
}: {
  rookieFilterState: RookieFilterState | undefined
  t: (key: string) => string
}) {
  if (rookieFilterState !== 'fallback_no_rookie_data') return null
  return (
    <div
      role="status"
      data-testid="draft-rookie-filter-fallback-banner"
      className="border-b border-violet-400/20 bg-violet-500/[0.08] px-3 py-2"
    >
      <p className="text-[11px] font-semibold text-violet-100">
        {t('draftRoom.playerPanel.rookieFilterFallbackTitle')}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-white/60">
        {t('draftRoom.playerPanel.rookieFilterFallbackBody')}
      </p>
    </div>
  )
}
