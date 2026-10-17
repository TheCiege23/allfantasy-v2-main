'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'

import { normalizeBigBrotherShellLeague } from '@/lib/big-brother/shellLeague'
import type { UserLeague } from '@/app/dashboard/types'
import { BigBrotherStandings } from '@/components/big-brother/BigBrotherStandings'

import { LeagueStandings } from '@/components/standings/LeagueStandings'

export function StandingsTab({ league, tabLabel = 'Standings', idpLeagueUi = false }: { league: UserLeague; tabLabel?: string; idpLeagueUi?: boolean }) {
  if (normalizeBigBrotherShellLeague(league).leagueVariant === 'big_brother') return <BigBrotherStandings key={league.id} leagueId={league.id} />
  return <LeagueStandings key={league.id} leagueId={league.id} initialSeason={Number(league.season) || undefined} title={idpLeagueUi ? 'IDP standings' : tabLabel} />
}
