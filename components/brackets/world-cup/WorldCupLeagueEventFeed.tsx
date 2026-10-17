"use client"

import { useEffect, useState } from "react"
import { Loader2, Radio } from "lucide-react"

type FeedEvent = {
  id: string
  challengeId?: string
  bracketEntryId?: string | null
  userId?: string | null
  eventType: string
  eventTitle: string
  eventBody: string
  metadata?: Record<string, unknown>
  createdAt: string
  isAiGenerated?: boolean
}

export default function WorldCupLeagueEventFeed({ challengeId }: { challengeId: string }) {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/brackets/world-cup/${challengeId}/events`, {
          cache: "no-store",
        })
        const data = await res.json().catch(() => ({}))
        if (!cancelled && Array.isArray(data.events)) {
          setEvents(data.events)
        }
      } catch {
        if (!cancelled) setEvents([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [challengeId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading activity…
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="text-xs text-white/35">
        Major bracket moments will appear here as the tournament progresses.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className="rounded-lg border border-white/[0.06] bg-black/30 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/70">
            <Radio className="h-3 w-3" />
            {e.eventTitle}
            {e.isAiGenerated ? (
              <span className="rounded bg-white/10 px-1 py-0.5 text-[11px] font-semibold text-white/50">
                AI
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-white/75">{e.eventBody}</p>
          <p className="mt-1 text-[11px] text-white/35">
            {new Date(e.createdAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  )
}
