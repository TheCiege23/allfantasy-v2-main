'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { LeagueAction, LeagueActionCard } from '@/lib/core-app/leagueActions'
import { leagueActionsCopy } from '@/lib/core-app/leagueActionsCopy'
import { platformLabel } from '@/lib/core-app/platformLinks'

/**
 * The phone's league list (Guap, 2026-10-08): one card per league you can swipe through, each with
 * the move to make there as ONE tap — Start / Bench / Trade / Add, straight to the platform screen
 * (lib/core-app/leagueActions.ts) — and "⋯" for the rest in a bottom sheet. On a phone it replaces
 * the "Every platform, every league" table, whose six columns squeezed into two.
 *
 * The cards show the same leagues as the table (the screen passes the folded rows), so folding the
 * other managers' leagues behind one toggle holds on both.
 *
 * ⚠ The sheet is a plain `role="dialog"` with its own Escape and backdrop handling, not `<dialog>`:
 * it has to behave the same in every in-app webview, and a CLOSED one leaves nothing in the DOM.
 */

function ActionButton({ a, last, className }: { a: LeagueAction; last: string; className: string }) {
  const { language } = useOptionalLanguage()
  const label = leagueActionsCopy(language).actionLabel(a, last)
  return a.external ? (
    <a href={a.href} className={className} target="_blank" rel="noopener noreferrer" data-kind={a.kind}>
      {label}
    </a>
  ) : (
    <Link href={a.href} className={className} data-kind={a.kind}>
      {label}
    </Link>
  )
}

function ActionSheet({ card, last, onClose }: { card: LeagueActionCard; last: string; onClose: () => void }) {
  const { language } = useOptionalLanguage()
  const t = leagueActionsCopy(language)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const titleId = `af-pf-sheet-${card.leagueId}`
  const actions = [...(card.primary ? [card.primary] : []), ...card.more]
  return (
    <div className="af-pf-sheet-wrap">
      <button type="button" className="af-pf-sheet-backdrop" aria-label={t.close} tabIndex={-1} onClick={onClose} />
      <div className="af-pf-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="af-pf-sheet-grip" aria-hidden />
        <header className="af-pf-sheet-head">
          <h3 className="af-pf-sheet-title" id={titleId}>
            {t.sheetTitle(last, card.leagueName)}
          </h3>
          <button ref={closeRef} type="button" className="af-pf-sheet-close" onClick={onClose}>
            {t.close}
          </button>
        </header>
        <p className="af-pf-sheet-state">
          {t.state(card.state, card.owner)}
          {card.bestBall ? ` · ${t.bestBall}` : ''}
        </p>
        <ul className="af-pf-sheet-list">
          {actions.map((a, i) => (
            <li key={`${a.kind}-${i}`}>
              <ActionButton a={a} last={last} className={`af-pf-sheet-action${i === 0 && card.primary ? ' af-pf-sheet-action--primary' : ''}`} />
            </li>
          ))}
        </ul>
        <p className="af-pf-sheet-note">{t.readOnly}</p>
      </div>
    </div>
  )
}

export function LeagueActionCards({
  cards,
  playerName,
  proj,
  footer,
}: {
  cards: LeagueActionCard[]
  playerName: string
  /** This league's projection for him, preformatted ("14.2"), when the screen has one. */
  proj?: Record<string, string | null>
  /** Under the cards: the "show the other managers' leagues" toggle and the not-checked note. */
  footer?: ReactNode
}) {
  const { language } = useOptionalLanguage()
  const [openId, setOpenId] = useState<string | null>(null)
  if (cards.length === 0) return null
  const t = leagueActionsCopy(language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] || playerName
  const open = openId ? (cards.find((c) => c.leagueId === openId) ?? null) : null

  return (
    <section className="af-pf-cards af-pf-m-only" aria-label={t.cardsLabel}>
      <header className="af-pf-cards-head">
        <h3 className="af-label">{t.cardsLabel}</h3>
        {cards.length > 1 ? <span className="af-pf-cards-hint">{t.cardsHint}</span> : null}
      </header>
      <ul className="af-pf-cards-list">
        {cards.map((c) => (
          <li key={c.leagueId} className="af-pf-lcard" data-state={c.state}>
            <div className="af-pf-lcard-top">
              <span className="af-pf-lcard-name">{c.leagueName}</span>
              <button type="button" className="af-pf-lcard-more" aria-label={t.moreFor(c.leagueName)} aria-haspopup="dialog" onClick={() => setOpenId(c.leagueId)}>
                ⋯
              </button>
            </div>
            <span className="af-pf-lcard-meta af-num">
              <span className="af-chip af-pf-lcard-state" data-state={c.state}>
                {t.state(c.state, c.owner)}
              </span>
              {platformLabel(c.platform)}
              {proj?.[c.leagueId] ? ` · ${proj[c.leagueId]} pts` : ''}
            </span>
            {c.primary ? (
              <ActionButton a={c.primary} last={last} className="af-btn af-pf-lcard-go" />
            ) : (
              <span className="af-pf-lcard-none">{c.bestBall ? t.bestBall : t.nothingHere}</span>
            )}
          </li>
        ))}
      </ul>
      {footer}
      {open ? <ActionSheet card={open} last={last} onClose={() => setOpenId(null)} /> : null}
    </section>
  )
}

export default LeagueActionCards
