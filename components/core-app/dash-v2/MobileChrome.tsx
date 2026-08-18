'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'

/**
 * Mobile chrome for Dashboard v2 — the ☰ drawer and the bottom tab bar.
 *
 * ⚠ THIS EXISTS BECAUSE STACKING IS NOT A MOBILE LAYOUT. Below the breakpoint the
 * shell stacks the 300px panel above the main column, which on a 61-league
 * account means scrolling past 61 rows before reaching a single priority card.
 * The handoff's answer is a drawer, and it is the right one: the league list is
 * navigation, and navigation on a phone belongs behind a control rather than in
 * front of the content.
 *
 * ⚠ ONE PANEL, NOT TWO. The panel is passed in as children and rendered exactly
 * once — desktop shows it in the flex column, mobile shows the same element as a
 * drawer. Rendering a second copy for mobile would double the DOM and let the two
 * drift (a filter applied in one would not apply in the other).
 *
 * The drawer is CSS-driven off a data attribute rather than conditional
 * rendering, so the panel is never unmounted: opening it does not reset the sport
 * filter or the scroll position, and it stays in the accessibility tree for
 * desktop users who never see the drawer at all.
 */

const TABS = [
  { key: 'today', label: 'Today', href: '/core/dashboard-v2' },
  // "Leagues" is the drawer, not a route — the league list IS this panel.
  { key: 'leagues', label: 'Leagues', href: null },
  { key: 'players', label: 'Players', href: '/core/players' },
  { key: 'trades', label: 'Trades', href: '/core/trades' },
  { key: 'more', label: 'More', href: '/core/tools' },
] as const

export function MobileChrome({
  children,
  leagueCount = null,
}: {
  children: ReactNode
  leagueCount?: number | null
}) {
  const [open, setOpen] = useState(false)

  /*
   * Escape closes it. A drawer that can only be dismissed by hitting a specific
   * overlay region is a trap for keyboard users, and on a phone the back gesture
   * would otherwise leave the page entirely.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    // Body scroll would otherwise continue behind the open drawer.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      {/* Mobile-only top bar. Desktop keeps the panel's own header. */}
      <header className="af-d2-mhead">
        <span className="af-d2-mhead-brand">AllFantasy</span>
        <button
          type="button"
          className="af-d2-mhead-btn"
          onClick={() => setOpen(true)}
          aria-label={
            leagueCount != null ? `Open your ${leagueCount} leagues` : 'Open your leagues'
          }
          aria-expanded={open}
        >
          <span aria-hidden>☰</span>
          {leagueCount != null ? (
            <span className="af-d2-mhead-count af-num">{leagueCount}</span>
          ) : null}
        </button>
      </header>

      {/* The single panel instance: column on desktop, drawer on mobile. */}
      <div className="af-d2-panel-slot" data-open={open ? 'true' : 'false'}>
        {children}
      </div>

      {/* Scrim only exists while open; it is what a tap-outside closes. */}
      {open ? (
        <button
          type="button"
          className="af-d2-scrim"
          aria-label="Close leagues"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <nav className="af-d2-tabbar" aria-label="Primary">
        {TABS.map((tab) =>
          tab.href ? (
            <Link key={tab.key} href={tab.href} className="af-d2-tab">
              {tab.label}
            </Link>
          ) : (
            <button
              key={tab.key}
              type="button"
              className={`af-d2-tab${open ? ' is-active' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {tab.label}
            </button>
          ),
        )}
      </nav>
    </>
  )
}

export default MobileChrome
