'use client'

/**
 * Left nav rail. Waiver/DM badge counts only render when a real count is
 * known (rosterIssueCount from the roster-legality API, dmUnreadCount from
 * the chat threads API) — no fabricated numbers.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './universal-dashboard.module.css'

const NAV_ITEMS: { href: string; icon: string; label: string; countKey?: 'waivers' | 'dms' }[] = [
  { href: '/dashboard/universal', icon: '🏠', label: 'Dashboard' },
  { href: '/dashboard/universal', icon: '🏆', label: 'Leagues' },
  { href: '/dashboard', icon: '🛡️', label: 'My Teams' },
  { href: '/dashboard', icon: '📊', label: 'Matchups' },
  { href: '/my-players', icon: '🪐', label: 'Dynasty Planet' },
  { href: '/my-players', icon: '👥', label: 'Players' },
  { href: '/dashboard', icon: '🔁', label: 'Waivers', countKey: 'waivers' },
  { href: '/dashboard', icon: '⇄', label: 'Trades' },
  { href: '/dashboard', icon: '🎯', label: 'Drafts' },
  { href: '/dashboard', icon: '💬', label: 'League Chat' },
  { href: '/messages', icon: '✉️', label: 'DMs', countKey: 'dms' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
]

export function Sidebar({ waiverCount, dmCount }: { waiverCount: number | null; dmCount: number | null }) {
  const pathname = usePathname()
  const counts = { waivers: waiverCount, dms: dmCount }

  return (
    <aside className={styles.sidebar}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/dashboard/universal' && item.label === 'Dashboard' && pathname === '/dashboard/universal'
        const count = item.countKey ? counts[item.countKey] : null
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
          >
            <span className={styles.navIcon} aria-hidden>
              {item.icon}
            </span>
            <span className={styles.navLabel}>{item.label}</span>
            {count !== null && count > 0 ? <span className={styles.navCount}>{count}</span> : null}
          </Link>
        )
      })}

      <div className={styles.promo}>
        <h4>🏅 AF LEGACY</h4>
        <p>Your career across every league. Your legacy.</p>
        <Link href="/af-legacy" className={`${styles.cta} ${styles.ctaGhost}`}>
          Go to Legacy Hub
        </Link>
      </div>
      <div className={`${styles.promo} ${styles.promoPlus}`} style={{ marginTop: 12 }}>
        <h4>◆ ALLFANTASY+</h4>
        <p>Unlock deeper insight: settings-aware recommendations across every league you play.</p>
        <Link href="/pricing" className={styles.cta}>
          Upgrade Now
        </Link>
      </div>
    </aside>
  )
}
