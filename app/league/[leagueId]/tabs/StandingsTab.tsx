'use client'

import type { UserLeague } from '@/app/dashboard/types'
import { LeagueTabPlaceholder } from './LeagueTabPlaceholder'

export function StandingsTab({
  league,
  tabLabel = 'Standings',
  idpLeagueUi = false,
}: {
  league: UserLeague
  tabLabel?: string
  idpLeagueUi?: boolean
}) {
  if (idpLeagueUi) {
    return (
      <LeagueTabPlaceholder
        league={league}
        tabLabel={tabLabel}
        message="IDP standings are not yet supported for this league format."
      />
    )
  }

  return <LeagueTabPlaceholder league={league} tabLabel={tabLabel} />
}
