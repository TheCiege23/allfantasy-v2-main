'use client'

import React, { useState, useEffect } from 'react'
import { Newspaper, TrendingUp, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react'

interface TrendingTopic {
  topic: string
  count: number
  articles: string[]
}

interface NewsItem {
  title: string
  source: string
  team: string | null
  publishedAt: string | null
}

interface InjuryItem {
  playerName: string
  team: string | null
  position: string | null
  status: string | null
  description: string | null
}

export default function CommunityInsights() {
  const [trending, setTrending] = useState<TrendingTopic[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [injuries, setInjuries] = useState<InjuryItem[]>([])
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [summarizing, setSummarizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async (withSummary = false) => {
    if (!withSummary) setLoading(true)
    if (withSummary) setSummarizing(true)
    setError(null)
    try {
      const url = `/api/ai/community-insights${withSummary ? '?summarize=true' : ''}`
      const res = await fetch(url)
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        setTrending(data.trending || [])
        setNews(data.recentNews || [])
        setInjuries(data.injuries || [])
        if (data.aiSummary) setAiSummary(data.aiSummary)
        if (withSummary && !data.aiSummary && (data.recentNews?.length || 0) < 3) {
          setError('Not enough recent news to generate a summary — try again later.')
        }
      } else {
        setError(data?.error || `Request failed (${res.status})`)
      }
    } catch (err) {
      setError('Failed to connect — please try again')
      console.warn('Failed to fetch community insights:', String(err))
    } finally {
      setLoading(false)
      setSummarizing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const statusColors: Record<string, string> = {
    'Out': 'text-red-400 bg-red-500/20',
    'IR': 'text-red-400 bg-red-500/20',
    'Doubtful': 'text-orange-400 bg-orange-500/20',
    'Questionable': 'text-amber-400 bg-amber-500/20',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-purple-400" />
          <span className="text-sm font-semibold text-white">Community Pulse</span>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={loading || summarizing}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-500/20 transition-colors disabled:opacity-50"
        >
          <Sparkles size={12} className={summarizing ? 'animate-pulse' : ''} />
          {summarizing ? 'Summarizing...' : 'AI Summary'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="text-xs text-red-300">{error}</div>
        </div>
      )}

      {summarizing && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20">
          <div className="flex items-center gap-2">
            <RefreshCw size={14} className="text-purple-400 animate-spin" />
            <span className="text-xs text-purple-300">Generating AI summary of latest news...</span>
          </div>
        </div>
      )}

      {aiSummary && !summarizing && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={14} className="text-purple-400" />
            <span className="text-xs font-semibold text-purple-300">AI News Briefing</span>
          </div>
          <div className="text-xs text-white/70 whitespace-pre-wrap leading-relaxed">{aiSummary}</div>
        </div>
      )}

      {loading && trending.length === 0 && !error && (
        <div className="text-center py-6 text-white/40 text-sm">
          <RefreshCw size={16} className="animate-spin mx-auto mb-2" />
          Loading community insights...
        </div>
      )}

      {!loading && trending.length === 0 && news.length === 0 && injuries.length === 0 && !error && !aiSummary && (
        <div className="text-center py-6">
          <p className="text-white/40 text-sm mb-2">No community data available yet</p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-cyan-500/20 border border-purple-500/30 text-purple-300 text-sm font-medium hover:border-purple-400/50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {trending.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider">Trending Topics</div>
          <div className="flex flex-wrap gap-1.5">
            {trending.slice(0, 6).map((topic, i) => (
              <span
                key={i}
                className="px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300"
              >
                {topic.topic} <span className="text-purple-400/60">({topic.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {injuries.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Key Injuries</span>
          </div>
          <div className="space-y-1.5">
            {injuries.slice(0, 6).map((inj, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white/5">
                <span className="text-xs text-white">
                  {inj.playerName} <span className="text-white/40">({inj.team} {inj.position})</span>
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${statusColors[inj.status || ''] || 'text-white/50 bg-white/10'}`}>
                  {inj.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {news.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Newspaper size={14} className="text-cyan-400" />
            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Latest Headlines</span>
          </div>
          <div className="space-y-1.5">
            {news.slice(0, 5).map((article, i) => (
              <div key={i} className="py-1.5 px-2 rounded-lg bg-white/5">
                <div className="text-xs text-white leading-relaxed">{article.title}</div>
                <div className="text-[11px] text-white/30 mt-0.5">
                  {article.source} {article.team && `- ${article.team}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
