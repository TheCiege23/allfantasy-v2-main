import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

export type LeagueSettingsTabProps = {
  ctx: SubPanelContext
  canEdit: boolean
  hasAfCommissionerSub: boolean
}

