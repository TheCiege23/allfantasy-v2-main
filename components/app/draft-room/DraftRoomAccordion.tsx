'use client'

import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

function useAccordionPersistence(storageKey: string | undefined, fallback: boolean) {
  const [open, setOpen] = useState(fallback)

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw === '0') setOpen(false)
      else if (raw === '1') setOpen(true)
    } catch {
      /* ignore */
    }
  }, [storageKey])

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      if (storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageKey, next ? '1' : '0')
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [storageKey])

  return { open, toggle }
}

export type DraftRoomAccordionProps = {
  title: string
  summary?: string | null
  icon?: ReactNode
  collapsedSubtitle?: string | null
  defaultOpen?: boolean
  persistenceKey?: string
  variant?: 'default' | 'redraft_snake'
  children: ReactNode
  className?: string
  headerActions?: ReactNode
  testId?: string
}

export function DraftRoomAccordion({
  title,
  summary,
  icon,
  collapsedSubtitle,
  defaultOpen = true,
  persistenceKey,
  variant = 'default',
  children,
  className,
  headerActions,
  testId,
}: DraftRoomAccordionProps) {
  const rs = variant === 'redraft_snake'
  const { open, toggle } = useAccordionPersistence(persistenceKey, defaultOpen)
  const panelId = useId()

  return (
    <div
      className={cn(
        'rounded-xl border transition-shadow duration-200',
        rs
          ? 'border-white/12 bg-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
          : 'border-white/10 bg-[#0a1228]/60',
        className,
      )}
      data-testid={testId}
    >
      <button
        type="button"
        id={`${panelId}-trigger`}
        aria-expanded={open}
        aria-controls={`${panelId}-panel`}
        onClick={toggle}
        className={cn(
          'flex w-full items-start gap-2 rounded-t-xl px-3 py-2.5 text-left transition-colors',
          rs ? 'hover:bg-white/[0.04]' : 'hover:bg-white/5',
        )}
      >
        <ChevronDown
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 text-cyan-300/80 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {icon ? <span className="shrink-0 text-cyan-200/90">{icon}</span> : null}
            <span
              className={cn(
                'text-[11px] font-bold uppercase tracking-[0.16em]',
                rs ? 'text-cyan-100/90' : 'text-white/85',
              )}
            >
              {title}
            </span>
            {headerActions ? <span className="ml-auto shrink-0">{headerActions}</span> : null}
          </div>
          {!open && collapsedSubtitle ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/50">{collapsedSubtitle}</p>
          ) : null}
          {open && summary ? <p className="mt-0.5 text-[11px] text-white/40">{summary}</p> : null}
        </div>
      </button>
      {open ? (
        <div
          id={`${panelId}-panel`}
          role="region"
          aria-labelledby={`${panelId}-trigger`}
          className={cn('border-t px-3 py-3', rs ? 'border-white/10' : 'border-white/8')}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
