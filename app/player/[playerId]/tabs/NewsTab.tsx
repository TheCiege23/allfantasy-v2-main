'use client'

import { useEffect, useState } from 'react'
import { Newspaper } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'

type NewsItem = {
  title: string
  source: string
  publishedAt: string
  team?: string
  url?: string
}

export function NewsTab({ player }: { player: PlayerIdentity }) {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/sports/news?sport=${encodeURIComponent(player.sport)}&team=${encodeURIComponent(player.team)}&limit=20`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = Array.isArray(d?.data) ? d.data : Array.isArray(d?.news) ? d.news : Array.isArray(d) ? d : []
        const filtered = items.filter((n: any) =>
          String(n.title ?? '').toLowerCase().includes(player.name.split(' ').pop()?.toLowerCase() ?? '') ||
          String(n.team ?? '').toUpperCase() === player.team.toUpperCase()
        )
        setNews(filtered.length > 0 ? filtered.slice(0, 15) : items.slice(0, 10))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.name, player.sport, player.team])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />)}
      </div>
    )
  }

  if (news.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <Newspaper className="h-8 w-8 text-white/10" />
        <p className="mt-3 text-sm text-white/40">No recent news for {player.name}.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {news.map((n, i) => (
        <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <p className="text-[13px] font-medium text-white/80">{n.title}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/30">
            <span>{n.source}</span>
            <span>·</span>
            <span>{new Date(n.publishedAt).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
