'use client'

import type { RookieFilterState } from '@/lib/draft-room/rookieFilterState'

/** Sports whose pool carries stored-season-stats rookie verdicts (`seasonStatsRookieStatus.ts`). */
const VERDICT_SPORTS: ReadonlySet<string> = new Set(['MLB', 'NBA', 'NHL'])

/**
 * Shown on a rookies-only draft whose rookie filter could not be fully applied:
 *
 * - `fallback_no_rookie_data` — the pool carries no rookie data, so the server keeps the full pool
 *   rather than an empty board and veterans are listed.
 * - `partial_rookie_data` (MLB/NBA/NHL) — proven non-rookies were removed, but most players' status
 *   is unknown and they stay on the board.
 *
 * Without this a manager sees veterans on a "rookies only" board with no explanation.
 *
 * ⚠ The copy says picks are NOT checked for rookie status, because in this state they are not:
 * `validateSpecialtyDraftPools` refuses a rookies-only pick only on a server verdict of "not a
 * rookie" (`serverRookieStatus.ts`), and an unknown player has none — so every unknown pick is
 * accepted. In the partial state the proven non-rookies ARE refused, and the copy says that too.
 * MLB/NBA/NHL name the sport; other sports keep the original "this sport" copy.
 */
export function RookieFilterFallbackBanner({
  rookieFilterState,
  t,
  sport,
}: {
  rookieFilterState: RookieFilterState | undefined
  t: (key: string) => string
  sport?: string | null
}) {
  if (rookieFilterState !== 'fallback_no_rookie_data' && rookieFilterState !== 'partial_rookie_data') return null
  const sportKey = String(sport ?? '').trim().toUpperCase()
  const named = VERDICT_SPORTS.has(sportKey)
  const [titleKey, bodyKey] =
    rookieFilterState === 'partial_rookie_data'
      ? ['draftRoom.playerPanel.rookieFilterPartialTitle', 'draftRoom.playerPanel.rookieFilterPartialBody']
      : named
        ? ['draftRoom.playerPanel.rookieFilterFallbackSportTitle', 'draftRoom.playerPanel.rookieFilterFallbackSportBody']
        : ['draftRoom.playerPanel.rookieFilterFallbackTitle', 'draftRoom.playerPanel.rookieFilterFallbackBody']
  const fill = (text: string) => text.split('{{sport}}').join(sportKey || '—')
  return (
    <div
      role="status"
      data-testid="draft-rookie-filter-fallback-banner"
      data-rookie-filter-state={rookieFilterState}
      className="border-b border-violet-400/20 bg-violet-500/[0.08] px-3 py-2"
    >
      <p className="text-[11px] font-semibold text-violet-100">{fill(t(titleKey))}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-white/60">{fill(t(bodyKey))}</p>
    </div>
  )
}
