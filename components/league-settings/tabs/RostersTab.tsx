'use client'

import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import { TaxiRulesPanel } from '@/components/league-settings/TaxiRulesPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

export function RostersTab({ ctx }: LeagueSettingsTabProps) {
  return (
    <div className="min-w-0 space-y-6">
      <RosterSettingsEditor leagueId={ctx.league.id} sport={ctx.league.sport} />
      {/* Renders nothing outside dynasty leagues that play on AllFantasy. */}
      <TaxiRulesPanel leagueId={ctx.league.id} />
    </div>
  )
}
