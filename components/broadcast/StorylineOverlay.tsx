'use client'

import type { BroadcastStorylineRow } from '@/lib/broadcast-engine/types'

interface StorylineOverlayProps {
  storylines: BroadcastStorylineRow[]
  title?: string
  className?: string
}

export function StorylineOverlay({
  storylines,
  title = 'Storylines',
  className = '',
}: StorylineOverlayProps) {
  if (storylines.length === 0) {
    return (
      <div className={`flex min-h-[160px] flex-col items-center justify-center rounded-2xl bg-black/40 p-6 ${className}`}>
        <h2 className="text-xl font-bold text-white md:text-2xl xl:text-3xl">{title}</h2>
        <p className="mt-2 text-zinc-500">No storylines yet</p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 rounded-2xl bg-black/40 p-6 md:p-8 xl:p-10 ${className}`}>
      <h2 className="text-xl font-bold text-white md:text-3xl xl:text-4xl">{title}</h2>
      <ul className="space-y-3">
        {storylines.map((s) => (
          <li
            key={s.id}
            className="rounded-xl border border-white/10 bg-white/5 p-4 xl:p-6"
          >
            <p className="font-semibold text-white md:text-lg xl:text-xl">{s.headline}</p>
            {s.summary && <p className="mt-1 text-sm text-zinc-400 md:text-base xl:text-lg">{s.summary}</p>}
            <p className="mt-2 text-xs text-zinc-500 xl:text-sm">{s.dramaType.replace(/_/g, ' ')}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
