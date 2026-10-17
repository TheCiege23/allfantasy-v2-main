'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, Trophy, Megaphone, ArrowUpRight, Skull, Pin } from 'lucide-react'

interface Announcement {
  id: string
  type: 'announcement' | 'round_summary' | 'advancement' | 'elimination' | 'draft_schedule' | 'championship' | 'ai_recap'
  title: string
  body: string
  roundNumber?: number
  metadata?: Record<string, unknown>
  createdAt: string
}

interface TournamentForumProps {
  tournamentId: string
}

const TYPE_CONFIG: Record<string, { icon: typeof MessageSquare; color: string; bgColor: string }> = {
  announcement: { icon: Megaphone, color: 'text-cyan-400', bgColor: 'bg-cyan-400/5' },
  round_summary: { icon: Trophy, color: 'text-amber-400', bgColor: 'bg-amber-400/5' },
  advancement: { icon: ArrowUpRight, color: 'text-emerald-400', bgColor: 'bg-emerald-400/5' },
  elimination: { icon: Skull, color: 'text-red-400', bgColor: 'bg-red-400/5' },
  draft_schedule: { icon: MessageSquare, color: 'text-violet-400', bgColor: 'bg-violet-400/5' },
  championship: { icon: Trophy, color: 'text-amber-400', bgColor: 'bg-amber-400/5' },
  ai_recap: { icon: MessageSquare, color: 'text-white/50', bgColor: 'bg-white/[0.02]' },
}

export function TournamentForum({ tournamentId }: TournamentForumProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournament/${tournamentId}/announcements`)
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(data.announcements ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [tournamentId])

  useEffect(() => { fetchAnnouncements() }, [fetchAnnouncements])

  const pinned = announcements.filter((a) => a.type === 'announcement')
  const feed = announcements.filter((a) => a.type !== 'announcement')

  if (loading) return <div className="text-sm text-white/40">Loading tournament feed...</div>

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-white/80">Tournament Central</div>

      {/* Pinned announcements */}
      {pinned.length > 0 && (
        <div className="space-y-2">
          {pinned.map((a) => (
            <div key={a.id} className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Pin className="h-3 w-3 text-cyan-400" />
                <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300/70">Pinned</span>
              </div>
              <div className="text-sm font-medium text-white">{a.title}</div>
              <div className="mt-1 text-xs text-white/60">{a.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* Feed */}
      {feed.length === 0 ? (
        <div className="text-sm text-white/40">No tournament updates yet.</div>
      ) : (
        <div className="space-y-2">
          {feed.map((a) => {
            const config = TYPE_CONFIG[a.type] ?? TYPE_CONFIG.announcement!
            const Icon = config.icon
            return (
              <div key={a.id} className={`rounded-xl border border-white/10 ${config.bgColor} px-4 py-3`}>
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{a.title}</span>
                      {a.roundNumber != null && (
                        <span className="text-[11px] text-white/30">Round {a.roundNumber}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-white/50">{a.body}</div>
                    <div className="mt-1 text-[11px] text-white/25">{new Date(a.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
