'use client'

/**
 * Social Media Content Generator (PROMPT 297).
 * Generates ready-to-post caption + image for draft results, weekly recaps, trade reactions, power rankings.
 */

import { useCallback, useState } from 'react'
import html2canvas from 'html2canvas'
import { AICardRenderer, AI_INSIGHT_CARD_ID } from '@/components/ai-insight-cards'
import { DraftShareCard, DRAFT_SHARE_CARD_ID } from '@/components/draft-sharing'
import { SocialPostCard, SOCIAL_POST_CARD_ID } from './SocialPostCard'
import { CommunitySharePanel } from '@/components/community-integration'
import type { SocialContentType } from '@/lib/social-content-generator/types'

const CONTENT_TYPES: { id: SocialContentType; label: string }[] = [
  { id: 'draft_results', label: 'Draft results' },
  { id: 'weekly_recap', label: 'Weekly recap' },
  { id: 'trade_reaction', label: 'Trade reaction' },
  { id: 'power_rankings', label: 'Power rankings' },
]

const CAPTURE_IDS: Record<string, string> = {
  draft: DRAFT_SHARE_CARD_ID,
  trade_grade: AI_INSIGHT_CARD_ID,
  power_rankings: AI_INSIGHT_CARD_ID,
  weekly_recap: SOCIAL_POST_CARD_ID,
}

interface SocialContentGeneratorProps {
  /** Pre-filled context per type; if not provided, user can fill form */
  initialContext?: Partial<Record<SocialContentType, unknown>>
  onCopy?: () => void
  onDownload?: () => void
  className?: string
}

