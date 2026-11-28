'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-overview.css'

import { normalizeBigBrotherShellLeague } from '@/lib/big-brother/shellLeague'
import type { UserLeague } from '@/app/dashboard/types'
import { BigBrotherStandings } from '@/components/big-brother/BigBrotherStandings'

import { LeagueStandings } from '@/components/standings/LeagueStandings'
import { CollegeSeasonPanel } from '@/components/c2c/CollegeSeasonPanel'
import { isC2CVariant } from '@/lib/c2c/campusLineup'
import { isDevyVariant } from '@/lib/c2c/collegeLineupLeague'

export function StandingsTab({ league, tabLabel = 'Standings', idpLeagueUi = false }: { league: UserLeague; tabLabel?: string; idpLeagueUi?: boolean }) {
  if (normalizeBigBrotherShellLeague(league).leagueVariant === 'big_brother') return <BigBrotherStandings key={league.id} leagueId={league.id} />
  const standings = <LeagueStandings key={league.id} leagueId={league.id} initialSeason={Number(league.season) || undefined} title={idpLeagueUi ? 'IDP standings' : tabLabel} />
  // NFL C2C on separate standings: the college side's own standings sit under the pro ones (the panel
  // renders nothing for any other league).
  const collegeSide = isC2CVariant(league.leagueVariant) || isDevyVariant(league.leagueVariant) || ['c2c', 'devy'].includes(String(league.leagueType ?? '').toLowerCase())
  if (collegeSide && String(league.sport ?? '').toUpperCase() === 'NFL') return <>{standings}<CollegeSeasonPanel leagueId={league.id} /></>
  return standings
}
