'use client'

import { cn } from '@/lib/utils'
import type { DraftPickOrderEntry } from '../types'
import { managerColorForIndex } from './manager-colors'

type Props = {
  slots: DraftPickOrderEntry[]
  /** Index of the manager currently on the clock. Highlighted with a ring. */
  onClockIndex?: number
  /** Index of the viewer's own slot. Subtly highlighted. */
  selfIndex?: number
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ManagerStrip({ slots, onClockIndex, selfIndex }: Props) {
  if (slots.length === 0) return null
  return (
    <div
      className="flex min-w-max gap-2 overflow-x-auto px-3 py-2"
      data-testid="draft-manager-strip"
      role="list"
    >
      {slots.map((s, i) => {
        const m = managerColorForIndex(i)
        const isOnClock = onClockIndex === i
        const isSelf = selfIndex === i
        return (
          <div
            key={s.id}
            role="listitem"
            data-testid={`draft-manager-${i}`}
            data-on-clock={isOnClock || undefined}
            className={cn(
              'flex w-[88px] shrink-0 flex-col items-center gap-1 rounded-xl border px-1.5 py-2 transition',
              m.border,
              m.bg,
              isOnClock ? 'ring-2 ring-cyan-400/70 shadow-[0_0_18px_rgba(34,211,238,0.35)]' : '',
              isSelf && !isOnClock ? 'ring-1 ring-white/30' : '',
            )}
          >
            <div
              className={cn(
                'relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 bg-[#07071a]',
                m.border,
              )}
              aria-hidden
            >
              {s.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className={cn('text-[11px] font-bold', m.text)}>{initials(s.label)}</span>
              )}
            </div>
            <span className={cn('w-full truncate text-center text-[11px] font-semibold', m.text)}>
              {s.label}
            </span>
            {s.isCpu ? <span className="text-[11px] uppercase tracking-wide text-white/35">CPU</span> : null}
          </div>
        )
      })}
    </div>
  )
}
