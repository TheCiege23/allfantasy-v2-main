'use client'

import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'
import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSubPanelBody } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { HubCard } from './hubFields'

/**
 * Members tab: who is in the league and who helps run it — invite, members, co-commishes and
 * co-owners, divisions. (Was three tabs — Members, Permissions and Commish — all rendering the same panels.)
 */
export function MembersTab({ ctx }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  return (
    <div className="space-y-10">
      <HubCard title={t('lsModal.card.invite')} testId="league-settings-invite">
        <SettingsSubPanelBody panelId="invite" ctx={ctx} />
      </HubCard>
      <MemberSettingsCommissionerPanel leagueId={ctx.league.id} />
      <CoOwnerSettingsPanel leagueId={ctx.league.id} />
      <DivisionSettingsCommissionerPanel leagueId={ctx.league.id} />
      <section className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/65">
        <p className="mb-2 text-[14px] font-semibold text-white/85">{t('lsHub.notif.title')}</p>
        <p>{t('lsHub.notif.body')}</p>
      </section>
    </div>
  )
}
