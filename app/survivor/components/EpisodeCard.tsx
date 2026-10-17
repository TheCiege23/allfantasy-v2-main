'use client'

import { useState } from 'react'
import clsx from 'clsx'

export function EpisodeCard({
  week,
  title,
  challengeLine,
  tribalLine,
  twistsLine,
  recap,
}: {
  week: number
  title: string
  challengeLine: string
  tribalLine: string
  twistsLine?: string
  recap?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <article className="survivor-panel rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--survivor-text-dim)]">
            Episode {week}
          </p>
          <h3 className="mt-1 text-[15px] font-bold text-white">{title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-white/10 px-3 text-[11px] text-sky-200"
        >
          {open ? 'Less' : 'More'}
        </button>
      </div>
      <ul className="mt-3 space-y-2 text-[12px] text-[var(--survivor-text-medium)]">
        <li>
          <span className="text-[var(--survivor-text-dim)]">Challenge · </span>
          {challengeLine}
        </li>
        <li>
          <span className="text-[var(--survivor-text-dim)]">Tribal · </span>
          {tribalLine}
        </li>
        {twistsLine ? (
          <li>
            <span className="text-[var(--survivor-text-dim)]">Twists · </span>
            {twistsLine}
          </li>
        ) : null}
      </ul>
      {open && recap ? (
        <p className={clsx('mt-3 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-white/70')}>
          {recap}
        </p>
      ) : null}
    </article>
  )
}
