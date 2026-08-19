'use client'

import { AlertTriangle, ArrowRightLeft, CheckCircle2, Flame, Swords, UserPlus } from 'lucide-react'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { WarRoomCard } from './WarRoomCard'
import { EmptyState } from './EmptyState'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

type PriorityTier = 'urgent' | 'high' | 'normal'

type ActionRow = {
  key: string
  tier: PriorityTier
  icon: typeof Flame
  label: string
  detail: string
  onClick: () => void
}

const TIER_COLOR: Record<PriorityTier, string> = {
  urgent: '#f87171',
  high: '#fbbf24',
  normal: '#22d3ee',
}

function urgencyTier(severity: LineupActionItem['severity']): PriorityTier {
  if (severity === 'critical') return 'urgent'
  if (severity === 'warning') return 'high'
  return 'normal'
}

/**
 * Same row-count logic as the component body below (kept as a pure, i18n-free
 * function so the hero's "today" badge can share it without recomputing or
 * duplicating the filter/slice rules — see DashboardOverview.tsx).
 */
export function countActionItems(
  lineupActions: LineupActionItem[],
  waiverPickupSuggestions: number,
  pendingTradeCount: number,
  warRoomDecisionsToReview: number,
): number {
  const lineupCount = lineupActions.filter((a) => a.severity !== 'info').slice(0, 4).length
  const waiverCount = waiverPickupSuggestions > 0 ? 1 : 0
  const tradeCount = pendingTradeCount > 0 ? 1 : 0
  const warRoomCount = warRoomDecisionsToReview > 0 ? 1 : 0
  return lineupCount + waiverCount + tradeCount + warRoomCount
}

export function ActionCenter({
  lineupActions,
  waiverPickupSuggestions,
  pendingTradeCount,
  warRoomDecisionsToReview,
  onLineupIssuesClick,
  onWaiverClick,
  onTradesClick,
  onWarRoomClick,
  decisionOsLineup,
}: {
  lineupActions: LineupActionItem[]
  waiverPickupSuggestions: number
  pendingTradeCount: number
  warRoomDecisionsToReview: number
  onLineupIssuesClick: () => void
  onWaiverClick: () => void
  onTradesClick: () => void
  onWarRoomClick: () => void
  /**
   * Decision OS Slice 1 (`manager.lineup.set`) Stage 1 LIVE enrichment for the primary league, when
   * active. Confidence-only — the actual action rows above are unchanged either way (Decision OS
   * wraps the same legacy lineup summary by design, so it would render identically). This badge is
   * the only visible confirmation that the enrichment pipeline ran for this session.
   */
  decisionOsLineup?: { confidence: number } | null
}) {
  const { t, tInterpolate } = useLanguage()

  const TIER_BADGE: Record<PriorityTier, string> = {
    urgent: t('dashboard.warroom.actionCenter.tierUrgent'),
    high: t('dashboard.warroom.actionCenter.tierSoon'),
    normal: t('dashboard.warroom.actionCenter.tierOpen'),
  }

  const rows: ActionRow[] = []

  // Real per-slot lineup issues first, worst severity first (data already scanned in DashboardOverview).
  const sortedLineupActions = [...lineupActions]
    .filter((a) => a.severity !== 'info')
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
    .slice(0, 4)

  for (const action of sortedLineupActions) {
    rows.push({
      key: `lineup-${action.leagueId}-${action.slotId ?? action.playerId ?? action.slotIndex}`,
      tier: urgencyTier(action.severity),
      icon: AlertTriangle,
      label: action.playerName
        ? `${action.recommendedAction ?? t('dashboard.warroom.actionCenter.review')}: ${action.playerName}`
        : action.message,
      detail: action.lockTime
        ? `${action.leagueName} · ${t('dashboard.warroom.actionCenter.locksSoon')}`
        : action.leagueName,
      onClick: onLineupIssuesClick,
    })
  }

  if (waiverPickupSuggestions > 0) {
    rows.push({
      key: 'waiver',
      tier: 'high',
      icon: UserPlus,
      label:
        waiverPickupSuggestions === 1
          ? t('dashboard.warroom.actionCenter.waiverSuggestionOne')
          : tInterpolate('dashboard.warroom.actionCenter.waiverSuggestionMany', { n: waiverPickupSuggestions }),
      detail: t('dashboard.warroom.actionCenter.waiverDetail'),
      onClick: onWaiverClick,
    })
  }

  if (pendingTradeCount > 0) {
    rows.push({
      key: 'trade',
      tier: 'normal',
      icon: ArrowRightLeft,
      label:
        pendingTradeCount === 1
          ? t('dashboard.warroom.actionCenter.tradeOfferOne')
          : tInterpolate('dashboard.warroom.actionCenter.tradeOfferMany', { n: pendingTradeCount }),
      detail: t('dashboard.warroom.actionCenter.tradeDetail'),
      onClick: onTradesClick,
    })
  }

  if (warRoomDecisionsToReview > 0) {
    rows.push({
      key: 'warroom',
      tier: 'normal',
      icon: Swords,
      label:
        warRoomDecisionsToReview === 1
          ? t('dashboard.warroom.actionCenter.warRoomOne')
          : tInterpolate('dashboard.warroom.actionCenter.warRoomMany', { n: warRoomDecisionsToReview }),
      detail: t('dashboard.warroom.actionCenter.warRoomDetail'),
      onClick: onWarRoomClick,
    })
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        tone="positive"
        title={t('dashboard.warroom.actionCenter.allCaughtUp')}
        description={t('dashboard.warroom.actionCenter.noUrgentDecisions')}
        hint={t('dashboard.warroom.actionCenter.allClearHint')}
      />
    )
  }

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(255,255,255,0.08)">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {t('dashboard.warroom.actionCenter.title')}
        </p>
        {decisionOsLineup ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300/90">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {tInterpolate('dashboard.warroom.recs.confidence', { pct: Math.round(decisionOsLineup.confidence) })}
          </span>
        ) : null}
      </div>
      <ul>
        {rows.map((row) => {
          const Icon = row.icon
          const color = TIER_COLOR[row.tier]
          return (
            <li key={row.key} className="border-b border-white/[0.04] last:border-b-0">
              <button
                type="button"
                onClick={row.onClick}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${color}1f`, color }}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white/90">{row.label}</span>
                  <span className="block truncate text-[11px] text-white/40">{row.detail}</span>
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                  style={{ color, background: `${color}1a` }}
                >
                  {TIER_BADGE[row.tier]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </WarRoomCard>
  )
}
