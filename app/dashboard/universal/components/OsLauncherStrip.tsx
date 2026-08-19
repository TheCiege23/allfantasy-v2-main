'use client'

/**
 * "Jump to an OS" strip — real links into each Operating System surface that
 * already exists in the app. Matches _design-mocks/universal-dashboard.html's
 * `.os-strip`.
 */

import Link from 'next/link'
import styles from './universal-dashboard.module.css'

const OS_LINKS: { label: string; href: string }[] = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Draft', href: '/dashboard' },
  { label: 'Trades', href: '/dashboard' },
  { label: 'Waivers', href: '/dashboard' },
  { label: 'Legacy', href: '/af-legacy' },
  { label: 'Commissioner', href: '/commissioner-os' },
  { label: 'Leagues', href: '/dashboard' },
]

export function OsLauncherStrip() {
  return (
    <div className={styles.osStrip} id="os-strip">
      <span className={styles.osLead}>⊞ Jump to</span>
      {OS_LINKS.map((os) => (
        <Link key={os.label} href={os.href} className={styles.osChip}>
          {os.label}
        </Link>
      ))}
      <span className={styles.osNote}>Everything you play, one place</span>
    </div>
  )
}
