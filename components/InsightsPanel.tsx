'use client'

import React, { useState, useEffect } from 'react'
import { Sparkles, AlertTriangle, TrendingUp, Newspaper, X, ChevronRight, RefreshCw } from 'lucide-react'

interface InsightItem {
  id: string
  insightType: string
  category: string
  title: string
  body: string
  priority: number
  confidence: number
  isRead: boolean
  createdAt: string
}

const categoryIcons: Record<string, React.ReactNode> = {
  roster: <AlertTriangle size={16} className="text-amber-400" />,
  strategy: <TrendingUp size={16} className="text-cyan-400" />,
  news: <Newspaper size={16} className="text-purple-400" />,
}

const categoryColors: Record<string, string> = {
  roster: 'border-amber-500/30 bg-amber-500/5',
  strategy: 'border-cyan-500/30 bg-cyan-500/5',
  news: 'border-purple-500/30 bg-purple-500/5',
}

export default function InsightsPanel({
  username,
  leagueId,
}: {
  username: string
  leagueId?: string
}) {
  const [insights, setInsights] = useState<InsightItem[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchInsights = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/legacy/insights?username=${encodeURIComponent(username)}`)
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        setInsights(data.insights || [])
      } else {
        setError(data?.error || `Failed to load insights (${res.status})`)
      }
    } catch (err) {
      setError('Failed to connect — please try again')
      console.warn('Failed to fetch insights:', String(err))
    } finally {
      setLoading(false)
    }
  }

  const generateInsights = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/legacy/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, leagueId }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data) {
        const newInsights = data.insights || []
        setInsights(newInsights)
        if (newInsights.length === 0) {
          setError('No new insights found — try again after syncing your leagues or when more news is available.')
        }
      } else if (res.status === 429) {
        setError(data?.error || 'Too many requests — please wait a moment before trying again.')
      } else {
        setError(data?.error || `Failed to generate insights (${res.status})`)
      }
    } catch (err) {
      setError('Failed to connect — please try again')
      console.warn('Failed to generate insights:', String(err))
    } finally {
      setGenerating(false)
    }
  }

  const dismissInsight = async (id: string) => {
    try {
      await fetch('/api/legacy/insights', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insightId: id, action: 'dismiss' }),
      })
      setInsights(prev => prev.filter(i => i.id !== id))
    } catch (err) {
      console.warn('Failed to dismiss insight:', String(err))
    }
  }

  useEffect(() => {
    if (username) fetchInsights()
  }, [username])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-cyan-400" />
          <span className="text-sm font-semibold text-white">Personalized Insights</span>
          {insights.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-medium">
              {insights.filter(i => !i.isRead).length} new
            </span>
          )}
        </div>
        <button
          onClick={generating ? undefined : generateInsights}
          disabled={generating}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
          {generating ? 'Analyzing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="text-xs text-red-300">{error}</div>
        </div>
      )}

      {loading && insights.length === 0 && !error && (
        <div className="text-center py-6">
          <RefreshCw size={16} className="animate-spin mx-auto mb-2 text-cyan-400" />
          <span className="text-white/40 text-sm">Loading insights...</span>
        </div>
      )}

      {!loading && insights.length === 0 && !error && (
        <div className="text-center py-6">
          <p className="text-white/40 text-sm mb-2">No insights yet</p>
          <button
            onClick={generateInsights}
            disabled={generating}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:border-cyan-400/50 transition-colors disabled:opacity-50"
          >
            {generating ? (
              <span className="flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Generating...
              </span>
            ) : 'Generate Insights'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {insights.slice(0, 8).map(insight => (
          <div
            key={insight.id}
            className={`relative p-3 rounded-xl border ${categoryColors[insight.category] || 'border-white/10 bg-white/5'} transition-all cursor-pointer`}
            onClick={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
          >
            <div className="flex items-start gap-2">
              {categoryIcons[insight.category] || <Sparkles size={16} className="text-white/50" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{insight.title}</span>
                  {insight.priority >= 75 && (
                    <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-red-500/20 text-red-300">URGENT</span>
                  )}
                </div>
                {expandedId === insight.id && (
                  <p className="text-xs text-white/60 mt-1.5 leading-relaxed">{insight.body}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <ChevronRight
                  size={14}
                  className={`text-white/30 transition-transform ${expandedId === insight.id ? 'rotate-90' : ''}`}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); dismissInsight(insight.id) }}
                  className="p-1 hover:bg-white/10 rounded"
                >
                  <X size={12} className="text-white/30" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
