'use client'

/**
 * Left navigation — desktop (232px, icon + label) and tablet (74px, icon-only rail).
 *
 * One component with two variants rather than two components: the nav's contents, active
 * state, badge logic and disabled handling are identical, and only the label/badge
 * visibility and width differ. Splitting them would mean maintaining the same list twice.
 *
 * Not rendered at all on mobile — that breakpoint gets `MobileNav` (tab bar + drawer).
 */

import Link from 'next/link'
import { NAV_ITEMS, resolveNavHref, type BadgeCountKey, type NavItem } from './nav-items'

export type NavBadgeCounts = Partial<Record<BadgeCountKey, number>>

export function AdaptiveSidebar({
  variant, activeKey, isCommissioner, selectedLeagueId, badgeCounts, draftIsLive,
}: {
  variant: 'full' | 'rail'
  activeKey: string
  isCommissioner: boolean
  selectedLeagueId: string | null
  badgeCounts: NavBadgeCounts
  /** Drives the pulsing LIVE chip on Draft. Only true when a draft really is in progress. */
  draftIsLive: boolean
}) {
  const showLabels = variant === 'full'
  const items = NAV_ITEMS.filter((i) => !i.commissionerOnly || isCommissioner)

  return (
    <aside
      style={{
        width: showLabels ? 'var(--af-sidebar-w)' : 'var(--af-rail-w)',
        flexShrink: 0,
        background: 'var(--af-surface)',
        borderRight: '1px solid var(--af-border)',
        overflowY: 'auto',
      }}
    >
      <nav
        aria-label="Dashboard"
        style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: showLabels ? '14px 10px' : '14px 8px' }}
      >
        {items.map((item, i) => (
          <SidebarItem
            key={item.key}
            item={item}
            showLabel={showLabels}
            isActive={item.key === activeKey}
            href={resolveNavHref(item, selectedLeagueId)}
            count={item.badge?.countKey ? badgeCounts[item.badge.countKey] : undefined}
            draftIsLive={draftIsLive}
            // Design rules the nav into three groups: league tools, commissioner, comms.
            // Non-commissioners lose the middle group, leaving a single rule before Messages.
            dividerBefore={item.key === 'commissioner' || item.key === 'messages'}
            isFirst={i === 0}
          />
        ))}
      </nav>
    </aside>
  )
}

function SidebarItem({
  item, showLabel, isActive, href, count, draftIsLive, dividerBefore, isFirst,
}: {
  item: NavItem
  showLabel: boolean
  isActive: boolean
  href: string | null
  count?: number
  draftIsLive: boolean
  dividerBefore: boolean
  isFirst: boolean
}) {
  const { Icon, label } = item
  const disabled = href === null

  const body = (
    <>
      <Icon size={18} strokeWidth={2} />
      {showLabel && <span style={{ flex: 1 }}>{label}</span>}
      {showLabel && <Badge item={item} count={count} draftIsLive={draftIsLive} />}
    </>
  )

  const className = `af-nav-item${isActive ? ' is-active' : ''}`
  const style: React.CSSProperties = {
    justifyContent: showLabel ? undefined : 'center',
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
  // Icon-only rail has no visible label, so the accessible name has to come from the title.
  const title = disabled
    ? `${label} — select a league first`
    : showLabel ? undefined : label

  return (
    <>
      {dividerBefore && !isFirst && (
        <div style={{ height: 1, background: 'rgba(139,92,246,.15)', margin: '8px 6px' }} />
      )}
      {disabled ? (
        <span className={className} style={style} title={title} aria-disabled="true">{body}</span>
      ) : (
        <Link
          href={href}
          className={className}
          style={style}
          title={title}
          aria-label={showLabel ? undefined : label}
          aria-current={isActive ? 'page' : undefined}
        >
          {body}
        </Link>
      )}
    </>
  )
}

function Badge({ item, count, draftIsLive }: { item: NavItem; count?: number; draftIsLive: boolean }) {
  const badge = item.badge
  if (!badge) {
    // Draft's LIVE chip is not a static badge — it appears only while a draft is running.
    if (item.key === 'draft' && draftIsLive) return <span className="af-badge-live">LIVE</span>
    return null
  }
  if (badge.kind === 'new') return <span className="af-badge-new">{badge.text ?? 'NEW'}</span>
  // A count badge with no real count renders nothing rather than a "0" chip.
  if (!count || count <= 0) return null
  const tone = item.key === 'trades' ? 'af-badge-violet' : 'af-badge-cyan'
  return <span className={`af-badge ${tone}`}>{count > 99 ? '99+' : count}</span>
}
