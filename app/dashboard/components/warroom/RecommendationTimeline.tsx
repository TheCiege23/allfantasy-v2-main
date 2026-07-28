'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  CloudRain,
  Sparkles,
  Swords,
  UserPlus,
} from 'lucide-react'
import Link from 'next/link'
import type { LineupActionItem, LineupActionReasonType, LineupActionUrgency } from '@/lib/lineup-actions/types'
import { WarRoomCard } from './WarRoomCard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { SourceActionLink } from '@/components/league-links/SourceActionLink'
import { IMPORTED_LEAGUE_READONLY_NOTE } from '@/lib/league-links/readOnlyNote'

const URGENCY_RANK: Record<LineupActionUrgency, number> = { urgent: 0, soon: 1, normal: 2, low: 3 }

const REASON_ICON: Record<LineupActionReasonType, typeof Sparkles> = {
  empty_starter: AlertTriangle,
  injured_starter: Activity,
  questionable_starter: Activity,
  doubtful_starter: Activity,
  illegal_slot: AlertTriangle,
  fetch_error: AlertTriangle,
  native_starter_gap: AlertTriangle,
  ai_start_sit: ArrowLeftRight,
  ai_waiver: UserPlus,
  matchup_prep: Swords,
  injury_impact: Activity,
  war_room: Sparkles,
  weather_risk: CloudRain,
}

/** Real 0-100 (some sources emit 0-1) — normalize to a whole-number percent for the confidence chip. */
function confidencePercent(confidence: number): number {
  return Math.round(confidence <= 1 ? confidence * 100 : confidence)
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function RecommendationRow({ action }: { action: LineupActionItem }) {
  const { t, tInterpolate } = useLanguage()
  const [open, setOpen] = useState(false)
  const Icon = REASON_ICON[action.reasonType] ?? Sparkles
  const headline = action.recommendedAction || action.message
  const isUrgent = action.urgency === 'urgent'
  const isSoon = action.urgency === 'soon'
  const conf = action.confidence != null ? confidencePercent(action.confidence) : null
  const gain = action.expectedGain != null && action.expectedGain > 0 ? action.expectedGain : null
  // Only reveal the reasoning when it adds detail beyond the headline (no redundant "why").
  const canExplain = Boolean(action.message) && action.message !== headline

  const urgencyDot = isUrgent ? 'bg-red-400' : isSoon ? 'bg-amber-400' : 'bg-white/25'

  return (
    <li className="border-b border-white/[0.04] last:border-b-0">
      <div className="flex items-start gap-2.5 px-4 py-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-white/60">
          <Icon className="h-3 w-3" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-semibold leading-snug text-white/90">{headline}</p>
            <span aria-hidden className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${urgencyDot}`} />
          </div>

          {/* Decision metadata — confidence + expected gain + urgency, only where real values exist. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isUrgent || isSoon ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  isUrgent ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {t(isUrgent ? 'dashboard.warroom.recs.urgencyUrgent' : 'dashboard.warroom.recs.urgencySoon')}
              </span>
            ) : null}
            {conf != null ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                  conf >= 70
                    ? 'border-emerald-400/30 text-emerald-300'
                    : conf >= 45
                      ? 'border-amber-400/30 text-amber-300'
                      : 'border-white/15 text-white/50'
                }`}
              >
                <span aria-hidden className="text-[8px]">◆</span>
                {tInterpolate('dashboard.warroom.recs.confidence', { pct: conf })}
              </span>
            ) : null}
            {gain != null ? (
              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                {tInterpolate('dashboard.warroom.recs.gain', { pts: Math.round(gain * 10) / 10 })}
              </span>
            ) : null}
            <span className="text-[9px] uppercase tracking-wide text-white/25">{action.leagueName}</span>
            {canExplain ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-semibold text-cyan-300/70 transition hover:text-cyan-200"
                aria-expanded={open}
              >
                {t('dashboard.warroom.recs.explain')}
                <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Decision OS action loop: internal AF analysis + secure source-platform action (imported). */}
          {action.actionLinks && (action.actionLinks.internal || action.actionLinks.external) ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {action.actionLinks.internal ? (
                <Link
                  href={action.actionLinks.internal.href}
                  className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-500/5 px-2 py-1 text-[10px] font-semibold text-cyan-200/90 transition hover:bg-cyan-500/15"
                >
                  {action.actionLinks.internal.label}
                </Link>
              ) : null}
              {action.actionLinks.external ? (
                <SourceActionLink
                  link={action.actionLinks.external.link}
                  label={action.actionLinks.external.label}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-white/70 transition hover:bg-white/[0.08]"
                />
              ) : null}
              {action.actionLinks.imported && action.actionLinks.dataAsOf ? (
                <span className="text-[9px] text-white/25">as of {relTime(action.actionLinks.dataAsOf)}</span>
              ) : null}
            </div>
          ) : null}

          {/* Explain — the real reasoning, collapsed by default (no wall of prose). */}
          {open && canExplain ? (
            <p className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] leading-snug text-white/60">
              {action.message}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}

/**
 * Dashboard V2 Phase 3.1 — Recommendation Timeline. The "Recommend + Explain" centerpiece of the
 * Decision OS: the real AI lineup/start-sit/waiver/matchup signals (LineupActionItem[]) presented as
 * a prioritized decision feed rather than a bare count. Each row carries its REAL decision metadata —
 * confidence (0-100 confidenceScore), expected gain (projected point delta), urgency — and an inline
 * "Explain" that reveals the engine's own reasoning. No fabricated numbers: confidence/gain chips
 * render only where the source provides real values. Ordered by urgency, then expected gain.
 */
export function RecommendationTimeline({ actions }: { actions: LineupActionItem[] }) {
  const { t, tInterpolate } = useLanguage()

  const ordered = useMemo(() => {
    return [...actions]
      .sort((a, b) => {
        const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
        if (u !== 0) return u
        return (b.expectedGain ?? 0) - (a.expectedGain ?? 0)
      })
      .slice(0, 6)
  }, [actions])

  if (ordered.length === 0) return null

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(34,211,238,0.2)">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-cyan-300/80">
          <Sparkles className="h-3 w-3" aria-hidden />
          {t('dashboard.warroom.recs.title')}
        </p>
        <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300/80">
          {tInterpolate('dashboard.warroom.recs.count', { n: actions.length })}
        </span>
      </div>
      <ul>
        {ordered.map((action) => (
          <RecommendationRow key={`${action.leagueId}-${action.slotId ?? action.playerId ?? action.slotIndex}-${action.reasonType}`} action={action} />
        ))}
      </ul>
      {ordered.some((a) => a.actionLinks?.imported && a.actionLinks?.external) ? (
        <p className="border-t border-white/[0.06] px-4 py-2 text-[10px] leading-snug text-white/40">
          {IMPORTED_LEAGUE_READONLY_NOTE}
        </p>
      ) : null}
    </WarRoomCard>
  )
}
