'use client'

import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

export function RostersTab({ ctx }: LeagueSettingsTabProps) {
  return (
    <div className="min-w-0">
      <RosterSettingsEditor leagueId={ctx.league.id} sport={ctx.league.sport} />
    </div>
  )
}
