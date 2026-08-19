'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Crown, Sparkles, Swords, MessageCircle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { UserLeague } from '../../types'
import { leagueDisplayName } from '@/lib/dashboard/platform-label'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { WarRoomCard } from './WarRoomCard'
import { useGreetingPeriod } from './useGreeting'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { STATUS_TEXT, type StatusTone } from '@/lib/dashboard/color-grammar'
import type { PrimaryContext } from '@/hooks/useFantasyContext'

const EYEBROW_KEY: Record<PrimaryContext, string> = {
  global: 'dashboard.warroom.hero.globalEyebrow',
  commissioner: 'dashboard.warroom.hero.commissionerEyebrow',
  team: 'dashboard.warroom.hero.teamEyebrow',
}

const HEADLINE_KEY: Record<PrimaryContext, string> = {
  global: 'dashboard.warroom.hero.globalHeadline',
  commissioner: 'dashboard.warroom.hero.commissionerHeadline',
  team: 'dashboard.warroom.hero.teamHeadline',
}

type KpiTone = 'default' | 'alert' | 'warn' | 'good'

/** KPI tone → shared status-grammar text color (single source of truth, Phase 4A). */
const KPI_STATUS: Record<KpiTone, StatusTone> = {
  alert: 'critical',
  warn: 'caution',
  good: 'positive',
  default: 'neutral',
}

function toneClass(tone: KpiTone): string {
  return STATUS_TEXT[KPI_STATUS[tone]]
}

/** A single hero KPI — big number + small label. Situational awareness, not navigation. */
function HeroKpi({ label, value, tone = 'default' }: { label: string; value: ReactNode; tone?: KpiTone }) {
  return (
    <div className="min-w-0">
      <p className={`text-[20px] font-black leading-none tabular-nums ${toneClass(tone)}`}>{value}</p>
      <p className="mt-1 truncate text-[9px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
    </div>
  )
}

/** Health-score tone: <40 critical, <55 at-risk, else healthy. */
function scoreTone(score: number): KpiTone {
  if (score < 40) return 'alert'
  if (score < 55) return 'warn'
  return 'good'
}

export interface DashboardHeroProps {
  context: PrimaryContext
  userName: string
  leagues: UserLeague[]
  selectedLeagueId: string | null
  selectedLeague: UserLeague | null
  onSelectLeagueId: (id: string | null) => void
  urgentTodayCount: number
  /** Phase 3.8C — situational-awareness KPIs, all from data already in DashboardOverview memory. */
  leaguesNeedingAttention?: number
  upcomingDraftCount?: number
  /** The selected league's commissioner-health snapshot (Commissioner context). */
  commissionerHealth?: CommissionerLeagueHealthSnapshot | null
  /** Count of lineup/decision actions for the selected team league. */
  teamLineupDecisions?: number
  /** Waiver pickup suggestions for the selected team league. */
  waiverPriority?: number
}

/**
 * Dashboard V2 Phase 3.8C — context heroes. The hero is no longer navigation; it is
 * situational awareness. Each context shows a distinct KPI strip (Global = Mission
 * Control, Commissioner = League Operations, Team = Game Day) fed only by real data
 * already in memory, and the three giant launcher cards collapse into a compact icon
 * action row — shrinking the hero so Platform Pulse sits much higher.
 */
