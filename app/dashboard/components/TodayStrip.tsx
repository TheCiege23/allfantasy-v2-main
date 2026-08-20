'use client'

import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardList,
  Sparkles,
  Sword,
  Zap,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { UserLeague } from '../types'

export type LineupChipState = 'loading' | 'issues' | 'clear'

export type TodayStripProps = {
  leagues: UserLeague[]
  lineupChipState: LineupChipState
  /** Primary label — must match what `displayCount` represents (usually unresolved lineup decisions). */
  lineupPrimaryLabel: string
  /** Secondary line, e.g. “Across 4 leagues”. */
  lineupSubtext?: string | null
  /** Optional urgency hint, e.g. “3 lock soon”. */
  lineupUrgentHint?: string | null
  /** Accessible + hover explanation for the lineup chip. */
  lineupTooltip?: string
  onLineupIssuesClick: () => void
  /**
   * Sum of trending pickup suggestions across leagues (not FAAB claims).
   * Primary waiver chip count — do not mix with injury rows.
   */
  waiverPickupSuggestions: number
  onWaiverClick: () => void
  /** Lineup scan: injured / questionable / doubtful starter decisions (not generic “lineups to set”). */
  lineupInjuryDecisionsToReview: number
  /** DB injury report rows for user league sports (recent window). */
  injuryReportRowsInUserSports: number
  onInjuryClick: () => void
  /** Matchup Prep module actions from lineup engine. */
  matchupPrepDecisionsToReview: number
  /** Leagues with WeeklyMatchup rows synced for the user’s roster. */
  leaguesWithSyncedMatchupData: number
  onMatchupPrepClick: () => void
  pendingTradeCount: number
  onTradesClick: () => void
  /** AF War Room sourced lineup actions when present. */
  warRoomDecisionsToReview: number
  onWarRoomClick: () => void
  /**
   * Optional time-authority hint from `aiTimeContext` (device vs account TZ, locks).
   * Omit when unavailable — do not invent copy.
   */
  timeAuthorityHint?: string | null
  /**
   * When DB resolves league waiver process time — never “tonight” without a computed instant.
   */
  waiverTimingHint?: string | null
  /** Informational only — real auto-swap counts from `/api/dashboard/today-actions`. */
  protectionActivityHint?: string | null
}

/**
 * Attention items for "Today" — chips open lazy-loaded modals or AI tools when wired.
 */
