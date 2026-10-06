'use client'

import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

export function RostersTab({ ctx }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-white/45">
        {t('lsHub.ro.note')}
      </p>
      <RosterSettingsEditor leagueId={ctx.league.id} />
    </div>
  )
}
