'use client'

import type { ReactNode } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import '@/components/core-app/more-detail.css'

const messages = defineMessages({
  en: { moreDetail: 'More detail' },
  es: { moreDetail: 'Más detalle' },
})

/**
 * "More detail" — the one fold every /core page uses for what is not the page's main job
 * (2026-11-20, owner's ask after "the core site is confusing").
 *
 * The rule each page follows (memory: simplicity-first-every-page): the headline, the ranked action
 * list and the one table or board the page exists for stay on screen. Methodology and basis notes,
 * data-source and coverage notes, history, legends, secondary boards and extra tools go in here.
 * Nothing is deleted to make a page simpler — it is moved one tap away.
 *
 * ⚠ ONE PER PAGE, AT THE BOTTOM, AND IT ALWAYS SAYS "More detail". Pages had grown their own folds
 * under their own names and looks ("More about this league", "Record book", "How it was worked out"),
 * so a reader had to learn each page's word for the same thing. The old name survives as `note`, the
 * smaller line saying what is inside.
 *
 * ⚠ ROW-LEVEL FOLDS ARE NOT THIS. A box score under one game or the moves under one player belong to
 * that row; this is for the page.
 *
 * ⚠ A CLOSED <details> STILL RENDERS ITS CHILDREN. Moving a card in here does not stop it loading,
 * so it changes what is seen, never what is fetched.
 */
export function MoreDetail({
  note,
  children,
  open,
  className,
  testId,
  id,
  onToggle,
}: {
  /** Told when the reader opens or closes it — for a page that keeps the open state itself (Trades). */
  onToggle?: (open: boolean) => void
  /** What is inside, in a few words: "Record book · power board · league buzz". */
  note?: ReactNode
  children: ReactNode
  /** Open on first render — only where the page already decided that (an offseason, an empty week). */
  open?: boolean
  /** Kept so a page's own spacing rules and existing selectors still apply. */
  className?: string
  testId?: string
  id?: string
}) {
  const t = useMessages(messages)
  return (
    <details
      id={id}
      className={className ? `af-more-detail ${className}` : 'af-more-detail'}
      data-testid={testId}
      data-more-detail=""
      open={open}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      <summary className="af-md-summary">
        <span className="af-md-label">{t.moreDetail}</span>
        {note ? <span className="af-md-note">{note}</span> : null}
        <span className="af-md-chevron" aria-hidden>▾</span>
      </summary>
      <div className="af-md-body">{children}</div>
    </details>
  )
}
