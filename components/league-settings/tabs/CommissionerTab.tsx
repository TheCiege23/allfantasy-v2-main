'use client'

import { CommissionerControlPanel } from '@/components/league-settings/CommissionerControlPanel'
import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'
import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { LeagueDuesTrackerPanel } from '@/components/league-settings/LeagueDuesTrackerPanel'
import { LeagueHistoryPanel } from '@/components/league-settings/LeagueHistoryPanel'
import { DeleteLeagueFromAfPanel } from '@/app/league/[leagueId]/components/DeleteLeagueFromAfPanel'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

export function CommissionerTab({ ctx }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  return (
    <div className="space-y-10">
      <CommissionerControlPanel leagueId={ctx.league.id} />
      <MemberSettingsCommissionerPanel leagueId={ctx.league.id} />
      <CoOwnerSettingsPanel leagueId={ctx.league.id} />
      <DivisionSettingsCommissionerPanel leagueId={ctx.league.id} />
      <LeagueDuesTrackerPanel leagueId={ctx.league.id} />
      <LeagueHistoryPanel leagueId={ctx.league.id} />

      <section
        data-testid="settings-audit-log-panel"
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/65"
      >
        <p className="mb-2 text-[14px] font-semibold text-white/85">{t('lsModal.card.auditLog')}</p>
        <p>{t('lsHub.audit.body')}</p>
      </section>

      {ctx.isHeadCommissioner ? (
        <DeleteLeagueFromAfPanel
          leagueId={ctx.league.id}
          currentUserId={ctx.userId}
          leagueOwnerUserId={ctx.league.userId}
        />
      ) : (
        <div
          className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-3 text-[12px] leading-relaxed text-white/55"
          data-testid="delete-league-co-comm-notice"
        >
          <strong className="text-white/75">{t('lsHub.removeTitle')}</strong> {t('lsHub.coCommNotice')}
        </div>
      )}
    </div>
  )
}