export function SocialContentGenerator({
  initialContext = {},
  onCopy,
  onDownload,
  className = '',
}: SocialContentGeneratorProps) {
  const [contentType, setContentType] = useState<SocialContentType>('weekly_recap')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    caption: string
    title: string
    bodyLines?: string[]
    cardType: string
    cardPayload: unknown
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({
    draft: { leagueName: '', season: new Date().getFullYear().toString(), winnerName: '', grade: '', highlight: '' },
    weekly: { week: new Date().getDate() <= 7 ? 1 : Math.min(14, Math.ceil(new Date().getDate() / 7)), leagueName: '', wins: 0, losses: 0, highlight: '', summary: '' },
    trade: { sideA: '', sideB: '', grade: '', verdict: '', insight: '' },
    power: { leagueName: '', rank: 1, teamName: '', change: '', blurb: '', insight: '' },
  })

  const getContext = useCallback((): unknown => {
    switch (contentType) {
      case 'draft_results':
        return {
          leagueName: form.draft.leagueName || 'My League',
          season: form.draft.season,
          winnerName: form.draft.winnerName || undefined,
          grade: form.draft.grade || undefined,
          highlight: form.draft.highlight || undefined,
        }
      case 'weekly_recap':
        return {
          week: form.weekly.week,
          leagueName: form.weekly.leagueName || undefined,
          wins: form.weekly.wins,
          losses: form.weekly.losses,
          highlight: form.weekly.highlight || undefined,
          summary: form.weekly.summary || undefined,
        }
      case 'trade_reaction':
        return {
          sideA: form.trade.sideA ? form.trade.sideA.split(',').map((s) => s.trim()).filter(Boolean) : ['Side A'],
          sideB: form.trade.sideB ? form.trade.sideB.split(',').map((s) => s.trim()).filter(Boolean) : ['Side B'],
          grade: form.trade.grade || undefined,
          verdict: form.trade.verdict || undefined,
          insight: form.trade.insight || undefined,
        }
      case 'power_rankings':
        return {
          leagueName: form.power.leagueName || undefined,
          rank: form.power.rank,
          teamName: form.power.teamName || 'My Team',
          change: form.power.change || undefined,
          blurb: form.power.blurb || undefined,
          insight: form.power.insight || undefined,
        }
      default:
        return {}
    }
  }, [contentType, form])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/social-content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: contentType, data: getContext() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to generate')
        return
      }
      setResult({
        caption: data.caption,
        title: data.title,
        bodyLines: data.bodyLines,
        cardType: data.cardType,
        cardPayload: data.cardPayload,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [contentType, getContext])

  const copyCaption = useCallback(() => {
    if (!result?.caption) return
    navigator.clipboard.writeText(result.caption).then(() => {
      setCopied(true)
      onCopy?.()
      setTimeout(() => setCopied(false), 2000)
    })
  }, [result?.caption, onCopy])

  const downloadImage = useCallback(async () => {
    if (!result) return
    const captureId = CAPTURE_IDS[result.cardType] ?? SOCIAL_POST_CARD_ID
    const el = document.getElementById(captureId)
    if (!el) return
    try {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#0f172a', useCORS: true, logging: false })
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `allfantasy-${contentType}-${Date.now()}.png`
      a.click()
      onDownload?.()
    } catch {
      // ignore
    }
  }, [result, contentType, onDownload])

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <label className="block text-sm font-medium text-white/80 mb-2">Content type</label>
        <div className="flex flex-wrap gap-2">
          {CONTENT_TYPES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setContentType(id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                contentType === id
                  ? 'bg-amber-600 text-white'
                  : 'bg-white/10 text-white/80 hover:bg-white/15'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {contentType === 'draft_results' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <input
            type="text"
            placeholder="League name"
            value={form.draft.leagueName}
            onChange={(e) => setForm((p) => ({ ...p, draft: { ...p.draft, leagueName: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Season (e.g. 2025)"
            value={form.draft.season}
            onChange={(e) => setForm((p) => ({ ...p, draft: { ...p.draft, season: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Winner name"
            value={form.draft.winnerName}
            onChange={(e) => setForm((p) => ({ ...p, draft: { ...p.draft, winnerName: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Grade (e.g. A+)"
            value={form.draft.grade}
            onChange={(e) => setForm((p) => ({ ...p, draft: { ...p.draft, grade: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Highlight (optional)"
            value={form.draft.highlight}
            onChange={(e) => setForm((p) => ({ ...p, draft: { ...p.draft, highlight: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40 sm:col-span-2"
          />
        </div>
      )}
      {contentType === 'weekly_recap' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <input
            type="number"
            placeholder="Week"
            value={form.weekly.week}
            onChange={(e) => setForm((p) => ({ ...p, weekly: { ...p.weekly, week: Number(e.target.value) || 1 } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
          />
          <input
            type="text"
            placeholder="League name"
            value={form.weekly.leagueName}
            onChange={(e) => setForm((p) => ({ ...p, weekly: { ...p.weekly, leagueName: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="number"
            placeholder="Wins"
            value={form.weekly.wins}
            onChange={(e) => setForm((p) => ({ ...p, weekly: { ...p.weekly, wins: Number(e.target.value) || 0 } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
          />
          <input
            type="number"
            placeholder="Losses"
            value={form.weekly.losses}
            onChange={(e) => setForm((p) => ({ ...p, weekly: { ...p.weekly, losses: Number(e.target.value) || 0 } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
          />
          <input
            type="text"
            placeholder="Highlight or summary"
            value={form.weekly.summary}
            onChange={(e) => setForm((p) => ({ ...p, weekly: { ...p.weekly, summary: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40 sm:col-span-2"
          />
        </div>
      )}
      {contentType === 'trade_reaction' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <input
            type="text"
            placeholder="Side A (comma-separated)"
            value={form.trade.sideA}
            onChange={(e) => setForm((p) => ({ ...p, trade: { ...p.trade, sideA: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Side B (comma-separated)"
            value={form.trade.sideB}
            onChange={(e) => setForm((p) => ({ ...p, trade: { ...p.trade, sideB: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Grade (e.g. B+)"
            value={form.trade.grade}
            onChange={(e) => setForm((p) => ({ ...p, trade: { ...p.trade, grade: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Verdict or insight"
            value={form.trade.insight}
            onChange={(e) => setForm((p) => ({ ...p, trade: { ...p.trade, insight: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
        </div>
      )}
      {contentType === 'power_rankings' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <input
            type="text"
            placeholder="League name"
            value={form.power.leagueName}
            onChange={(e) => setForm((p) => ({ ...p, power: { ...p.power, leagueName: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="number"
            placeholder="Rank"
            value={form.power.rank}
            onChange={(e) => setForm((p) => ({ ...p, power: { ...p.power, rank: Number(e.target.value) || 1 } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
          />
          <input
            type="text"
            placeholder="Team name"
            value={form.power.teamName}
            onChange={(e) => setForm((p) => ({ ...p, power: { ...p.power, teamName: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Change (e.g. +2)"
            value={form.power.change}
            onChange={(e) => setForm((p) => ({ ...p, power: { ...p.power, change: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
          />
          <input
            type="text"
            placeholder="Blurb or insight"
            value={form.power.blurb}
            onChange={(e) => setForm((p) => ({ ...p, power: { ...p.power, blurb: e.target.value } }))}
            className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white placeholder:text-white/40 sm:col-span-2"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-xl bg-amber-600 text-white px-4 py-2.5 font-medium hover:bg-amber-500 disabled:opacity-60"
        >
          {loading ? 'Generating…' : 'Generate post'}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-4 pt-4 border-t border-white/10">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyCaption}
              className="rounded-lg bg-white/10 text-white px-3 py-2 text-sm font-medium hover:bg-white/15"
            >
              {copied ? 'Copied!' : 'Copy caption'}
            </button>
            <button
              type="button"
              onClick={downloadImage}
              className="rounded-lg bg-white/10 text-white px-3 py-2 text-sm font-medium hover:bg-white/15"
            >
              Download image
            </button>
          </div>
          <div className="rounded-lg bg-black/30 p-3 text-sm text-white/90 whitespace-pre-wrap">
            {result.caption}
          </div>
          <div className="flex justify-center">
            {result.cardType === 'draft' && (
              <DraftShareCard payload={result.cardPayload as any} captureId={DRAFT_SHARE_CARD_ID} />
            )}
            {result.cardType === 'trade_grade' && (
              <AICardRenderer payload={result.cardPayload as any} captureId={AI_INSIGHT_CARD_ID} />
            )}
            {result.cardType === 'power_rankings' && (
              <AICardRenderer payload={result.cardPayload as any} captureId={AI_INSIGHT_CARD_ID} />
            )}
            {result.cardType === 'weekly_recap' && (
              <SocialPostCard
                title={result.title}
                bodyLines={result.bodyLines}
                week={(result.cardPayload as any)?.week}
                leagueName={(result.cardPayload as any)?.leagueName}
                captureId={SOCIAL_POST_CARD_ID}
              />
            )}
          </div>
          <div className="pt-4 border-t border-white/10">
            <CommunitySharePanel
              input={{
                kind: contentType === 'draft_results' ? 'draft_results' : contentType === 'weekly_recap' ? 'weekly_recap' : contentType === 'trade_reaction' ? 'trade_reaction' : 'power_rankings',
                title: result.title,
                description: result.caption,
                url: 'https://allfantasy.ai',
              }}
              showWebhook
            />
          </div>
        </div>
      )}
    </div>
  )
}
