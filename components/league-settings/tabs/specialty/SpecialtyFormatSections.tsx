'use client'

/**
 * One section per specialty format, each made of the editors that format already has. Loaded only
 * for the formats a league runs (SpecialtyTab imports this module per format with next/dynamic).
 *
 * Only editors that PERSIST are listed. ZombieWhisperer/Combat/Items/Universe panels are inputs
 * with hard-coded defaults and no save path, so they stay out; the rules they gestured at are edited
 * by ZombieRulesForm (rendered above the Zombie section), which the live engines actually read.
 */
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { SurvivorSetupPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorSetupPanel'
import { SurvivorTribesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribesPanel'
import { SurvivorChallengesPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorChallengesPanel'
import { SurvivorTribalPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorTribalPanel'
import { SurvivorIdolsPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorIdolsPanel'
import { SurvivorExilePanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorExilePanel'
import { SurvivorMergeJuryPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorMergeJuryPanel'
import { SurvivorChatPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorChatPanel'
import { SurvivorAdvancedPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorAdvancedPanel'
import { ZombieSetupPanel } from '@/app/zombie/components/commissioner/ZombieSetupPanel'
import { ZombiePaidPanel } from '@/app/zombie/components/commissioner/ZombiePaidPanel'
import { ZombieUpdatesPanel } from '@/app/zombie/components/commissioner/ZombieUpdatesPanel'
import { ZombieAnimationsPanel } from '@/app/zombie/components/commissioner/ZombieAnimationsPanel'
import { ZombieAdvancedPanel } from '@/app/zombie/components/commissioner/ZombieAdvancedPanel'
import { BigBrotherSettingsPanel } from '@/components/big-brother/BigBrotherSettingsPanel'
import { DevyLeagueSettingsHub } from '@/components/devy/settings/DevyLeagueSettingsHub'
import { C2CFormatPanel } from '@/app/c2c/components/settings/C2CFormatPanel'
import { C2CRostersPanel } from '@/app/c2c/components/settings/C2CRostersPanel'
import { C2CScoringPanel } from '@/app/c2c/components/settings/C2CScoringPanel'
import { C2CTaxiPanel } from '@/app/c2c/components/settings/C2CTaxiPanel'
import { C2CDevyPanel } from '@/app/c2c/components/settings/C2CDevyPanel'
import { C2CDraftsPanel } from '@/app/c2c/components/settings/C2CDraftsPanel'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

export type FormatSectionProps = {
  ctx: SubPanelContext
  canEdit: boolean
  coveredBySubscription: boolean
}

/** A collapsible sub-section, closed by default so a long format reads as a menu first. */
function Sub({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-2xl border border-white/[0.08] bg-[#0a1228]/70 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[13px] font-semibold text-white/85">
        {title}
        <span className="text-white/35 transition group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-white/[0.06]">{children}</div>
    </details>
  )
}

export function SurvivorSection({ ctx, canEdit, coveredBySubscription }: FormatSectionProps) {
  const { t } = useLanguage()
  const p = { leagueId: ctx.league.id, canEdit, hasAfCommissionerSub: coveredBySubscription }
  return (
    <div className="space-y-2">
      <Sub title={t('lsHub.sp.s.setup')} defaultOpen><SurvivorSetupPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.tribes')}><SurvivorTribesPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.challenges')}><SurvivorChallengesPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.torch')}><SurvivorTribalPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.idols')}><SurvivorIdolsPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.exile')}><SurvivorExilePanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.merge')}><SurvivorMergeJuryPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.s.chat')}><SurvivorChatPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.advanced')}><SurvivorAdvancedPanel {...p} /></Sub>
    </div>
  )
}

export function ZombieSection({ ctx, canEdit }: FormatSectionProps) {
  const { t } = useLanguage()
  const p = { leagueId: ctx.league.id, canEdit }
  return (
    <div className="space-y-2">
      <Sub title={t('lsHub.sp.z.setup')} defaultOpen><ZombieSetupPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.z.paid')}><ZombiePaidPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.z.updates')}><ZombieUpdatesPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.z.animations')}><ZombieAnimationsPanel {...p} /></Sub>
      <Sub title={t('lsHub.sp.advanced')}><ZombieAdvancedPanel {...p} /></Sub>
    </div>
  )
}

export function BigBrotherSection({ ctx, canEdit }: FormatSectionProps) {
  return <BigBrotherSettingsPanel leagueId={ctx.league.id} isCommissioner={canEdit} />
}

export function DevySection({ ctx }: FormatSectionProps) {
  return <DevyLeagueSettingsHub ctx={ctx} />
}

export function C2CSection({ ctx, canEdit }: FormatSectionProps) {
  const { t } = useLanguage()
  const [config, setConfig] = useState<C2CConfigClient | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/c2c?leagueId=${encodeURIComponent(ctx.league.id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { c2c?: C2CConfigClient } | null) => {
        if (!cancelled) setConfig(d?.c2c ?? null)
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [ctx.league.id])
  return (
    <div className="space-y-2">
      <Sub title={t('lsHub.sp.c.format')} defaultOpen><C2CFormatPanel config={config} canEdit={canEdit} /></Sub>
      <Sub title={t('lsHub.sp.c.rosters')}><C2CRostersPanel config={config} canEdit={canEdit} /></Sub>
      <Sub title={t('lsHub.sp.c.scoring')}><C2CScoringPanel config={config} /></Sub>
      <Sub title={t('lsHub.sp.c.taxi')}><C2CTaxiPanel /></Sub>
      <Sub title={t('lsHub.sp.c.devy')}><C2CDevyPanel config={config} /></Sub>
      <Sub title={t('lsHub.sp.c.drafts')}><C2CDraftsPanel config={config} /></Sub>
    </div>
  )
}

/**
 * A legacy tournament's leagues are run from its hub. A TournamentShell feeder league gets the
 * in-place editor instead (TournamentSettingsForm), so this is the fallback.
 */
export function TournamentSection({ ctx }: FormatSectionProps) {
  const { t } = useLanguage()
  const settings = (ctx.league.settings ?? {}) as Record<string, unknown>
  const shellId = typeof settings.tournamentShellId === 'string' ? settings.tournamentShellId : null
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/70 p-4 text-[13px] leading-relaxed text-white/70">
      <p>{t('lsHub.sp.t.body')}</p>
      {shellId ? (
        <Link
          href={`/tournament/${shellId}`}
          className="mt-3 inline-flex font-semibold text-cyan-200 underline-offset-2 hover:underline"
          data-testid="specialty-tournament-hub-link"
        >
          {t('lsHub.sp.t.open')}
        </Link>
      ) : null}
    </div>
  )
}
