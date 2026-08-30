'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import GeneralSettingsPanel from '@/components/app/settings/GeneralSettingsPanel'
import TeamSettingsPanel from '@/components/app/settings/TeamSettingsPanel'
import RosterSettingsPanel from '@/components/app/settings/RosterSettingsPanel'
import ScoringSettingsPanel from '@/components/app/settings/ScoringSettingsPanel'
import TradeSettingsPanel from '@/components/app/settings/TradeSettingsPanel'
import DraftSettingsPanel from '@/components/app/settings/DraftSettingsPanel'
import AISettingsPanel from '@/components/app/settings/AISettingsPanel'
import AutomationSettingsPanel from '@/components/app/settings/AutomationSettingsPanel'
import WaiverSettingsPanel from '@/components/app/settings/WaiverSettingsPanel'
import PlayoffSettingsPanel from '@/components/app/settings/PlayoffSettingsPanel'
import ScheduleSettingsPanel from '@/components/app/settings/ScheduleSettingsPanel'
import DivisionSettingsPanel from '@/components/app/settings/DivisionSettingsPanel'
import MemberSettingsPanel from '@/components/app/settings/MemberSettingsPanel'
import CommissionerControlsPanel from '@/components/app/settings/CommissionerControlsPanel'
import LeaguePrivacyAndInvitesPanel from '@/components/app/settings/LeaguePrivacyAndInvitesPanel'
import BehaviorProfilesPanel from '@/components/app/settings/BehaviorProfilesPanel'
import LeagueDramaPanel from '@/components/app/settings/LeagueDramaPanel'
import ReputationPanel from '@/components/app/settings/ReputationPanel'
import GMEconomyPanel from '@/components/app/settings/GMEconomyPanel'
import RulesInfoPanel from '@/components/app/settings/RulesInfoPanel'
import LeagueTemplatesPanel from '@/components/app/settings/LeagueTemplatesPanel'
import LeagueImportPanel from '@/components/app/settings/LeagueImportPanel'
import PreviousLeaguesPanel from '@/components/app/settings/PreviousLeaguesPanel'
import ResetLeaguePanel from '@/components/app/settings/ResetLeaguePanel'
import DeleteLeaguePanel from '@/components/app/settings/DeleteLeaguePanel'
import { DevySettingsPanel } from '@/components/devy/DevySettingsPanel'
import { MergedDevyC2CCommissionerSettings } from '@/components/merged-devy-c2c/MergedDevyC2CCommissionerSettings'
import { BigBrotherSettingsPanel } from '@/components/big-brother/BigBrotherSettingsPanel'
import { IDPSettingsPanel } from '@/components/idp/IDPSettingsPanel'
import { IDPAIPanel } from '@/app/idp/components/settings/IDPAIPanel'
import DynastySettingsPanel from '@/components/app/settings/DynastySettingsPanel'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

const SUBTABS_BASE = [
  'General',
  'Templates',
  'League Import',
  'Privacy & invites',
  'Team Settings',
  'Roster Settings',
  'Scoring Settings',
  'Trade Settings',
  'Dynasty Settings',
  'Draft Settings',
  'AI Settings',
  'Automation Settings',
  'Waiver Settings',
  'Playoff Settings',
  'Schedule Settings',
  'Division Settings',
  'Member Settings',
  'Commissioner Controls',
  'Behavior Profiles',
  'League Drama',
  'Reputation',
  'GM Economy',
  'Rules & Info',
  'Previous Leagues',
  'Reset League',
  'Delete League',
] as const

const SUBTABS = [...SUBTABS_BASE, 'Devy Settings', 'C2C Settings', 'Big Brother Settings', 'IDP Settings'] as const
type SettingsSubtab = (typeof SUBTABS)[number]

