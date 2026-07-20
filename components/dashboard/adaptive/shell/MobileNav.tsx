'use client'

/**
 * Mobile navigation — fixed bottom tab bar plus a full slide-over drawer.
 *
 * This is the "genuinely distinct layout" part of the mobile breakpoint: there is no sidebar
 * at all, primary nav becomes 4 tabs + More, and everything else lives in the drawer that
 * both "More" and the header hamburger open.
 *
 * The tab bar pads for `env(safe-area-inset-bottom)` so it clears the iOS home indicator,
 * and the page content reserves matching space (see the main padding in AdaptiveDashboard).
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { MoreHorizontal, X } from 'lucide-react'
import { MOBILE_TABS, NAV_ITEMS, resolveNavHref } from './nav-items'

export function MobileTabBar({
  activeKey, onOpenDrawer,
}: { activeKey: string; onOpenDrawer: () => void }) {
  return (
    <nav
      aria-label="Primary"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 250,
        background: 'var(--af-surface)', borderTop: '1px solid rgba(139,92,246,.2)',
        display: 'flex', justifyContent: 'space-around',
        padding: '6px 0 max(6px, env(safe-area-inset-bottom))',
      }}
    >
      {MOBILE_TABS.map((item) => {
        const active = item.key === activeKey
        return (
          <Link
            key={item.key}
            href={item.href ?? '#'}
            aria-current={active ? 'page' : undefined}
            style={{ ...tabStyle, color: active ? 'var(--af-cyan)' : 'rgba(255,255,255,.4)' }}
          >
            <item.Icon size={18} strokeWidth={2} />
            <span style={tabLabel}>{item.label === 'My Leagues' ? 'Leagues' : item.label === 'Dashboard' ? 'Home' : item.label}</span>
          </Link>
        )
      })}
      <button type="button" onClick={onOpenDrawer}
        style={{ ...tabStyle, color: 'rgba(255,255,255,.4)', background: 'none', border: 'none', cursor: 'pointer' }}>
        <MoreHorizontal size={18} strokeWidth={2} />
        <span style={tabLabel}>More</span>
      </button>
    </nav>
  )
}

export function NavDrawer({
  open, onClose, isCommissioner, selectedLeagueId, activeKey,
}: {
  open: boolean
  onClose: () => void
  isCommissioner: boolean
  selectedLeagueId: string | null
  activeKey: string
}) {
  // Lock body scroll behind the drawer and close on Escape.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const items = NAV_ITEMS.filter((i) => !i.commissionerOnly || isCommissioner)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 390 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: '78vw', maxWidth: 300,
          background: 'var(--af-surface)', borderRight: '1px solid rgba(139,92,246,.25)',
          zIndex: 400, overflowY: 'auto', padding: '14px 10px',
          boxShadow: '8px 0 30px rgba(0,0,0,.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 14px' }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>ALLFANTASY</span>
          <button type="button" onClick={onClose} aria-label="Close navigation"
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', cursor: 'pointer', padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        {items.map((item) => {
          const href = resolveNavHref(item, selectedLeagueId)
          const active = item.key === activeKey
          if (!href) {
            return (
              <span key={item.key} className="af-nav-item" aria-disabled="true"
                style={{ opacity: 0.4, cursor: 'not-allowed' }} title={`${item.label} — select a league first`}>
                <item.Icon size={18} strokeWidth={2} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </span>
            )
          }
          return (
            <Link key={item.key} href={href} onClick={onClose}
              className={`af-nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}>
              <item.Icon size={18} strokeWidth={2} />
              <span style={{ flex: 1 }}>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}

const tabStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '2px 8px',
  minWidth: 56,
}
const tabLabel: React.CSSProperties = { fontSize: 9, fontWeight: 700 }
