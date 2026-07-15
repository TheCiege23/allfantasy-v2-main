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

type DataProviderStatus = 'checking' | 'connected' | 'degraded'
type FeedKey = 'scores' | 'injuries' | 'news' | 'projections' | 'weather'
type FeedHealth = { ok: boolean; lastSyncedAt: string | null }
type DataProviderHealth = { status: DataProviderStatus; feeds: Record<FeedKey, FeedHealth> | null }

const FEED_LABELS: Record<FeedKey, string> = {
  scores: 'Scores',
  injuries: 'Injuries',
  news: 'News',
  projections: 'Projections',
  weather: 'Weather',
}
const FEED_ORDER: FeedKey[] = ['scores', 'injuries', 'news', 'projections', 'weather']

/** Human "updated Xm/h/d ago" from an ISO timestamp; honest "no recent sync" when absent. */
function relativeSync(iso: string | null): string {
  if (!iso) return 'no recent sync'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `updated ${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `updated ${hr}h ago`
  return `updated ${Math.floor(hr / 24)}d ago`
}

/** Per-feed last-updated lines for the chip tooltip; falls back to a summary before data loads. */
function feedTooltip(health: DataProviderHealth): string {
  if (health.status === 'checking') return 'Checking live data connection…'
  if (!health.feeds) {
    return health.status === 'connected'
      ? 'Live sports data synced within the last 24 hours'
      : 'Live sports data hasn’t synced in over 24 hours — retrying on next load'
  }
  return FEED_ORDER.map((k) => `${FEED_LABELS[k]} · ${relativeSync(health.feeds![k]?.lastSyncedAt ?? null)}`).join('\n')
}

/**
 * Real backing for the "Live data connected" chip — previously hardcoded, unconditional
 * markup with no check at all (AF_DATA_PROVENANCE_AUDIT.md demo risk #3). Queries
 * /api/health/data-providers, which reads actual per-feed freshness (Scores/Injuries/News/
 * Projections from the normalized live-chain tables + Weather cache). `ok` colors the chip;
 * `feeds` feeds the per-feed last-updated tooltip.
 */
function useDataProviderHealth(): DataProviderHealth {
  const [health, setHealth] = useState<DataProviderHealth>({ status: 'checking', feeds: null })

  useEffect(() => {
    let cancelled = false
    fetch('/api/health/data-providers')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { ok?: boolean; feeds?: Record<FeedKey, FeedHealth> | null }) => {
        if (!cancelled) {
          setHealth({ status: data.ok ? 'connected' : 'degraded', feeds: data.feeds ?? null })
        }
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: 'degraded', feeds: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return health
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
  const dataStatus = dataHealth.status

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
            data-health={dataStatus}
            title={feedTooltip(dataHealth)}
          >
            <span className={styles.liveDot} />
            {dataStatus === 'connected' ? 'Live data connected' : dataStatus === 'degraded' ? 'Data sync delayed' : 'Checking…'}
          </span>
          <Link href="/dashboard/universal#os-strip" className={styles.osBtn}>
            ⊞ Operating Systems
          </Link>
        </div>
      </div>

      {settingsOpen && <SettingsMenu onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
