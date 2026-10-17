'use client'

import { DraftSettingsCommissionerPanel } from '@/components/league-settings/DraftSettingsCommissionerPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

export function DraftTab({ ctx, hasAfCommissionerSub }: LeagueSettingsTabProps) {
  return (
    <DraftSettingsCommissionerPanel
      leagueId={ctx.league.id}
      hasAfCommissionerSub={hasAfCommissionerSub || Boolean(ctx.hasAfCommissionerSub)}
    />
  )
}
