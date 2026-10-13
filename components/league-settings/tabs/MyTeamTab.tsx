'use client'

import { SettingsSubPanelBody } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { HubCard } from './hubFields'
import { LeagueLegend } from './LeagueLegend'

/**
 * My Team tab: the commish's OWN team and preferences — team name, avatar and player nicknames,
 * notifications, and the League Legend. Commishes see the settings hub instead of the tile grid,
 * so without this tab these screens were unreachable for them from league settings.
 */
export function MyTeamTab({ ctx }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  return (
    <div className="space-y-6">
      <HubCard title={t('lsModal.card.myTeam')} testId="league-settings-my-team">
        <SettingsSubPanelBody panelId="my-team" ctx={ctx} />
      </HubCard>
      <HubCard title={t('lsModal.card.notifications')}>
        <SettingsSubPanelBody panelId="notifications" ctx={ctx} />
      </HubCard>
      <HubCard title={t('lsHub.lg.title')}>
        <LeagueLegend />
      </HubCard>
    </div>
  )
}