const SUBTAB_I18N: Record<SettingsSubtab, string> = {
  General: 'league.appSettings.subtab.general',
  Templates: 'league.appSettings.subtab.templates',
  'League Import': 'league.appSettings.subtab.leagueImport',
  'Privacy & invites': 'league.appSettings.subtab.privacyInvites',
  'Team Settings': 'league.appSettings.subtab.teamSettings',
  'Roster Settings': 'league.appSettings.subtab.rosterSettings',
  'Scoring Settings': 'league.appSettings.subtab.scoringSettings',
  'Trade Settings': 'league.appSettings.subtab.tradeSettings',
  'Dynasty Settings': 'league.appSettings.subtab.dynastySettings',
  'Draft Settings': 'league.appSettings.subtab.draftSettings',
  'AI Settings': 'league.appSettings.subtab.aiSettings',
  'Automation Settings': 'league.appSettings.subtab.automationSettings',
  'Waiver Settings': 'league.appSettings.subtab.waiverSettings',
  'Playoff Settings': 'league.appSettings.subtab.playoffSettings',
  'Schedule Settings': 'league.appSettings.subtab.scheduleSettings',
  'Division Settings': 'league.appSettings.subtab.divisionSettings',
  'Member Settings': 'league.appSettings.subtab.memberSettings',
  'Commissioner Controls': 'league.appSettings.subtab.commissionerControls',
  'Behavior Profiles': 'league.appSettings.subtab.behaviorProfiles',
  'League Drama': 'league.appSettings.subtab.leagueDrama',
  Reputation: 'league.appSettings.subtab.reputation',
  'GM Economy': 'league.appSettings.subtab.gmEconomy',
  'Rules & Info': 'league.appSettings.subtab.rulesInfo',
  'Previous Leagues': 'league.appSettings.subtab.previousLeagues',
  'Reset League': 'league.appSettings.subtab.resetLeague',
  'Delete League': 'league.appSettings.subtab.deleteLeague',
  'Devy Settings': 'league.appSettings.subtab.devySettings',
  'C2C Settings': 'league.appSettings.subtab.c2cSettings',
  'Big Brother Settings': 'league.appSettings.subtab.bigBrotherSettings',
  'IDP Settings': 'league.appSettings.subtab.idpSettings',
}

/** Subtabs visible to non-commissioners (read-only / team & info). Commissioner sees full list per league type. */
const MEMBER_SETTINGS_SUBTABS = new Set<SettingsSubtab>([
  'General',
  'Team Settings',
  'Rules & Info',
  'Previous Leagues',
])

