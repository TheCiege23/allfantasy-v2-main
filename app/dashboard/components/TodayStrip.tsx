'use client'

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

  return (
    <section className="space-y-1.5">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-white/35">
        {t('dashboard.today.title')}
      </p>
      {timeAuthorityHint ? (
        <p className="text-[10px] leading-snug text-sky-200/55" role="status">
          {timeAuthorityHint}
        </p>
      ) : null}
      {waiverTimingHint ? (
        <p className="text-[10px] leading-snug text-cyan-200/45" role="status">
          {waiverTimingHint}
        </p>
      ) : null}
      {protectionActivityHint ? (
        <p className="text-[10px] leading-snug text-emerald-200/40" role="status">
          {protectionActivityHint}
        </p>
      ) : null}
      <div className="scrollbar-none flex gap-2 overflow-x-auto py-1">
        <button
          type="button"
          onClick={onWaiverClick}
          data-testid="today-waivers-chip"
          className={
            waiverChipHighlighted
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-cyan-500/35 bg-cyan-500/12 px-3 py-1.5 text-[13px] font-medium text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.18)] transition hover:border-cyan-500/45 hover:bg-cyan-500/20'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/55 transition hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-white/80'
          }
        >
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
            className="inline-flex shrink-0 cursor-pointer flex-col items-start gap-0.5 whitespace-nowrap rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1.5 text-left transition-colors hover:border-emerald-500/35 hover:bg-emerald-500/15"
          >
            <span className="text-[13px] text-emerald-400">{t('dashboard.today.lineupsGood')}</span>
            {lineupSubtext ? (
              <span className="max-w-[220px] truncate text-[11px] font-normal text-emerald-400/70">{lineupSubtext}</span>
            ) : null}
          </button>
        ) : lineupChipState === 'loading' ? (
          <button
            type="button"
            disabled
            data-testid="today-lineup-chip"
            title={t('dashboard.today.lineupChecking')}
            className="inline-flex shrink-0 cursor-wait items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/45"
          >
            {t('dashboard.today.lineupChecking')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLineupIssuesClick}
            data-testid="today-lineup-chip"
            title={lineupChipTooltip}
            className="inline-flex shrink-0 cursor-pointer flex-col items-start gap-0.5 whitespace-nowrap rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-left transition-colors hover:border-amber-500/30 hover:bg-amber-500/20"
          >
            <span className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-amber-400">
              <span aria-hidden>⚠</span>
              <span className="font-semibold">{lineupPrimaryLabel}</span>
              {lineupUrgentHint ? (
                <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-200/95">
                  {lineupUrgentHint}
                </span>
              ) : null}
            </span>
            {lineupSubtext ? (
              <span className="max-w-[240px] truncate text-[11px] font-normal text-amber-200/75">{lineupSubtext}</span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          onClick={onTradesClick}
          data-testid="today-trades-chip"
          className={
            pendingTradeCount > 0
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-amber-500/35 bg-amber-500/12 px-3 py-1.5 text-[13px] font-medium text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.18)] transition hover:border-amber-500/45 hover:bg-amber-500/20'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/55 transition hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-white/80'
          }
        >
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
                ? 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-[13px] text-rose-200/95 transition hover:border-rose-500/35 hover:bg-rose-500/18'
                : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1.5 text-[13px] text-amber-200/90 transition hover:border-amber-500/30 hover:bg-amber-500/14'
            }
          >
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
                ? 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-[13px] text-sky-300 transition hover:border-sky-500/35 hover:bg-sky-500/18'
                : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-1.5 text-[13px] text-white/70 transition hover:bg-white/[0.10]'
            }
          >
            {matchupChipLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onWarRoomClick}
          data-testid="today-war-room-chip"
          className={
            warRoomDecisionsToReview > 0
              ? 'inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border border-violet-500/35 bg-violet-500/12 px-3 py-1.5 text-[13px] font-medium text-violet-200 shadow-[0_0_12px_rgba(168,85,247,0.18)] transition hover:border-violet-500/45 hover:bg-violet-500/20'
              : 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-[13px] text-white/55 transition hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-white/80'
          }
        >
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
