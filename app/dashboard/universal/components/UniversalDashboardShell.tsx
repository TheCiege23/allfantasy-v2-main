'use client'

/**
 * Top-level shell for the Phase 2 universal dashboard: two-row header
 * (DashboardHeader, includes the settings menu), left Sidebar, right rail,
 * and an OS launcher strip above the main content. `children` is the main
 * content area — for now the existing UniversalLeaguesBoard content; later
 * pieces (Priority by Platform, Dynasty Planet search, Portfolio Analytics,
 * tabbed chat, Legacy modules) extend what renders there.
 */

import type { ReactNode } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { useSettingsProfile } from '@/hooks/useSettingsProfile'
import { DashboardHeader } from './DashboardHeader'
import { Sidebar } from './Sidebar'
import { RightRail } from './RightRail'
import { OsLauncherStrip } from './OsLauncherStrip'
import { FloatingChat } from './FloatingChat'
import styles from './universal-dashboard.module.css'

type ShellLeague = UserLeague & { navigationLeagueId?: string | null }

export function UniversalDashboardShell({
  leagues,
  children,
  guestMode = false,
  guestDisplayName = null,
}: {
  leagues: ShellLeague[]
  children: ReactNode
  /** True for the no-login Legacy-import preview (signed guest cookie, no AppUser). */
  guestMode?: boolean
  guestDisplayName?: string | null
}) {
  const isCommissionerAnywhere = leagues.some((l) => l.isCommissioner || l.userRole === 'commissioner')
  const { profile } = useSettingsProfile()
  const firstName = guestMode
    ? guestDisplayName
    : (profile?.displayName || profile?.username || '').split(/\s+/)[0]

  return (
    <>
      <DashboardHeader isCommissionerAnywhere={isCommissionerAnywhere} guestMode={guestMode} guestDisplayName={guestDisplayName} />
      <div className={styles.shell}>
        <Sidebar waiverCount={null} dmCount={null} />
        <main className={styles.main}>
          <div className={styles.hello}>{firstName ? `Welcome, ${firstName}! 👋` : 'Welcome! 👋'}</div>
          <p className={styles.subhello}>
            {guestMode
              ? 'A free preview — sign up to connect more platforms and unlock your full command center.'
              : 'Every league across every platform, in one place — with what needs your attention surfaced first.'}
          </p>
          {!guestMode && <OsLauncherStrip />}
          {children}
        </main>
        <RightRail />
      </div>
      {!guestMode && <FloatingChat leagues={leagues} />}
    </>
  )
}
