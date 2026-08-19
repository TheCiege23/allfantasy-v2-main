'use client'

import Link from 'next/link'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, Clock, Crown, Lightbulb, Sparkles } from 'lucide-react'
import type { UserLeague } from '../../types'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { WarRoomCard } from './WarRoomCard'
import { ChampionshipGauge } from './ChampionshipGauge'
import { getLeagueTypeMedia } from '@/lib/league-media/leagueTypeMedia'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HEALTH_BADGE, healthAccentHex } from '@/lib/dashboard/color-grammar'

const SETUP_STAGES = new Set(['setup', 'pre_draft', 'drafting'])

/** Phase 3 — value-graded accent for the composite league-health gauges (Phase 4A: shared token). */
const scoreAccent = healthAccentHex

const HEALTH_BADGE_CLASSES = HEALTH_BADGE

function StatChip({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div
      className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-1.5 text-center"
      style={{ boxShadow: '0 1px 0 0 rgba(255,255,255,0.04) inset' }}
    >
      <p className={`text-[15px] font-black leading-tight ${warn ? 'text-amber-300' : 'text-white'}`}>{value}</p>
      <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/35">{label}</p>
    </div>
  )
}

function QuickActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-2.5 py-2 text-center text-[12px] font-semibold text-amber-100/90 transition hover:-translate-y-0.5 hover:border-amber-400/40 hover:bg-amber-500/[0.1] hover:shadow-[0_6px_16px_-8px_rgba(245,158,11,0.4)]"
    >
      {label}
    </Link>
  )
}

/**
 * Dashboard V2 Phase 2.3 — Commissioner HQ. The primary, single-league composite for
 * Commissioner Focus. Reuses `getCommissionerHubHealthForUser`'s snapshot (same
 * health/recommendations/actions engine as the real `/commissioner-hub` page) rather than
 * a new query, so this is a summary of that same data, not a second source of truth.
 * Deep workflows (force lineup, reverse trade, settings) stay on `/league/[id]` and
 * `/commissioner-hub` — this card only surfaces and deep-links, per the phase's own scope.
 */
