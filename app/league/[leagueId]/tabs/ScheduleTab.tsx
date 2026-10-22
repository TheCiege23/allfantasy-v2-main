'use client'

import type { UserLeague } from '@/app/dashboard/types'
import { BigBrotherSchedule } from '@/components/big-brother/BigBrotherSchedule'
import { normalizeBigBrotherShellLeague } from '@/lib/big-brother/shellLeague'
import { CanonicalRedraftScheduleTab } from './redraft/CanonicalRedraftScheduleTab'

export function ScheduleTab({
  league,
  tabLabel = 'Schedule',
  isCommissioner = false,
}: {
  league: UserLeague
  tabLabel?: string
  isCommissioner?: boolean
}) {
  if (normalizeBigBrotherShellLeague(league).leagueVariant === 'big_brother') return <BigBrotherSchedule key={league.id} leagueId={league.id} />
  return <CanonicalRedraftScheduleTab key={league.id} leagueId={league.id} isCommissioner={isCommissioner} />
}
