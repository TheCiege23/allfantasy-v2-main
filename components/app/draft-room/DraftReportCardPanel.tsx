'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Award, Download, Share2, TrendingDown, TrendingUp } from 'lucide-react'
import type { DraftResultsPayload } from '@/lib/post-draft-manager-ranking/types'
import {
  adpBasisLabel,
  buildDraftReportCard,
  type DraftReportCard,
  type ReportCardPick,
} from '@/lib/post-draft-manager-ranking/reportCard'

type Props = {
  leagueId: string
  rosterId: string | null
  /** Pre-fetched results (tests / storybook); skips the fetch when given. */
  initialResults?: DraftResultsPayload | null
}

function gradeTone(grade: string): string {
  const l = grade.charAt(0).toUpperCase()
  if (l === 'A') return 'border-emerald-400/50 text-emerald-200 bg-emerald-500/10'
  if (l === 'B') return 'border-cyan-400/50 text-cyan-200 bg-cyan-500/10'
  if (l === 'C') return 'border-amber-400/50 text-amber-200 bg-amber-500/10'
  return 'border-orange-400/50 text-orange-200 bg-orange-500/10'
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

function PickTile({ label, pick, kind }: { label: string; pick: ReportCardPick | null; kind: 'steal' | 'reach' }) {
  const Icon = kind === 'steal' ? TrendingUp : TrendingDown
  const tone = kind === 'steal' ? 'text-emerald-300' : 'text-rose-300'
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 p-3" data-testid={`draft-report-card-${kind}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        {label}
      </div>
      {pick ? (
        <>
          <p className="mt-1 truncate text-sm font-semibold text-white">{pick.playerName}</p>
          <p className="truncate text-[11px] text-white/55">
            {pick.position}
            {pick.team ? ` · ${pick.team}` : ''} · Rd {pick.round}, #{pick.overall} · ADP {pick.adp}
          </p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{signed(pick.delta)} spots</p>
        </>
      ) : (
        <p className="mt-1 text-xs text-white/55">None — every pick stayed near ADP.</p>
      )}
    </div>
  )
}

/** "Your report card" hero for the post-draft summary: grade, rank, steal, reach, roster build, share image. */
export function DraftReportCardPanel({ leagueId, rosterId, initialResults }: Props) {
  const [results, setResults] = useState<DraftResultsPayload | null>(initialResults ?? null)
  const [loading, setLoading] = useState(initialResults === undefined)
  const [shareState, setShareState] = useState<'idle' | 'working' | 'error'>('idle')

  useEffect(() => {
    if (initialResults !== undefined || !rosterId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-results`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setResults(data && Array.isArray(data.managerRankings) ? (data as DraftResultsPayload) : null)
      })
      .catch(() => {
        if (!cancelled) setResults(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leagueId, rosterId, initialResults])

  const card: DraftReportCard | null = results && rosterId ? buildDraftReportCard(results, rosterId) : null
  const imageUrl = rosterId
    ? `/api/share/draft?card=report&leagueId=${encodeURIComponent(leagueId)}&rosterId=${encodeURIComponent(rosterId)}`
    : ''

  const shareImage = useCallback(async () => {
    if (!imageUrl) return
    setShareState('working')
    try {
      const res = await fetch(imageUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error('image')
      const blob = await res.blob()
      const file = new File([blob], 'draft-report-card.png', { type: 'image/png' })
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My draft report card' }).catch(() => {})
      } else {
        const href = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = href
        a.download = 'draft-report-card.png'
        a.click()
        URL.revokeObjectURL(href)
      }
      setShareState('idle')
    } catch {
      setShareState('error')
    }
  }, [imageUrl])

  if (!rosterId) return null
  if (loading) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]" data-testid="draft-report-card-loading" />
    )
  }
  if (!card) return null

  const positions = card.positions.slice(0, 6)

  return (
    <section
      className="rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-[#0b1730] to-[#070d1c] p-4"
      data-testid="draft-report-card"
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/90">
            <Award className="h-3.5 w-3.5" /> Your report card
          </p>
          <h2 className="mt-1 truncate text-lg font-bold text-white">{card.displayName}</h2>
          <p className="text-sm text-white/80" data-testid="draft-report-card-rank">
            Ranked <strong>#{card.rank}</strong> of {card.teamCount} drafts
          </p>
          <p className="mt-1 text-[11px] text-white/55">
            <span className="tabular-nums">{signed(card.totalValue)}</span> spots vs ADP · {card.valuePicks} value ·{' '}
            {card.evenPicks} on ADP · {card.reachPicks} reach
          </p>
        </div>
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 text-3xl font-black sm:h-20 sm:w-20 sm:text-4xl ${gradeTone(card.grade)}`}
          data-testid="draft-report-card-grade"
          aria-label={`Draft grade ${card.grade}`}
        >
          {card.grade}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <PickTile label="Best steal" pick={card.bestSteal} kind="steal" />
        <PickTile label="Biggest reach" pick={card.biggestReach} kind="reach" />
      </div>

      <div className="mt-3" data-testid="draft-report-card-positions">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Roster build</p>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {positions.map((p) => (
            <div key={p.position} className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-center">
              <p className="text-[10px] font-semibold text-white/55">{p.position}</p>
              <p className="text-base font-bold tabular-nums text-white">{p.count}</p>
              <p
                className={`text-[10px] tabular-nums ${p.value > 0 ? 'text-emerald-300' : p.value < 0 ? 'text-rose-300' : 'text-white/40'}`}
              >
                {signed(p.value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[10px] text-white/45" data-testid="draft-report-card-basis">
        {adpBasisLabel(card.adpBasis)}.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void shareImage()}
          disabled={shareState === 'working'}
          data-testid="draft-report-card-share"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-60"
        >
          <Share2 className="h-4 w-4" />
          {shareState === 'working' ? 'Preparing…' : 'Share my card'}
        </button>
        <a
          href={imageUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="draft-report-card-image"
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
        >
          <Download className="h-4 w-4" /> Image
        </a>
        <Link
          href={`/league/${leagueId}/draft-results`}
          className="inline-flex min-h-[40px] items-center rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
        >
          All grades
        </Link>
      </div>
      {shareState === 'error' && (
        <p className="mt-2 text-[11px] text-rose-300">Couldn’t build the image. Try the Image link instead.</p>
      )}
    </section>
  )
}

export default DraftReportCardPanel
