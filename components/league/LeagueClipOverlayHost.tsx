'use client'

import { useCallback, useEffect, useState } from 'react'
import { LeagueClipOverlay, type LeagueClipPayload } from '@/components/league/LeagueClipOverlay'
import { metaClip, useZombieAnimationSse, type ZombieSseAnimation } from '@/lib/hooks/useZombieAnimationSse'
import { useSurvivorLiveSse, type SurvivorMomentSse } from '@/lib/hooks/useSurvivorLiveSse'

type Variant = 'zombie' | 'survivor'

function zombieTitle(ev: ZombieSseAnimation): string {
  const t = ev.animationType.replace(/_/g, ' ')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Zombie moment'
}

export function LeagueClipOverlayHost({
  leagueId,
  variant,
  enabled = true,
}: {
  leagueId: string
  variant: Variant
  enabled?: boolean
}) {
  const [queue, setQueue] = useState<LeagueClipPayload[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const fn = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  const enqueue = useCallback((item: LeagueClipPayload) => {
    setQueue((q) => {
      if (q.some((x) => x.id === item.id)) return q
      return [...q, item]
    })
  }, [])

  const onZombie = useCallback(
    (ev: ZombieSseAnimation) => {
      const { clipUrl, clipType, displayMode, title, detail, icon, anim } = metaClip(ev.metadata)
      if (!clipUrl) return
      enqueue({
        id: ev.id,
        clipUrl,
        clipType,
        title: title ?? zombieTitle(ev),
        detail: detail ?? undefined,
        icon: icon ?? undefined,
        anim: anim ?? undefined,
        durationMs: typeof ev.durationMs === 'number' ? ev.durationMs : undefined,
        reducedMotion: Boolean(ev.reducedMotion) || reducedMotion,
        displayMode,
        accent: 'zombie',
      })
    },
    [enqueue, reducedMotion],
  )

  const onSurvivor = useCallback(
    (ev: SurvivorMomentSse) => {
      enqueue({
        id: ev.id,
        clipUrl: ev.clipUrl,
        clipType: ev.clipType,
        title: ev.label ?? 'Survivor moment',
        durationMs: ev.durationMs,
        reducedMotion,
        displayMode: 'fullscreen',
        accent: 'survivor',
      })
    },
    [enqueue, reducedMotion],
  )

  useZombieAnimationSse(variant === 'zombie' ? leagueId : null, onZombie, enabled && variant === 'zombie')
  useSurvivorLiveSse(variant === 'survivor' ? leagueId : null, onSurvivor, enabled && variant === 'survivor')

  const current = queue[0] ?? null
  const open = Boolean(current)

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1))
  }, [])

  return <LeagueClipOverlay open={open} payload={current} onClose={dismiss} />
}
