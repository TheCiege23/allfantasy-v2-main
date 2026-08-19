'use client'

/**
 * Two-row header: row 1 (topbar) = logo + Intelligence + messages/alerts +
 * user chip; row 2 (toolbar) = sport selector + search + live-data chip +
 * Operating Systems launcher. Matches _design-mocks/universal-dashboard.html's
 * `.topbar`/`.toolbar` structure.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { IdentityImageRenderer } from '@/components/identity/IdentityImageRenderer'
import { useSettingsProfile } from '@/hooks/useSettingsProfile'
import { SettingsMenu } from './SettingsMenu'
import styles from './universal-dashboard.module.css'

type DataProviderHealth = 'checking' | 'connected' | 'degraded'

/**
 * Real backing for the "Live data connected" chip — previously hardcoded, unconditional
 * markup with no check at all (AF_DATA_PROVENANCE_AUDIT.md demo risk #3). Queries
 * /api/health/data-providers, which checks actual sports-data and weather cache freshness.
 */
function useDataProviderHealth(): DataProviderHealth {
  const [status, setStatus] = useState<DataProviderHealth>('checking')

  useEffect(() => {
    let cancelled = false
    fetch('/api/health/data-providers')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { ok?: boolean }) => {
        if (!cancelled) setStatus(data.ok ? 'connected' : 'degraded')
      })
      .catch(() => {
        if (!cancelled) setStatus('degraded')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}

export function DashboardHeader({
  isCommissionerAnywhere,
  guestMode = false,
  guestDisplayName = null,
}: {
  isCommissionerAnywhere: boolean
  guestMode?: boolean
  guestDisplayName?: string | null
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { profile } = useSettingsProfile()
  const dataHealth = useDataProviderHealth()

  const displayName = guestMode ? guestDisplayName || 'Guest' : profile?.displayName || profile?.username || 'Your account'
  const role = guestMode ? 'Guest preview' : isCommissionerAnywhere ? 'Commissioner' : 'Manager'

  return (
    <>
      <div className={styles.topbar}>
        <Link href="/dashboard/universal" className={styles.logo}>
          <Image
            src="/brand/af-shield-transparent.png"
            alt="AllFantasy"
            width={26}
            height={26}
            className={styles.logoMark}
          />
          <span className={styles.wordmark}>AllFantasy</span>
        </Link>
        <div className={styles.spacer} />
        <Link href="/chimmy" className={styles.intelBtn}>
          ✦ Intelligence
        </Link>
        <Link href="/messages" className={styles.iconBtn} aria-label="Messages">
          💬
        </Link>
        <Link href="/app/notifications" className={styles.iconBtn} aria-label="Notifications">
          🔔
        </Link>
        {guestMode ? (
          <Link href="/signup?next=%2Fdashboard%2Funiversal" className={styles.userChip}>
            <div className={styles.userText}>
              <div className={styles.userName}>{displayName}</div>
              <div className={styles.userRole}>{role} · Sign up to save</div>
            </div>
          </Link>
        ) : (
          <button
            type="button"
            className={styles.userChip}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            <div className={styles.avatar}>
              <IdentityImageRenderer
                avatarUrl={profile?.profileImageUrl}
                avatarPreset={profile?.avatarPreset}
                displayName={profile?.displayName}
                username={profile?.username}
                size="sm"
              />
            </div>
            <div className={styles.userText}>
              <div className={styles.userName}>{displayName}</div>
              <div className={styles.userRole}>{role}</div>
            </div>
            <span className={styles.caret}>▾</span>
          </button>
        )}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tbLeft}>
          <button type="button" className={styles.sportPill}>
            🏈 All sports ▾
          </button>
          <div className={styles.search}>
            <span aria-hidden>🔍</span>
            <input type="search" placeholder="Search players, teams, leagues…" />
            <span className={styles.kbd}>⌘K</span>
          </div>
        </div>
        <div className={styles.tbRight}>
          <span
            className={styles.liveChip}
            data-health={dataHealth}
            title={
              dataHealth === 'connected'
                ? 'Sports data and weather caches synced within the last 24 hours'
                : dataHealth === 'degraded'
                  ? 'Sports data or weather cache hasn’t synced recently — checking again on next load'
                  : 'Checking live data connection…'
            }
          >
            <span className={styles.liveDot} />
            {dataHealth === 'connected' ? 'Live data connected' : dataHealth === 'degraded' ? 'Data sync delayed' : 'Checking…'}
          </span>
          <Link href="/dashboard/universal#os-strip" className={styles.osBtn}>
            ⊞ Quick nav
          </Link>
        </div>
      </div>

      {settingsOpen && <SettingsMenu onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