export default function LeagueSettingsTab({
  leagueId,
  isDynasty,
  isDevyDynasty,
  isMergedDevyC2C,
  isBigBrother,
  isIdp,
  isCommissioner = false,
}: LeagueTabProps & { isDynasty?: boolean; isDevyDynasty?: boolean; isMergedDevyC2C?: boolean; isBigBrother?: boolean; isIdp?: boolean; isCommissioner?: boolean }) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const searchParams = useSearchParams()
  const [active, setActive] = useState<SettingsSubtab>('General')
  const showDynastySettings = !!(isDynasty || isDevyDynasty || isMergedDevyC2C)
  const visibleSubtabs = SUBTABS.filter(
    (tab) =>
      (tab !== 'Dynasty Settings' || showDynastySettings) &&
      (tab !== 'Devy Settings' || isDevyDynasty) &&
      (tab !== 'C2C Settings' || isMergedDevyC2C) &&
      (tab !== 'Big Brother Settings' || isBigBrother) &&
      (tab !== 'IDP Settings' || isIdp) &&
      (isCommissioner || MEMBER_SETTINGS_SUBTABS.has(tab)),
  )

  const syncSettingsTabInUrl = useCallback(
    (tab: SettingsSubtab) => {
      const nextParams = new URLSearchParams(searchParams?.toString() ?? '')
      nextParams.set('tab', 'Settings')
      nextParams.set('settingsTab', tab)
      const nextQuery = nextParams.toString()
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    const requested = String(searchParams?.get('settingsTab') ?? '').trim()
    if (!requested) {
      if (!visibleSubtabs.includes(active)) {
        const fallback = visibleSubtabs[0]
        if (fallback) setActive(fallback)
      }
      return
    }
    const requestedLower = requested.toLowerCase()
    const resolved = visibleSubtabs.find((tab) => tab.toLowerCase() === requestedLower)
    if (!resolved) {
      const fallback = visibleSubtabs[0]
      if (fallback) {
        setActive(fallback)
        syncSettingsTabInUrl(fallback)
      }
      return
    }
    setActive((prev) => (prev === resolved ? prev : resolved))
  }, [active, searchParams, visibleSubtabs, syncSettingsTabInUrl])

  return (
    <section className="space-y-4">
      <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-2">
        {visibleSubtabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActive(tab)
              syncSettingsTabInUrl(tab)
            }}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition ${active === tab ? 'bg-white text-black' : 'border border-white/10 bg-black/20 text-white/75 hover:bg-white/10'}`}
          >
            {t(SUBTAB_I18N[tab])}
          </button>
        ))}
      </div>

      {active === 'General' && <GeneralSettingsPanel leagueId={leagueId} />}
      {active === 'Templates' && <LeagueTemplatesPanel leagueId={leagueId} />}
      {active === 'League Import' && <LeagueImportPanel leagueId={leagueId} />}
      {active === 'Privacy & invites' && <LeaguePrivacyAndInvitesPanel leagueId={leagueId} />}
      {active === 'Team Settings' && <TeamSettingsPanel />}
      {active === 'Roster Settings' && <RosterSettingsPanel leagueId={leagueId} />}
      {active === 'Scoring Settings' && <ScoringSettingsPanel leagueId={leagueId} />}
      {active === 'Trade Settings' && <TradeSettingsPanel leagueId={leagueId} />}
      {active === 'Dynasty Settings' && (
        <DynastySettingsPanel leagueId={leagueId} isCommissioner={!!isCommissioner} />
      )}
      {active === 'Draft Settings' && <DraftSettingsPanel leagueId={leagueId} />}
      {active === 'AI Settings' && <AISettingsPanel leagueId={leagueId} />}
      {active === 'Automation Settings' && <AutomationSettingsPanel leagueId={leagueId} />}
      {active === 'Waiver Settings' && <WaiverSettingsPanel leagueId={leagueId} />}
      {active === 'Playoff Settings' && <PlayoffSettingsPanel leagueId={leagueId} />}
      {active === 'Schedule Settings' && <ScheduleSettingsPanel leagueId={leagueId} />}
      {active === 'Division Settings' && <DivisionSettingsPanel />}
      {active === 'Member Settings' && <MemberSettingsPanel leagueId={leagueId} />}
      {active === 'Commissioner Controls' && <CommissionerControlsPanel leagueId={leagueId} />}
      {active === 'Behavior Profiles' && <BehaviorProfilesPanel leagueId={leagueId} />}
      {active === 'League Drama' && <LeagueDramaPanel leagueId={leagueId} />}
      {active === 'Reputation' && <ReputationPanel leagueId={leagueId} />}
      {active === 'GM Economy' && <GMEconomyPanel leagueId={leagueId} />}
      {active === 'Rules & Info' && <RulesInfoPanel />}
      {active === 'Previous Leagues' && <PreviousLeaguesPanel />}
      {active === 'Reset League' && <ResetLeaguePanel leagueId={leagueId} />}
      {active === 'Delete League' && <DeleteLeaguePanel />}
      {active === 'Devy Settings' && isDevyDynasty && (
        <DevySettingsPanel leagueId={leagueId} isCommissioner={!!isCommissioner} />
      )}
      {active === 'C2C Settings' && isMergedDevyC2C && (
        <MergedDevyC2CCommissionerSettings leagueId={leagueId} />
      )}
      {active === 'Big Brother Settings' && isBigBrother && (
        <BigBrotherSettingsPanel leagueId={leagueId} isCommissioner={!!isCommissioner} />
      )}
      {active === 'IDP Settings' && isIdp && (
        <div className="space-y-2">
          <IDPSettingsPanel leagueId={leagueId} isCommissioner={!!isCommissioner} />
          <IDPAIPanel leagueId={leagueId} isCommissioner={!!isCommissioner} />
        </div>
      )}
    </section>
  )
}