export function DashboardHero({
  context,
  userName,
  leagues,
  selectedLeagueId,
  selectedLeague,
  onSelectLeagueId,
  urgentTodayCount,
  leaguesNeedingAttention = 0,
  upcomingDraftCount = 0,
  commissionerHealth = null,
  teamLineupDecisions = 0,
  waiverPriority = 0,
}: DashboardHeroProps) {
  const { t, tInterpolate } = useLanguage()
  const greetingPeriod = useGreetingPeriod()
  const isCommissionerAnywhere = leagues.some((l) => l.isCommissioner)
  const heroArt = getLeagueTypeMedia(selectedLeague?.leagueType ?? null)

  const openChimmy = () => {
    window.dispatchEvent(new CustomEvent('af-dashboard-focus-left-chimmy'))
    window.dispatchEvent(new CustomEvent('af-dashboard-open-mobile-left'))
  }
  const openComms = () => {
    window.dispatchEvent(new CustomEvent('af-dashboard-open-mobile-left'))
  }

  const kpiStrip = (() => {
    if (context === 'global') {
      return (
        <>
          <HeroKpi label={t('dashboard.warroom.hero.kpi.leagues')} value={leagues.length} />
          <HeroKpi label={t('dashboard.warroom.hero.kpi.urgent')} value={urgentTodayCount} tone={urgentTodayCount > 0 ? 'alert' : 'default'} />
          <HeroKpi label={t('dashboard.warroom.hero.kpi.needAttention')} value={leaguesNeedingAttention} tone={leaguesNeedingAttention > 0 ? 'warn' : 'default'} />
          <HeroKpi label={t('dashboard.warroom.hero.kpi.draftsThisWeek')} value={upcomingDraftCount} tone={upcomingDraftCount > 0 ? 'good' : 'default'} />
        </>
      )
    }
    if (context === 'commissioner') {
      if (!commissionerHealth) {
        return <p className="text-[11px] text-white/40">{t('dashboard.warroom.hero.kpi.healthPending')}</p>
      }
      const h = commissionerHealth
      return (
        <>
          <HeroKpi label={t('dashboard.pulse.metric.health')} value={`${Math.round(h.healthScore)}`} tone={scoreTone(h.healthScore)} />
          <HeroKpi label={t('dashboard.pulse.metric.engagement')} value={`${Math.round(h.engagementScore)}`} tone={scoreTone(h.engagementScore)} />
          <HeroKpi label={t('dashboard.pulse.metric.fairness')} value={`${Math.round(h.fairnessScore)}`} tone={scoreTone(h.fairnessScore)} />
          <HeroKpi label={t('dashboard.pulse.metric.sustainability')} value={`${Math.round(h.sustainabilityScore)}`} tone={scoreTone(h.sustainabilityScore)} />
          <HeroKpi label={t('dashboard.warroom.hero.kpi.pendingActions')} value={h.actions?.length ?? 0} tone={(h.actions?.length ?? 0) > 0 ? 'warn' : 'default'} />
          <HeroKpi label={t('dashboard.warroom.hero.kpi.alerts')} value={h.alerts?.length ?? 0} tone={(h.alerts?.length ?? 0) > 0 ? 'alert' : 'default'} />
        </>
      )
    }
    // team
    return (
      <>
        <HeroKpi label={t('dashboard.warroom.hero.kpi.lineupDecisions')} value={teamLineupDecisions} tone={teamLineupDecisions > 0 ? 'warn' : 'default'} />
        <HeroKpi label={t('dashboard.warroom.hero.kpi.waiverPriority')} value={waiverPriority} tone={waiverPriority > 0 ? 'good' : 'default'} />
        <HeroKpi label={t('dashboard.warroom.hero.kpi.urgent')} value={urgentTodayCount} tone={urgentTodayCount > 0 ? 'alert' : 'default'} />
      </>
    )
  })()

  const NavChip = ({ icon: Icon, label, accent, href, onClick }: { icon: LucideIcon; label: string; accent: string; href?: string; onClick?: () => void }) => {
    const cls = `warroom-pressable inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/80 hover:border-white/20 hover:bg-white/[0.06]`
    const inner = (
      <>
        <Icon className={`h-3.5 w-3.5 ${accent}`} aria-hidden />
        {label}
      </>
    )
    return href ? (
      <Link href={href} className={cls}>{inner}</Link>
    ) : (
      <button type="button" onClick={onClick} className={cls}>{inner}</button>
    )
  }

  return (
    <WarRoomCard className="relative overflow-hidden p-4 sm:p-5" accentBorder="rgba(255,61,129,0.28)">
      {/* Broadcast Deck glow — same pink/orange signature as the league page. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-80"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,61,129,0.16) 0%, transparent 70%)' }} />
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="relative hidden h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#262c6a] bg-white/[0.04] sm:block"
          style={{ boxShadow: '0 0 0 1px rgba(255,61,129,0.14), 0 0 28px -8px rgba(255,61,129,0.5)' }} aria-hidden>
          <Image src={heroArt.thumbnail} alt="" fill sizes="56px" className="object-cover opacity-90" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase italic tracking-[0.14em] text-[#ff8a3d]">{t(EYEBROW_KEY[context])}</p>
            {greetingPeriod ? (
              <p className="text-[11px] font-medium text-white/45">
                {tInterpolate(`dashboard.warroom.hero.greeting.${greetingPeriod}`, { name: userName })}
              </p>
            ) : null}
          </div>
          <h1 className="mt-1 text-[22px] font-black italic leading-[1.1] tracking-tight text-[#f0f2ff] sm:text-[26px]"
            style={{ textShadow: '0 2px 24px rgba(255,61,129,0.18)' }}>
            {t(HEADLINE_KEY[context])}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="league-scope-selector">{t('dashboard.warroom.hero.scopeLabel')}</label>
            <select id="league-scope-selector" value={selectedLeagueId ?? ''}
              onChange={(e) => onSelectLeagueId(e.target.value || null)}
              className="rounded-xl border border-white/10 bg-[#0a1220] px-3 py-1.5 text-[12px] font-semibold text-white/85">
              <option value="">{t('dashboard.warroom.hero.scopeAllLeagues')}</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>{leagueDisplayName(l.name, l.platform)}</option>
              ))}
            </select>
            <span
              data-testid="dashboard-context-indicator"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/50"
            >
              {t(EYEBROW_KEY[context])}
              <span aria-hidden className="text-white/20">·</span>
              <span className="normal-case tracking-normal text-white/60">
                {selectedLeague
                  ? leagueDisplayName(selectedLeague.name, selectedLeague.platform)
                  : t('dashboard.warroom.hero.scopeAllLeagues')}
              </span>
            </span>
          </div>

          {/* Situational-awareness KPI strip — distinct per context, real data only. */}
          <div className="mt-3.5 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-white/[0.06] pt-3.5">
            {kpiStrip}
          </div>

          {/* Compact icon actions — the old giant launcher cards, collapsed to one row. */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <NavChip icon={Swords} accent="text-[#ff3d81]" label={t('dashboard.warroom.hero.navWarRoomTitle')} href="/war-room" />
            <NavChip icon={Crown} accent="text-[#ffc53d]" label={isCommissionerAnywhere ? t('dashboard.warroom.hero.navCommissionerHubTitle') : t('dashboard.warroom.hero.navRunLeagueTitle')} href="/commissioner-hub" />
            <NavChip icon={Sparkles} accent="text-[#ff8a3d]" label={t('dashboard.warroom.hero.navChimmyTitle')} onClick={openChimmy} />
            <NavChip icon={MessageCircle} accent="text-[#7fb3ff]" label={t('dashboard.warroom.hero.navComms')} onClick={openComms} />
          </div>
        </div>
      </div>
    </WarRoomCard>
  )
}
