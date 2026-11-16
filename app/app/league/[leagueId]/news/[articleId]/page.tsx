'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Share2 } from 'lucide-react'
import { useUserTimezone } from '@/hooks/useUserTimezone'

const ARTICLE_TYPE_LABELS: Record<string, string> = {
  weekly_recap: 'Weekly recap',
  power_rankings: 'Power rankings',
  trade_breakdown: 'Trade breakdown',
  upset_alert: 'Upset alert',
  playoff_preview: 'Playoff preview',
  championship_recap: 'Championship recap',
}

interface ArticleDetail {
  id: string
  leagueId: string
  sport: string
  headline: string
  body: string
  tags: string[]
  createdAt: string
}

export default function LeagueNewsArticlePage() {
  const { formatDateInTimezone } = useUserTimezone()
  const params = useParams<{ leagueId: string; articleId: string }>() ?? ({} as { leagueId: string; articleId: string })
  const leagueId = params?.leagueId ?? ''
  const articleId = params?.articleId ?? ''
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'copied' | 'error'>('idle')

  useEffect(() => {
    if (!leagueId || !articleId) return
    setLoading(true)
    setError(null)
    fetch(
      `/api/leagues/${encodeURIComponent(leagueId)}/media/${encodeURIComponent(articleId)}`,
      { cache: 'no-store' }
    )
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error ?? 'Failed to load article')
        return data
      })
      .then((data) => {
        if (data?.article) setArticle(data.article)
        else setError('Article not found')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [leagueId, articleId])

  useEffect(() => {
    if (!article || typeof window === 'undefined') return
    if (window.location.hash !== '#ai-explanation') return
    window.requestAnimationFrame(() => {
      document.getElementById('ai-explanation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [article])

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/app/league/${encodeURIComponent(leagueId)}/news/${encodeURIComponent(articleId)}`
      : ''

  const handleShare = async () => {
    if (!shareUrl) {
      setShareState('error')
      return
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: article?.headline ?? 'League News',
          url: shareUrl,
          text: article?.headline,
        })
        setShareState('shared')
      } else {
        await navigator.clipboard.writeText(shareUrl)
        setShareState('copied')
      }
    } catch {
      try {
        await navigator.clipboard.writeText(shareUrl)
        setShareState('copied')
      } catch {
        setShareState('error')
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center p-4">
        <p className="text-zinc-400">Loading article…</p>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className="space-y-4 p-4">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=News`}
          className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to News
        </Link>
        <p className="text-red-400">{error ?? 'Article not found'}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=News`}
          className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to News
        </Link>
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
        >
          <Share2 className="h-4 w-4" />
          {shareState === 'shared'
            ? 'Shared!'
            : shareState === 'copied'
              ? 'Copied!'
              : shareState === 'error'
                ? 'Share unavailable'
                : 'Share'}
        </button>
      </div>

      <article>
        <header>
          <h1 className="text-2xl font-bold text-white md:text-3xl">{article.headline}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span>{formatDateInTimezone(article.createdAt)}</span>
            <span>·</span>
            <span>{article.sport}</span>
            {article.tags?.length > 0 && (
              <>
                <span>·</span>
                {article.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-white/10 px-1.5 py-0.5 text-zinc-400"
                  >
                    {ARTICLE_TYPE_LABELS[t] ?? t}
                  </span>
                ))}
              </>
            )}
          </div>
        </header>
        <div className="mt-6 whitespace-pre-wrap text-zinc-300">{article.body}</div>
      </article>

      <section id="ai-explanation" className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4">
        <h2 className="text-sm font-semibold text-amber-200">How was this written?</h2>
        <p className="mt-2 text-sm text-zinc-400">
          This article was generated by the AI Sports Media Engine using league standings and
          optional statistical insights. The system can produce weekly recaps, power rankings,
          trade breakdowns, upset alerts, playoff previews, and championship recaps. Generate more
          from the News tab.
        </p>
      </section>
    </div>
  )
}
