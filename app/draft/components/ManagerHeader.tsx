'use client'

import { cn } from '@/lib/utils'
import type { DraftPickOrderEntry } from '../types'
import { managerColorForIndex } from './manager-colors'

type Props = {
  slots: DraftPickOrderEntry[]
}

export function ManagerHeader({ slots }: Props) {
  return (
    <div className="flex min-w-max gap-1.5">
      {slots.map((s, i) => {
        const m = managerColorForIndex(i)
        return (
          <div
            key={s.id}
            className={cn(
              'flex w-[100px] shrink-0 flex-col items-center justify-center rounded-t-xl border border-b-0 border-white/10 px-1 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
              m.border,
              m.bg,
            )}
          >
            <span className={cn('max-w-full truncate text-[11px] font-semibold leading-tight', m.text)}>{s.label}</span>
            {s.isCpu ? <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-white/45">CPU</span> : null}
          </div>
        )
      })}
    </div>
  )
}