export function TodayStrip({
  leagues,
  lineupChipState,
  lineupPrimaryLabel,
  lineupSubtext,
  lineupUrgentHint,
  lineupTooltip,
  onLineupIssuesClick,
  waiverPickupSuggestions,
  onWaiverClick,
  lineupInjuryDecisionsToReview,
  injuryReportRowsInUserSports,
  onInjuryClick,
  matchupPrepDecisionsToReview,
  leaguesWithSyncedMatchupData,
  onMatchupPrepClick,
  pendingTradeCount,
  onTradesClick,
  warRoomDecisionsToReview,
  onWarRoomClick,
  timeAuthorityHint,
  waiverTimingHint,
  protectionActivityHint,
}: TodayStripProps) {
  const { t, tInterpolate } = useLanguage()

  if (leagues.length === 0) {
    return null
  }

  const waiverChipLabel =
    waiverPickupSuggestions > 0
      ? waiverPickupSuggestions === 1
        ? t('dashboard.today.waiverRecOne')
        : tInterpolate('dashboard.today.waiverRecs', { n: waiverPickupSuggestions })
      : t('dashboard.today.checkWaivers')

  const waiverChipHighlighted = waiverPickupSuggestions > 0

  const tradeChipLabel =
    pendingTradeCount > 0
      ? pendingTradeCount === 1
        ? t('dashboard.today.pendingTradeOne')
        : tInterpolate('dashboard.today.pendingTrades', { n: pendingTradeCount })
      : t('dashboard.today.checkTrades')

  const lineupChipTooltip = lineupTooltip ?? t('dashboard.today.lineupChipTooltipDefault')

  const showInjuryChip = lineupInjuryDecisionsToReview > 0 || injuryReportRowsInUserSports > 0
  const injuryChipLabel =
    lineupInjuryDecisionsToReview > 0
      ? lineupInjuryDecisionsToReview === 1
        ? t('dashboard.today.injuryLineupDecisionOne')
        : tInterpolate('dashboard.today.injuryLineupDecisionMany', {
            n: lineupInjuryDecisionsToReview,
          })
      : injuryReportRowsInUserSports === 1
        ? t('dashboard.today.injuryReportFeedOne')
        : tInterpolate('dashboard.today.injuryReportFeedMany', {
            n: injuryReportRowsInUserSports,
          })

  const showMatchupChip = matchupPrepDecisionsToReview > 0 || leaguesWithSyncedMatchupData > 0
  const matchupChipLabel =
    matchupPrepDecisionsToReview > 0
      ? matchupPrepDecisionsToReview === 1
        ? t('dashboard.today.matchupPrepDecisionOne')
        : tInterpolate('dashboard.today.matchupPrepDecisionMany', {
            n: matchupPrepDecisionsToReview,
          })
      : leaguesWithSyncedMatchupData === 1
        ? t('dashboard.today.matchupDataLeaguesOne')
        : tInterpolate('dashboard.today.matchupDataLeaguesMany', {
            n: leaguesWithSyncedMatchupData,
          })

  const warRoomChipLabel =
    warRoomDecisionsToReview > 0
      ? warRoomDecisionsToReview === 1
        ? t('dashboard.today.warRoomActionOne')
        : tInterpolate('dashboard.today.warRoomActionMany', { n: warRoomDecisionsToReview })
      : t('dashboard.today.warRoomOpen')

  const matchupHighlighted = matchupPrepDecisionsToReview > 0
  const injuryHighlighted = lineupInjuryDecisionsToReview > 0

  // Count of chips that are actively asking for attention.
  const attentionCount =
    (waiverChipHighlighted ? 1 : 0) +
    (lineupChipState === 'issues' ? 1 : 0) +
    (pendingTradeCount > 0 ? 1 : 0) +
    (injuryHighlighted ? 1 : 0) +
    (matchupHighlighted ? 1 : 0) +
    (warRoomDecisionsToReview > 0 ? 1 : 0)
  const allClear = attentionCount === 0 && lineupChipState !== 'loading'

  return (
    <section
      className="relative space-y-2 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[#0c1126] via-[#0a0e22] to-[#0d0a22] p-3 shadow-[0_4px_22px_-12px_rgba(0,0,0,0.7)]"
      aria-label={t('dashboard.today.title')}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-cyan-500/8 blur-3xl"
      />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
              allClear
                ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-300'
                : attentionCount > 0
                  ? 'border-amber-400/35 bg-amber-500/12 text-amber-300'
                  : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-300'
            }`}
          >
            {allClear ? <CheckCircle2 className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-black uppercase tracking-[0.14em] text-white">
              {t('dashboard.today.title')}
            </p>
            <p className="text-[10px] font-medium leading-tight text-white/40">
              {allClear
                ? t('dashboard.today.allClear')
                : attentionCount === 1
                  ? t('dashboard.today.attentionOne')
                  : tInterpolate('dashboard.today.attentionMany', { count: attentionCount })}
            </p>
          </div>
        </div>
        {attentionCount > 0 ? (
          <span
            className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/15 px-2 text-[11px] font-extrabold tabular-nums text-amber-200"
            aria-label={tInterpolate('dashboard.today.attentionAria', { count: attentionCount })}
          >
            {attentionCount}
          </span>
        ) : null}
      </div>

      {timeAuthorityHint ? (
        <p className="relative text-[10px] leading-snug text-sky-200/55" role="status">
          {timeAuthorityHint}
        </p>
      ) : null}
      {waiverTimingHint ? (
        <p className="relative text-[10px] leading-snug text-cyan-200/55" role="status">
          {waiverTimingHint}
        </p>
      ) : null}
      {protectionActivityHint ? (
        <p className="relative text-[10px] leading-snug text-emerald-200/55" role="status">
          {protectionActivityHint}
        </p>
      ) : null}

      <div className="scrollbar-none relative -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        <button
          type="button"
          onClick={onWaiverClick}
          data-testid="today-waivers-chip"
          className={
            waiverChipHighlighted
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-[13px] font-semibold text-cyan-200 shadow-[0_0_14px_-4px_rgba(34,211,238,0.5)] transition hover:border-cyan-400/55 hover:bg-cyan-500/22'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/55 transition hover:border-white/15 hover:bg-white/[0.08] hover:text-white/85'
          }
        >
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {waiverChipHighlighted ? (
            <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/55" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-300" />
            </span>
          ) : null}
          {waiverChipLabel}
        </button>
        {lineupChipState === 'clear' ? (
          <button
            type="button"
            onClick={onLineupIssuesClick}
            data-testid="today-lineup-chip"
            title={lineupChipTooltip}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-500/30 bg-emerald-500/12 px-3 py-1.5 text-left transition-colors hover:border-emerald-400/45 hover:bg-emerald-500/18"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
            <div className="flex flex-col items-start">
              <span className="text-[13px] font-semibold text-emerald-300">{t('dashboard.today.lineupsGood')}</span>
              {lineupSubtext ? (
                <span className="max-w-[220px] truncate text-[11px] font-normal text-emerald-300/70">
                  {lineupSubtext}
                </span>
              ) : null}
            </div>
          </button>
        ) : lineupChipState === 'loading' ? (
          <button
            type="button"
            disabled
            data-testid="today-lineup-chip"
            title={t('dashboard.today.lineupChecking')}
            className="inline-flex shrink-0 cursor-wait items-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/45"
          >
            <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-transparent" aria-hidden />
            {t('dashboard.today.lineupChecking')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLineupIssuesClick}
            data-testid="today-lineup-chip"
            title={lineupChipTooltip}
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-left shadow-[0_0_14px_-4px_rgba(245,158,11,0.5)] transition-colors hover:border-amber-400/55 hover:bg-amber-500/22"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            <div className="flex flex-col items-start">
              <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-amber-200">
                <span className="font-bold">{lineupPrimaryLabel}</span>
                {lineupUrgentHint ? (
                  <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-200">
                    {lineupUrgentHint}
                  </span>
                ) : null}
              </span>
              {lineupSubtext ? (
                <span className="max-w-[240px] truncate text-[11px] font-normal text-amber-200/75">
                  {lineupSubtext}
                </span>
              ) : null}
            </div>
          </button>
        )}
        <button
          type="button"
          onClick={onTradesClick}
          data-testid="today-trades-chip"
          className={
            pendingTradeCount > 0
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-[13px] font-semibold text-amber-200 shadow-[0_0_14px_-4px_rgba(245,158,11,0.5)] transition hover:border-amber-400/55 hover:bg-amber-500/22'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/55 transition hover:border-white/15 hover:bg-white/[0.08] hover:text-white/85'
          }
        >
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
          {pendingTradeCount > 0 ? (
            <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300/55" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
            </span>
          ) : null}
          {tradeChipLabel}
        </button>
        {showInjuryChip ? (
          <button
            type="button"
            onClick={onInjuryClick}
            data-testid="today-injury-chip"
            className={
              injuryHighlighted
                ? 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-[13px] font-semibold text-rose-200 shadow-[0_0_14px_-4px_rgba(244,63,94,0.45)] transition hover:border-rose-400/55 hover:bg-rose-500/22'
                : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[13px] text-amber-200/95 transition hover:border-amber-500/35 hover:bg-amber-500/16'
            }
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {injuryChipLabel}
          </button>
        ) : null}
        {showMatchupChip ? (
          <button
            type="button"
            onClick={onMatchupPrepClick}
            data-testid="today-matchup-prep-chip"
            className={
              matchupHighlighted
                ? 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-[13px] font-semibold text-sky-200 shadow-[0_0_14px_-4px_rgba(56,189,248,0.45)] transition hover:border-sky-400/55 hover:bg-sky-500/22'
                : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1.5 text-[13px] text-white/70 transition hover:bg-white/[0.10]'
            }
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden />
            {matchupChipLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onWarRoomClick}
          data-testid="today-war-room-chip"
          className={
            warRoomDecisionsToReview > 0
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1.5 text-[13px] font-semibold text-violet-200 shadow-[0_0_14px_-4px_rgba(168,85,247,0.45)] transition hover:border-violet-400/55 hover:bg-violet-500/22'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-violet-500/15 bg-violet-500/[0.06] px-3 py-1.5 text-[13px] text-violet-200/75 transition hover:border-violet-400/30 hover:bg-violet-500/12 hover:text-violet-100'
          }
        >
          {warRoomDecisionsToReview > 0 ? (
            <Sword className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {warRoomDecisionsToReview > 0 ? (
            <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-300/55" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-300" />
            </span>
          ) : null}
          {warRoomChipLabel}
        </button>
      </div>
    </section>
  )
}
