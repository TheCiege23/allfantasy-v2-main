'use client'

import { useEffect, useRef } from 'react'

export type ZombieSseAnimation = {
  type: 'zombie_event_animation'
  id: string
  leagueId: string
  week: number
  animationType: string
  primaryUserId?: string
  secondaryUserId?: string | null
  metadata?: unknown
  durationMs?: number
  reducedMotion?: boolean
}

function parseMeta(m: unknown): Record<string, unknown> {
  if (m && typeof m === 'object' && !Array.isArray(m)) return m as Record<string, unknown>
  return {}
}

/**
 * SSE from `GET /api/zombie/animations` — use `since` on the server to avoid historical backlog on mount.
 */
export function useZombieAnimationSse(
  leagueId: string | null,
  onEvent: (ev: ZombieSseAnimation) => void,
  enabled = true,
) {
  const onRef = useRef(onEvent)
  onRef.current = onEvent

  useEffect(() => {
    if (!leagueId || !enabled) return
    const sinceMs = Date.now() - 15_000
    const since = new Date(sinceMs).toISOString()
    const url = `/api/zombie/animations?leagueId=${encodeURIComponent(leagueId)}&since=${encodeURIComponent(since)}`
    const es = new EventSource(url)
    const seen = new Set<string>()
    es.onmessage = (e) => {
      try {
        const p = JSON.parse(e.data) as { type?: string; id?: string }
        if (p.type !== 'zombie_event_animation' || !p.id) return
        if (seen.has(p.id)) return
        seen.add(p.id)
        onRef.current(p as ZombieSseAnimation)
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      es.close()
    }
    return () => {
      es.close()
    }
  }, [leagueId, enabled])
}

export function metaClip(meta: unknown): {
  clipUrl: string | null
  clipType: string
  displayMode: 'fullscreen' | 'inline'
  /** Card moments (and an optional caption under a video): what the row says happened. */
  title: string | null
  detail: string | null
  icon: string | null
  anim: string | null
} {
  const o = parseMeta(meta)
  const clipUrl = typeof o.clipUrl === 'string' ? o.clipUrl : null
  const clipType = typeof o.clipType === 'string' ? o.clipType : 'video'
  const dm = o.displayMode === 'inline' ? 'inline' : 'fullscreen'
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  return { clipUrl, clipType, displayMode: dm, title: str(o.title), detail: str(o.detail), icon: str(o.icon), anim: str(o.anim) }
}