export function CommissionerHQ({
  league,
  snapshot,
}: {
  league: UserLeague
  snapshot: CommissionerLeagueHealthSnapshot | null
}) {
  const { t, tInterpolate } = useLanguage()
  const base = `/league/${encodeURIComponent(league.id)}`
  const media = getLeagueTypeMedia(league.leagueType ?? null)

  const setupIncomplete = SETUP_STAGES.has(String(league.lifecycleState ?? league.status ?? ''))
  const pendingTrades = snapshot?.metrics.pendingTrades ?? 0
  const pendingWaivers = snapshot?.metrics.pendingWaiverClaims ?? 0
  const alerts = snapshot?.alerts ?? []
  const recommendations = snapshot?.recommendations ?? []
  const healthStatus = snapshot?.overallStatus ?? 'unknown'

  const actionItems: { key: string; label: string; href: string }[] = []
  if (pendingTrades > 0) {
    actionItems.push({
      key: 'trades',
      label: tInterpolate('dashboard.warroom.commissionerHQ.action.pendingTrades', { n: pendingTrades }),
      href: `${base}?tab=Trades`,
    })
  }
  if (pendingWaivers > 0) {
    actionItems.push({
      key: 'waivers',
      label: tInterpolate('dashboard.warroom.commissionerHQ.action.pendingWaivers', { n: pendingWaivers }),
      href: `${base}?tab=Waivers`,
    })
  }
  if (setupIncomplete) {
    actionItems.push({
      key: 'setup',
      label: t('dashboard.warroom.commissionerHQ.action.setupIncomplete'),
      href: `${base}?tab=Settings`,
    })
  }
  for (const alert of alerts) {
    actionItems.push({ key: `alert-${alert}`, label: alert, href: base })
  }

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(245,158,11,0.28)">
      <div
        className="relative flex items-center gap-3 px-4 py-3.5"
        style={{ background: 'linear-gradient(180deg, rgba(245,158,11,0.07) 0%, transparent 100%)' }}
      >
        <div
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-amber-500/25"
          style={{ boxShadow: '0 0 20px -6px rgba(245,158,11,0.35)' }}
        >
          <Image src={media.thumbnail} alt="" fill sizes="44px" className="object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Crown className="h-3.5 w-3.5 text-amber-400" aria-hidden />
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300/80">
              {t('dashboard.warroom.commissionerHQ.title')}
            </p>
          </div>
          <p className="truncate text-[17px] font-black text-white">{league.name}</p>
        </div>
        {snapshot ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${HEALTH_BADGE_CLASSES[healthStatus] ?? HEALTH_BADGE_CLASSES.unknown}`}
          >
            {t(`dashboard.warroom.health.${healthStatus === 'at_risk' ? 'atRisk' : healthStatus}`)}
          </span>
        ) : null}
      </div>

      {/* 1. Commissioner Action Center */}
      <div className="px-4 py-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
          {t('dashboard.warroom.commissionerHQ.actionCenter.title')}
        </p>
        {actionItems.length > 0 ? (
          <ul className="space-y-1.5">
            {actionItems.slice(0, 5).map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2 rounded-lg bg-amber-500/[0.06] px-2.5 py-1.5 text-[12px] font-semibold text-amber-100/90 transition hover:bg-amber-500/[0.12]"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400/80" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.06] px-2.5 py-2 text-[12px] text-emerald-300/80">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('dashboard.warroom.commissionerHQ.actionCenter.empty')}
          </div>
        )}
      </div>

      {/* 2. League Health Snapshot — subtle tinted band gives the stacked sections rhythm
          without relying on hard gray divider lines. */}
      {snapshot ? (
        <div className="bg-white/[0.015] px-4 py-3.5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
            {t('dashboard.warroom.commissionerHQ.health.title')}
          </p>
          {/* Phase 3 — composite league-health gauges (real 0-100 scores from the health engine,
              already in the SSR snapshot; no new fetch). Turns the previously-invisible composite
              scores into the section's headline visualization. */}
          <div className="mb-3 flex flex-wrap items-center justify-around gap-2 rounded-xl border border-white/[0.05] bg-black/20 px-2 py-3">
            <ChampionshipGauge percent={snapshot.healthScore} label={t('dashboard.warroom.commissionerHQ.health.overallScore')} accent={scoreAccent(snapshot.healthScore)} size={62} />
            {/* Engagement's ring and the "Engagement" StatChip below both read snapshot.engagementScore
                directly (one canonical source) — previously the StatChip read a separate, merely-copied
                metrics.leagueEngagement field with no visual link between the two encodings. */}
            <Link
              href="/commissioner-hub"
              title={t('dashboard.warroom.commissionerHQ.health.engagementWhy')}
              className="rounded-xl transition hover:bg-white/[0.04]"
            >
              <ChampionshipGauge percent={snapshot.engagementScore} label={t('dashboard.warroom.commissionerHQ.health.engagementScore')} accent={scoreAccent(snapshot.engagementScore)} size={62} />
            </Link>
            <ChampionshipGauge percent={snapshot.fairnessScore} label={t('dashboard.warroom.commissionerHQ.health.fairnessScore')} accent={scoreAccent(snapshot.fairnessScore)} size={62} />
            <ChampionshipGauge percent={snapshot.sustainabilityScore} label={t('dashboard.warroom.commissionerHQ.health.sustainabilityScore')} accent={scoreAccent(snapshot.sustainabilityScore)} size={62} />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <StatChip label={t('dashboard.warroom.commissionerHQ.health.activeManagers')} value={snapshot.metrics.activeManagers} />
            <StatChip
              label={t('dashboard.warroom.commissionerHQ.health.inactiveManagers')}
              value={snapshot.metrics.inactiveTeams}
              warn={snapshot.metrics.inactiveTeams > 0}
            />
            <StatChip
              label={t('dashboard.warroom.commissionerHQ.health.lineupRate')}
              value={`${Math.round(snapshot.metrics.lineupSubmissionRate * 100)}%`}
            />
            <StatChip label={t('dashboard.warroom.commissionerHQ.health.tradeActivity')} value={snapshot.metrics.tradeActivity} />
            <StatChip label={t('dashboard.warroom.commissionerHQ.health.waiverActivity')} value={snapshot.metrics.waiverActivity} />
            <StatChip label={t('dashboard.warroom.commissionerHQ.health.engagement')} value={snapshot.engagementScore} />
          </div>
        </div>
      ) : null}

      {/* 3. Commissioner Recommendations — reuses league-health-engine's deterministic
          interventionRecommendations; no new recommendation engine. */}
      <div className="px-4 py-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
          {t('dashboard.warroom.commissionerHQ.recommendations.title')}
        </p>
        {recommendations.length > 0 ? (
          <ul className="space-y-1.5">
            {recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-white/70">
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-cyan-400/70" aria-hidden />
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-2 text-[12px] text-white/40">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-cyan-400/50" aria-hidden />
            {t('dashboard.warroom.commissionerHQ.recommendations.empty')}
          </div>
        )}
      </div>

      {/* 4. League Timeline — honest empty state. No real per-league narrative event feed
          exists today (only internal LeagueAuditLog action slugs like "adjust_scores", not
          user-facing copy) — see the Phase 2.3 PR notes rather than fabricating activity. */}
      <div className="bg-white/[0.015] px-4 py-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
          {t('dashboard.warroom.commissionerHQ.timeline.title')}
        </p>
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-2 text-[12px] text-white/40">
          <Clock className="h-3.5 w-3.5 shrink-0 text-white/25" aria-hidden />
          {t('dashboard.warroom.commissionerHQ.timeline.empty')}
        </div>
      </div>

      {/* 5. Quick Commissioner Actions — deep links into existing functionality only. */}
      <div className="px-4 py-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/30">
          {t('dashboard.warroom.commissionerHQ.quickActions.title')}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <QuickActionButton href={`${base}/settings`} label={t('dashboard.warroom.commissionerHQ.quickActions.settings')} />
          <QuickActionButton href={`${base}/draft`} label={t('dashboard.warroom.commissionerHQ.quickActions.draftRoom')} />
          <QuickActionButton href={`${base}?showInvite=true`} label={t('dashboard.warroom.commissionerHQ.quickActions.inviteManagers')} />
          <QuickActionButton href={`${base}?tab=Players`} label={t('dashboard.warroom.commissionerHQ.quickActions.manageTeams')} />
          <QuickActionButton href={`${base}?tab=Matchups`} label={t('dashboard.warroom.commissionerHQ.quickActions.schedule')} />
          <QuickActionButton href="/commissioner-hub" label={t('dashboard.warroom.commissionerHQ.quickActions.commissionerHub')} />
        </div>
      </div>
    </WarRoomCard>
  )
}
