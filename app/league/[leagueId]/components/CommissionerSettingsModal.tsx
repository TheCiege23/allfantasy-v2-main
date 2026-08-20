'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { useAutosave } from '@/lib/hooks/useAutosave'
import { LeagueSettingsPanel } from './settings/LeagueSettingsPanel'
import { PlaceholderPanel } from './settings/PlaceholderPanel'
import { TeamSettingsPanel } from './settings/TeamSettingsPanel'
import { PlayoffSettingsPanel } from './settings/PlayoffSettingsPanel'
import { TradeSettingsPanel } from './settings/TradeSettingsPanel'
import { WaiverLeagueSettingsPanel } from './settings/WaiverLeagueSettingsPanel'
import { RosterComplianceSettingsPanel } from './settings/RosterComplianceSettingsPanel'
import { AiLeagueSettingsPanel } from './settings/AiLeagueSettingsPanel'
import { DraftSettingsPanel } from './settings/DraftSettingsPanel'
import { ScheduleSettingsPanel } from './settings/ScheduleSettingsPanel'
import { NotificationsSettingsPanel } from './settings/NotificationsSettingsPanel'
import {
  SettingsNav,
  type SettingsNavTabId,
  isSurvivorSettingsTab,
  isZombieSettingsTab,
  isIdpSettingsTab,
  isDevySettingsTab,
  isC2cSettingsTab,
} from './settings/SettingsNav'
import { IDPRosterPanel } from '@/app/idp/components/settings/IDPRosterPanel'
import { IDPScoringPanel } from '@/app/idp/components/settings/IDPScoringPanel'
import { IDPDisplayPanel } from '@/app/idp/components/settings/IDPDisplayPanel'
import { IDPAIPanel } from '@/app/idp/components/settings/IDPAIPanel'
import { IDPCapPanel } from '@/app/idp/components/settings/IDPCapPanel'
import { KeeperCommissionerDashboard } from './KeeperCommissionerDashboard'
import { SurvivorSetupPanel } from './settings/survivor/SurvivorSetupPanel'
import { SurvivorTribesPanel } from './settings/survivor/SurvivorTribesPanel'
import { SurvivorChallengesPanel } from './settings/survivor/SurvivorChallengesPanel'
import { SurvivorTribalPanel } from './settings/survivor/SurvivorTribalPanel'
import { SurvivorIdolsPanel } from './settings/survivor/SurvivorIdolsPanel'
import { SurvivorExilePanel } from './settings/survivor/SurvivorExilePanel'
import { SurvivorMergeJuryPanel } from './settings/survivor/SurvivorMergeJuryPanel'
import { SurvivorChatPanel } from './settings/survivor/SurvivorChatPanel'
import { SurvivorAIHostPanel } from './settings/survivor/SurvivorAIHostPanel'
import { SurvivorAdvancedPanel } from './settings/survivor/SurvivorAdvancedPanel'
import { ZombieSetupPanel } from '@/app/zombie/components/commissioner/ZombieSetupPanel'
import { ZombieWhispererPanel } from '@/app/zombie/components/commissioner/ZombieWhispererPanel'
import { ZombieCombatPanel } from '@/app/zombie/components/commissioner/ZombieCombatPanel'
import { ZombieItemsPanel } from '@/app/zombie/components/commissioner/ZombieItemsPanel'
import { ZombiePaidPanel } from '@/app/zombie/components/commissioner/ZombiePaidPanel'
import { ZombieUniversePanel } from '@/app/zombie/components/commissioner/ZombieUniversePanel'
import { ZombieUpdatesPanel } from '@/app/zombie/components/commissioner/ZombieUpdatesPanel'
import { ZombieAIPanel } from '@/app/zombie/components/commissioner/ZombieAIPanel'
import { ZombieAnimationsPanel } from '@/app/zombie/components/commissioner/ZombieAnimationsPanel'
import { ZombieAdvancedPanel } from '@/app/zombie/components/commissioner/ZombieAdvancedPanel'
import { DevyFormatPanel } from '@/app/devy/components/settings/DevyFormatPanel'
import { DevyRosterPanel } from '@/app/devy/components/settings/DevyRosterPanel'
import { DevyRulesPanel } from '@/app/devy/components/settings/DevyRulesPanel'
import { DevyTaxiPanel } from '@/app/devy/components/settings/DevyTaxiPanel'
import { DevyDraftsPanel } from '@/app/devy/components/settings/DevyDraftsPanel'
import { DevyImportPanel } from '@/app/devy/components/settings/DevyImportPanel'
import { DevyAIPanel } from '@/app/devy/components/settings/DevyAIPanel'
import { C2CFormatPanel } from '@/app/c2c/components/settings/C2CFormatPanel'
import { C2CRostersPanel } from '@/app/c2c/components/settings/C2CRostersPanel'
import { C2CScoringPanel } from '@/app/c2c/components/settings/C2CScoringPanel'
import { C2CTaxiPanel } from '@/app/c2c/components/settings/C2CTaxiPanel'
import { C2CDevyPanel } from '@/app/c2c/components/settings/C2CDevyPanel'
import { C2CDraftsPanel } from '@/app/c2c/components/settings/C2CDraftsPanel'
import { C2CAIPanel } from '@/app/c2c/components/settings/C2CAIPanel'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'
import { SportConfigSettingsPanel } from './settings/SportConfigSettingsPanel'
import { CommissionerScoringSettingsPanel } from './settings/CommissionerScoringSettingsPanel'
import type { LeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { SubscriptionGateProvider } from '@/hooks/useSubscriptionGate'
import { useEntitlements } from '@/hooks/useEntitlements'
import { MemberSettingsCommissionerPanel } from '@/components/league-settings/MemberSettingsCommissionerPanel'
import { CoOwnerSettingsPanel } from '@/components/league-settings/CoOwnerSettingsPanel'
import { CommissionerControlPanel } from '@/components/league-settings/CommissionerControlPanel'
import { DivisionSettingsCommissionerPanel } from '@/components/league-settings/DivisionSettingsCommissionerPanel'
import { LeaguePreviousSeasonsPanel } from '@/components/league-settings/LeaguePreviousSeasonsPanel'
import { CommissionerLeagueDeletePanel } from '@/components/league-settings/CommissionerLeagueDeletePanel'
import {
  commissionerKeeperSectionHeading,
  showKeeperSelectionInCommissionerSettings,
} from '@/lib/league/keeper-policy'

type ApiGet = {
  userRole: 'commissioner' | 'co_commissioner' | 'member' | null
  /** Head commissioner — `League.userId` */
  leagueOwnerUserId?: string
  hasAfCommissionerSub: boolean
  canEdit: boolean
  /** Raw `League.settings` JSON for merges (description, schedule, notification prefs). */
  settingsSnapshot?: Record<string, unknown>
  league: CommissionerSettingsFormData & Record<string, unknown>
  settings?: Record<string, unknown> | null
  /** Template + overrides for commissioner scoring UI. */
  scoringConfig?: LeagueScoringConfig | null
}

export function CommissionerSettingsModal({
  leagueId,
  isOpen,
  onClose,
}: {
  leagueId: string
  isOpen: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<SettingsNavTabId>('league')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [payload, setPayload] = useState<ApiGet | null>(null)
  const [survivorMode, setSurvivorMode] = useState(false)
  const [tournamentShellId, setTournamentShellId] = useState<string | null>(null)
  const [zombieMode, setZombieMode] = useState(false)
  const [idpLeague, setIdpLeague] = useState(false)
  const [devyMode, setDevyMode] = useState(false)
  const [devyConfig, setDevyConfig] = useState<Record<string, unknown> | null>(null)
  const [c2cMode, setC2cMode] = useState(false)
  const [c2cConfig, setC2cConfig] = useState<C2CConfigClient | null>(null)

  const { status, save, debouncedSave } = useAutosave(leagueId)
  const { hasCommissioner } = useEntitlements()

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setLoadError(false)
    fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ApiGet) => setPayload(data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen) return
    const onSaved = (ev: Event) => {
      const e = ev as CustomEvent<{ leagueId?: string }>
      if (e.detail?.leagueId !== leagueId) return
      fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: ApiGet) => setPayload(data))
        .catch(() => {})
    }
    window.addEventListener('af-league-settings-saved', onSaved as EventListener)
    return () => window.removeEventListener('af-league-settings-saved', onSaved as EventListener)
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen || !leagueId) return
    fetch(`/api/survivor/season?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mode?: boolean } | null) => setSurvivorMode(Boolean(d?.mode)))
      .catch(() => setSurvivorMode(false))
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen || !leagueId) return
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => setZombieMode(r.ok))
      .catch(() => setZombieMode(false))
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen) return
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/idp/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: unknown } | null) => setIdpLeague(Boolean(d?.config)))
      .catch(() => setIdpLeague(false))
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen) return
    fetch(`/api/c2c?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { c2c?: C2CConfigClient } | null) => {
        if (d?.c2c) {
          setC2cMode(true)
          setC2cConfig(d.c2c)
        } else {
          setC2cMode(false)
          setC2cConfig(null)
        }
      })
      .catch(() => {
        setC2cMode(false)
        setC2cConfig(null)
      })
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen) return
    fetch(`/api/devy?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: Record<string, unknown> } | null) => {
        if (d?.config) {
          setDevyMode(true)
          setDevyConfig(d.config)
        } else {
          setDevyMode(false)
          setDevyConfig(null)
        }
      })
      .catch(() => {
        setDevyMode(false)
        setDevyConfig(null)
      })
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!isOpen) {
      setTournamentShellId(null)
      return
    }
    fetch(`/api/league/detail?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: Record<string, unknown> } | null) => {
        const sid =
          data?.settings && typeof data.settings.tournamentShellId === 'string'
            ? data.settings.tournamentShellId
            : null
        setTournamentShellId(sid)
      })
      .catch(() => setTournamentShellId(null))
  }, [isOpen, leagueId])

  useEffect(() => {
    if (!survivorMode && isSurvivorSettingsTab(activeTab)) {
      setActiveTab('league')
    }
  }, [survivorMode, activeTab])

  useEffect(() => {
    if (!zombieMode && isZombieSettingsTab(activeTab)) {
      setActiveTab('league')
    }
  }, [zombieMode, activeTab])

  useEffect(() => {
    if (!idpLeague && isIdpSettingsTab(activeTab)) {
      setActiveTab('league')
    }
  }, [idpLeague, activeTab])

  useEffect(() => {
    if (!devyMode && isDevySettingsTab(activeTab)) {
      setActiveTab('league')
    }
  }, [devyMode, activeTab])

  useEffect(() => {
    if (!c2cMode && isC2cSettingsTab(activeTab)) {
      setActiveTab('league')
    }
  }, [c2cMode, activeTab])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const canEdit = payload?.canEdit ?? false
  const hasSub = hasCommissioner || (payload?.hasAfCommissionerSub ?? false)
  const initialData = payload?.league as CommissionerSettingsFormData | undefined

  const showKeeperSessionStrip = showKeeperSelectionInCommissionerSettings({
    leagueType: initialData?.leagueType ?? null,
    isDynasty: initialData?.isDynasty ?? null,
  })
  const keeperSectionTitle = commissionerKeeperSectionHeading({
    leagueType: initialData?.leagueType ?? null,
    isDynasty: initialData?.isDynasty ?? null,
  })

  const survivorProps = { leagueId, canEdit, hasAfCommissionerSub: hasSub }

  return (
    <SubscriptionGateProvider>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commissioner-settings-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex h-[100dvh] w-full max-w-[min(1120px,100vw)] flex-col overflow-hidden rounded-none border border-white/[0.1] bg-[#0a0f18] shadow-2xl md:h-[min(88vh,920px)] md:max-h-[920px] md:rounded-[24px] md:flex-row">
        <h2 id="commissioner-settings-title" className="sr-only">
          Commissioner settings
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-[15px] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white md:right-4 md:top-4"
          aria-label="Close settings"
        >
          ✕
        </button>

        <SettingsNav
          activeTab={activeTab}
          onSelect={setActiveTab}
          saveStatus={status}
          showSurvivorTabs={survivorMode}
          showZombieTabs={zombieMode}
          showIdpTabs={idpLeague}
          showDevyTabs={devyMode}
          showC2cTabs={c2cMode}
        />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-white/[0.06] bg-[#0c111c] md:border-l md:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {tournamentShellId ? (
            <div className="border-b border-[#ff3d81]/25 bg-[#ff3d81]/10 px-4 py-3 text-[12px] text-[#ffe9f1]">
              <p className="font-semibold text-white">
                Managing tournament league ·{' '}
                {payload?.league && typeof (payload.league as { name?: string }).name === 'string'
                  ? (payload.league as { name?: string }).name
                  : 'This league'}
              </p>
              <p className="mt-1 text-[11px] text-[#ffd7e5]/80">
                Linked to a Tournament Shell — open the hub for national-style navigation and shell commissioner
                tools.
              </p>
              <Link
                href={`/tournament/${tournamentShellId}`}
                className="mt-2 inline-flex font-semibold text-[#ff9ec0] underline hover:text-[#ffb8d1]"
                data-testid="commissioner-tournament-hub-link"
              >
                Manage full tournament settings →
              </Link>
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-3 px-6 py-8">
              <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
              <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
              <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
            </div>
          ) : loadError || !initialData ? (
            <div className="px-6 py-10 text-center text-[13px] text-red-400">
              Could not load league settings. Try again.
            </div>
          ) : activeTab === 'league' ? (
            <LeagueSettingsPanel
              leagueId={leagueId}
              initialData={initialData}
              settingsSnapshot={payload?.settingsSnapshot ?? {}}
              hasAfCommissionerSub={hasSub}
              canEdit={canEdit}
              save={save}
              debouncedSave={debouncedSave}
            />
          ) : activeTab === 'team' ? (
            <TeamSettingsPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'roster' ? (
            <RosterComplianceSettingsPanel initialData={initialData} canEdit={canEdit} debouncedSave={debouncedSave} />
          ) : activeTab === 'scoring' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <CommissionerScoringSettingsPanel
                key={String((initialData as Record<string, unknown>).sport ?? 'NFL')}
                leagueId={leagueId}
                sport={String((initialData as Record<string, unknown>).sport ?? 'NFL')}
                canEdit={canEdit}
                scoringConfig={payload?.scoringConfig ?? null}
              />
              <details className="border-t border-white/[0.06] bg-[#0a0f18]/40">
                <summary className="cursor-pointer px-6 py-3 text-[12px] font-semibold text-[#ffb8d1]/80">
                  League format, roster slots & advanced sport config
                </summary>
                <SportConfigSettingsPanel
                  sport={String((initialData as Record<string, unknown>).sport ?? 'NFL')}
                  leagueSettings={initialData as Record<string, unknown>}
                  canEdit={canEdit}
                  onSportConfigChange={(next) => debouncedSave({ sportConfig: next })}
                  omitSections={{ scoring: true }}
                />
              </details>
            </div>
          ) : activeTab === 'draft' ? (
            <DraftSettingsPanel
              draftRow={payload?.settings ?? null}
              canEdit={canEdit}
              save={save}
              debouncedSave={debouncedSave}
            />
          ) : activeTab === 'divisions' ? (
            <div className="px-6 py-6">
              <DivisionSettingsCommissionerPanel leagueId={leagueId} />
            </div>
          ) : activeTab === 'members' ? (
            <div className="px-6 py-6">
              <MemberSettingsCommissionerPanel leagueId={leagueId} />
            </div>
          ) : activeTab === 'coowners' ? (
            <div className="px-6 py-6">
              <CoOwnerSettingsPanel leagueId={leagueId} />
            </div>
          ) : activeTab === 'trade' ? (
            <TradeSettingsPanel initialData={initialData} canEdit={canEdit} debouncedSave={debouncedSave} save={save} />
          ) : activeTab === 'waiver' ? (
            <WaiverLeagueSettingsPanel leagueId={leagueId} initialData={initialData} canEdit={canEdit} debouncedSave={debouncedSave} />
          ) : activeTab === 'playoff' ? (
            <PlayoffSettingsPanel initialData={initialData} canEdit={canEdit} debouncedSave={debouncedSave} />
          ) : activeTab === 'schedule' ? (
            <ScheduleSettingsPanel
              settingsSnapshot={payload?.settingsSnapshot ?? {}}
              canEdit={canEdit}
              debouncedSave={debouncedSave}
            />
          ) : activeTab === 'ai' ? (
            <AiLeagueSettingsPanel
              leagueId={leagueId}
              settingsSnapshot={payload?.settingsSnapshot ?? {}}
              initialData={initialData}
              canEdit={canEdit}
              debouncedSave={debouncedSave}
              save={save}
              hasAfCommissionerSub={hasSub}
            />
          ) : activeTab === 'notifications' ? (
            <NotificationsSettingsPanel
              settingsSnapshot={payload?.settingsSnapshot ?? {}}
              canEdit={canEdit}
              save={save}
            />
          ) : activeTab === 'dues' ? (
            <PlaceholderPanel title="Payments / League Dues" subtitle="Buy-ins, deadlines, and tracked payouts." />
          ) : activeTab === 'import_sync' ? (
            <PlaceholderPanel title="Import / Sync" subtitle="Provider mapping, refresh, and conflict handling." />
          ) : activeTab === 'advanced' ? (
            <PlaceholderPanel title="Advanced Rules" subtitle="Overrides, offseason mode, and custom enforcement." />
          ) : activeTab === 'appearance' ? (
            <PlaceholderPanel title="Appearance / Branding" subtitle="League visuals and discovery presentation." />
          ) : activeTab === 'security' ? (
            <PlaceholderPanel title="Security / Permissions" subtitle="Who can change what, audit, and locks." />
          ) : activeTab === 'draft_picks' ? (
            <PlaceholderPanel title="Draft Pick Settings" subtitle="Future picks, years traded, and display rules." />
          ) : activeTab === 'integrations' ? (
            <PlaceholderPanel title="Integrations" subtitle="External tools and webhooks (when enabled)." />
          ) : activeTab === 'commissioner' ? (
            <div className="space-y-8 px-6 py-6">
              {showKeeperSessionStrip ? (
                <section className="space-y-3">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                    {keeperSectionTitle}
                  </h3>
                  <KeeperCommissionerDashboard leagueId={leagueId} />
                </section>
              ) : null}
              <section className={showKeeperSessionStrip ? 'border-t border-white/[0.08] pt-6' : ''}>
                {showKeeperSessionStrip ? (
                  <h3 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-white/40">
                    Commissioner tools
                  </h3>
                ) : null}
                <CommissionerControlPanel leagueId={leagueId} />
              </section>
            </div>
          ) : activeTab === 'previous' ? (
            <div className="px-6 py-6">
              <LeaguePreviousSeasonsPanel
                leagueId={leagueId}
                sportLabel={String((initialData as Record<string, unknown>).sport ?? '')}
                leagueFormatLabel={initialData?.leagueType ? String(initialData.leagueType) : null}
              />
            </div>
          ) : activeTab === 'delete' ? (
            <div className="px-6 py-6">
              <CommissionerLeagueDeletePanel
                leagueId={leagueId}
                leagueName={String((initialData as Record<string, unknown>).name ?? 'League')}
                leagueOwnerUserId={payload?.leagueOwnerUserId ?? ''}
                userRole={payload?.userRole ?? null}
                settingsSnapshot={payload?.settingsSnapshot ?? {}}
              />
            </div>
          ) : activeTab === 'survivor_setup' ? (
            <SurvivorSetupPanel {...survivorProps} />
          ) : activeTab === 'survivor_tribes' ? (
            <SurvivorTribesPanel {...survivorProps} />
          ) : activeTab === 'survivor_challenges' ? (
            <SurvivorChallengesPanel {...survivorProps} />
          ) : activeTab === 'survivor_tribal' ? (
            <SurvivorTribalPanel {...survivorProps} />
          ) : activeTab === 'survivor_idols' ? (
            <SurvivorIdolsPanel {...survivorProps} />
          ) : activeTab === 'survivor_exile' ? (
            <SurvivorExilePanel {...survivorProps} />
          ) : activeTab === 'survivor_merge' ? (
            <SurvivorMergeJuryPanel {...survivorProps} />
          ) : activeTab === 'survivor_chat' ? (
            <SurvivorChatPanel {...survivorProps} />
          ) : activeTab === 'survivor_ai' ? (
            <SurvivorAIHostPanel {...survivorProps} initialData={initialData} debouncedSave={debouncedSave} />
          ) : activeTab === 'survivor_advanced' ? (
            <SurvivorAdvancedPanel {...survivorProps} />
          ) : activeTab === 'zombie_setup' ? (
            <ZombieSetupPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'zombie_whisperer' ? (
            <ZombieWhispererPanel canEdit={canEdit} />
          ) : activeTab === 'zombie_combat' ? (
            <ZombieCombatPanel canEdit={canEdit} />
          ) : activeTab === 'zombie_items' ? (
            <ZombieItemsPanel canEdit={canEdit} />
          ) : activeTab === 'zombie_paid' ? (
            <ZombiePaidPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'zombie_universe' ? (
            <ZombieUniversePanel canEdit={canEdit} />
          ) : activeTab === 'zombie_updates' ? (
            <ZombieUpdatesPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'zombie_animations' ? (
            <ZombieAnimationsPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'zombie_advanced' ? (
            <ZombieAdvancedPanel leagueId={leagueId} canEdit={canEdit} />
          ) : activeTab === 'zombie_ai' ? (
            <ZombieAIPanel hasAfSub={hasSub} />
          ) : activeTab === 'idp_roster' ? (
            <IDPRosterPanel />
          ) : activeTab === 'idp_scoring' ? (
            <IDPScoringPanel />
          ) : activeTab === 'idp_display' ? (
            <IDPDisplayPanel />
          ) : activeTab === 'idp_ai' ? (
            <IDPAIPanel leagueId={leagueId} hasAfSub={hasSub} isCommissioner={payload?.canEdit ?? false} />
          ) : activeTab === 'idp_cap' ? (
            <IDPCapPanel />
          ) : activeTab === 'devy_format' ? (
            <DevyFormatPanel config={devyConfig} />
          ) : activeTab === 'devy_roster' ? (
            <DevyRosterPanel config={devyConfig} />
          ) : activeTab === 'devy_rules' ? (
            <DevyRulesPanel config={devyConfig} />
          ) : activeTab === 'devy_taxi' ? (
            <DevyTaxiPanel config={devyConfig} />
          ) : activeTab === 'devy_drafts' ? (
            <DevyDraftsPanel config={devyConfig} />
          ) : activeTab === 'devy_import' ? (
            <DevyImportPanel leagueId={leagueId} />
          ) : activeTab === 'devy_ai' ? (
            <DevyAIPanel leagueId={leagueId} hasAfSub={hasSub} isCommissioner={canEdit} />
          ) : activeTab === 'c2c_format' ? (
            <C2CFormatPanel config={c2cConfig} canEdit={canEdit} />
          ) : activeTab === 'c2c_rosters' ? (
            <C2CRostersPanel config={c2cConfig} canEdit={canEdit} />
          ) : activeTab === 'c2c_scoring' ? (
            <C2CScoringPanel config={c2cConfig} />
          ) : activeTab === 'c2c_taxi' ? (
            <C2CTaxiPanel />
          ) : activeTab === 'c2c_devy' ? (
            <C2CDevyPanel config={c2cConfig} />
          ) : activeTab === 'c2c_drafts' ? (
            <C2CDraftsPanel config={c2cConfig} />
          ) : activeTab === 'c2c_ai' ? (
            <C2CAIPanel leagueId={leagueId} hasAfSub={hasSub} c2cConfig={c2cConfig} isCommissioner={canEdit} />
          ) : (
            <PlaceholderPanel title="Settings" />
          )}
          </div>
        </div>
      </div>
    </div>
    </SubscriptionGateProvider>
  )
}
