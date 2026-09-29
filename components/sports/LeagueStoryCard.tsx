'use client'

import { useState } from 'react'
import { BookOpen, Loader2, RefreshCw } from 'lucide-react'

type StoryData = {
  id: string
  title: string
  body: string
}

export function LeagueStoryCard({ leagueId, sport, week }: { leagueId: string; sport: string; week?: number }) {
  const [story, setStory] = useState<StoryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/league-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sport, week, storyType: 'weekly_storyline' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? 'Failed to generate')
        return
      }
      const data = await res.json()
      setStory(data.storyline)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!story) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-5">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-white/30">
          <BookOpen className="h-3.5 w-3.5" /> Weekly Storyline
        </div>
        <p className="mt-2 text-xs text-white/40">Generate an AI-powered recap of this week&apos;s league action.</p>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 px-4 py-2 text-[12px] font-bold text-black transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
          {loading ? 'Generating...' : 'Generate Storyline'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-purple-500/20 bg-[#0c0c1e] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-purple-300/60">
          <BookOpen className="h-3.5 w-3.5" /> {story.title}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/60"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-white/70">
        {story.body}
      </div>
    </div>
  )
}
