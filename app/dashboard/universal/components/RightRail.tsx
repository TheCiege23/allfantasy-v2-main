'use client'

/**
 * Right rail: Your Ranking (real level/XP from /api/user/rank), Direct
 * Messages (real threads from /api/shared/chat/threads), Trending Players
 * (real crowd-add/drop data from /api/sports/trending). No fabricated
 * numbers — each card renders nothing (or a neutral empty state) when its
 * real source has no data, rather than showing mockup placeholder values.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PlatformChatThread } from '@/types/platform-shared'
import styles from './universal-dashboard.module.css'

type RankPayload = {
  level: number | null
  levelName: string | null
  tierName: string | null
  xpTotal: number | null
  xpIntoLevel: number | null
  xpForLevel: number | null
}

type TrendingPlayer = {
  id: string
  playerName: string | null
  position: string | null
  team: string | null
  netTrend: number
  addCount: number
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export function RightRail() {
  const [rank, setRank] = useState<RankPayload | null>(null)
  const [threads, setThreads] = useState<PlatformChatThread[]>([])
  const [trending, setTrending] = useState<TrendingPlayer[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/rank', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setRank(j)
      })
      .catch(() => {})
    fetch('/api/shared/chat/threads', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { threads?: PlatformChatThread[] } | null) => {
        if (!cancelled && Array.isArray(j?.threads)) setThreads(j.threads.slice(0, 3))
      })
      .catch(() => {})
    fetch('/api/sports/trending?sport=nfl&limit=3', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { players?: TrendingPlayer[] } | null) => {
        if (!cancelled && Array.isArray(j?.players)) setTrending(j.players.slice(0, 3))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const xpProgress =
    rank?.xpIntoLevel != null && rank?.xpForLevel ? Math.min(100, Math.round((rank.xpIntoLevel / rank.xpForLevel) * 100)) : 0

  return (
    <aside className={styles.rail}>
      <div className={styles.rcard}>
        <div className={styles.rcardHead}>
          <h3>Your Ranking</h3>
        </div>
        {rank?.levelName ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{rank.tierName || rank.levelName}</div>
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>Level {rank.level}</div>
            {rank.xpForLevel ? (
              <>
                <div
                  style={{
                    marginTop: 10,
                    height: 6,
                    borderRadius: 999,
                    background: 'var(--border-2)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${xpProgress}%`,
                      background: 'linear-gradient(90deg, var(--blue), var(--cyan))',
                      borderRadius: 999,
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--faint)' }}>
                  {rank.xpIntoLevel?.toLocaleString()} / {rank.xpForLevel?.toLocaleString()} XP
                </div>
              </>
            ) : null}
          </>
        ) : (
          <p style={{ fontSize: 11.5, color: 'var(--faint)' }}>Play a season to start earning career rank.</p>
        )}
      </div>

      <div className={styles.rcard}>
        <div className={styles.rcardHead}>
          <h3>Direct Messages</h3>
          <Link href="/messages" style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textDecoration: 'none' }}>
            New Message
          </Link>
        </div>
        {threads.length === 0 ? (
          <p style={{ fontSize: 11.5, color: 'var(--faint)' }}>No conversations yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {threads.map((t) => (
              <Link
                key={t.id}
                href="/messages"
                style={{ display: 'flex', gap: 8, textDecoration: 'none', color: 'var(--text)' }}
              >
                <div
                  style={{
                    height: 30,
                    width: 30,
                    borderRadius: 9,
                    background: 'linear-gradient(135deg, var(--blue), var(--purple))',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {(t.title || '?').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <span style={{ color: 'var(--faint)', fontWeight: 500, flexShrink: 0 }}>{timeAgo(t.lastMessageAt)}</span>
                  </div>
                  {t.unreadCount > 0 ? (
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 2,
                        fontSize: 10,
                        fontWeight: 800,
                        color: 'var(--cyan)',
                      }}
                    >
                      {t.unreadCount} new
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className={styles.rcard}>
        <div className={styles.rcardHead}>
          <h3>Trending Players</h3>
          <Link href="/my-players" style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textDecoration: 'none' }}>
            View all
          </Link>
        </div>
        {trending.length === 0 ? (
          <p style={{ fontSize: 11.5, color: 'var(--faint)' }}>No trending data synced yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {trending.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--faint)', fontWeight: 800, width: 12 }}>{i + 1}.</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {p.playerName || 'Unknown'}{' '}
                  <span style={{ color: 'var(--faint)', fontWeight: 500 }}>
                    {p.position}
                    {p.team ? `·${p.team}` : ''}
                  </span>
                </span>
                <span style={{ color: p.netTrend >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 800, flexShrink: 0 }}>
                  {p.netTrend >= 0 ? '▲' : '▼'} {p.addCount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
