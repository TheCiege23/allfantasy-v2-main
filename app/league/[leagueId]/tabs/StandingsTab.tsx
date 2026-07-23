'use client'

import type { UserLeague } from '@/app/dashboard/types'
import { LeagueTabPlaceholder } from './LeagueTabPlaceholder'

/**
 * Standings tab for non-redraft league shells.
 *
 * Honesty Pack 1A: this tab previously rendered a hardcoded MOCK table of sample teams and
 * scores for IDP leagues — fabricated managers and points presented as a live standings table,
 * softened only by a small "illustrative" footnote. Real IDP standings have no wired data
 * source yet, so the IDP variant now renders an honest unavailable state instead. Real IDP
 * format support (routes, scoring config) is untouched; only the fabricated rendering is gone.
 */
export function StandingsTab({
  league,
  tabLabel = 'Standings',
  idpLeagueUi = false,
}: {
  league: UserLeague
  tabLabel?: string
  idpLeagueUi?: boolean
}) {
  if (!idpLeagueUi) {
    return <LeagueTabPlaceholder league={league} tabLabel={tabLabel} />
  }

  return (
    <div className="space-y-3 p-5" data-testid="idp-standings-unavailable">
      <h3 className="text-base font-black text-white">IDP standings unavailable</h3>
      <p className="max-w-md text-sm text-white/60">
        Standings will appear after this league has imported or recorded real IDP scoring
        data. This surface never displays sample teams or illustrative scores.
      </p>
    </div>
  )
}
