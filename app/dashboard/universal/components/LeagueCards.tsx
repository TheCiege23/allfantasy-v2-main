'use client'

/**
 * League grid re-skinned to match _design-mocks/universal-dashboard.html's
 * `.lcard` structure/tokens. Deliberately omits the mockup's "2nd of 12 ·
 * 11-4" rank/record row — `getDashboardLeagueListForUser` doesn't carry
 * per-team wins/losses/pointsFor at the list level (only roster identity
 * fields), so that number isn't honestly available here. It renders inside
 * each league's own page, which does compute real standings.
 */

import Link from 'next/link'
import Image from 'next/image'
import type { UserLeague } from '@/app/dashboard/types'
import styles from './universal-dashboard.module.css'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

type SignalTone = 'attention' | 'info' | 'good'

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  cbs: 'CBS',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  allfantasy: 'AllFantasy',
  af: 'AllFantasy',
  manual: 'AllFantasy',
  native: 'AllFantasy',
}

function isNativePlatform(platform: string | undefined): boolean {
  const p = String(platform ?? '').toLowerCase()
  return p === 'allfantasy' || p === 'af' || p === 'manual' || p === 'native'
}

function platformLabel(platform: string | undefined): string {
  const key = String(platform ?? '').toLowerCase()
  return PLATFORM_LABELS[key] ?? (platform ? String(platform) : 'Other')
}

function statusLabel(status: string | undefined | null): string {
  const s = String(status ?? '').toLowerCase()
  if (s === 'pre_draft' || s === 'predraft' || s === 'setup') return 'Pre-draft'
  if (s === 'drafting') return 'Drafting'
  if (s === 'in_season' || s === 'inseason') return 'In season'
  if (s === 'complete' || s === 'completed') return 'Complete'
  if (s === 'playoffs') return 'Playoffs'
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function deriveSignal(league: BoardLeague, rosterIssues: number): { tone: SignalTone; label: string } {
  if (rosterIssues > 0) {
    return { tone: 'attention', label: `${rosterIssues} lineup issue${rosterIssues === 1 ? '' : 's'} to fix` }
  }
  const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
  if (status === 'pre_draft' || status === 'predraft' || status === 'setup') {
    const when = formatDate(league.draftDate)
    return when ? { tone: 'info', label: `Draft ${when}` } : { tone: 'attention', label: 'Draft not scheduled' }
  }
  if (status === 'drafting') return { tone: 'attention', label: 'Draft in progress' }
  if (status === 'in_season' || status === 'inseason' || status === 'playoffs') {
    return {
      tone: 'good',
      label: typeof league.currentWeek === 'number' && league.currentWeek > 0 ? `In season · Week ${league.currentWeek}` : statusLabel(status),
    }
  }
  if (status === 'complete' || status === 'completed') return { tone: 'info', label: 'Season complete' }
  return { tone: 'info', label: statusLabel(league.status) }
}

const SIGNAL_CLASS: Record<SignalTone, string> = { attention: 'signalAtt', info: 'signalInfo', good: 'signalGood' }
const SIGNAL_ICON: Record<SignalTone, string> = { attention: '⚠', info: '🗓', good: '✓' }

export function LeagueCards({ leagues, rosterIssues }: { leagues: BoardLeague[]; rosterIssues: Record<string, number> }) {
  return (
    <div className={styles.leagues}>
      {leagues.map((league) => {
        const signal = deriveSignal(league, rosterIssues[league.id] ?? 0)
        const href = `/league/${encodeURIComponent(league.navigationLeagueId ?? league.id)}`
        const native = isNativePlatform(league.platform)
        const logo = league.logoUrl || league.avatarUrl || null
        const format = league.format || league.leagueType || null

        return (
          <Link key={league.id} href={href} className={styles.lcard}>
            <div className={`${styles.lcardHead} ${native ? styles.lcardHeadAf : ''}`}>
              <span className={styles.statusChip}>{statusLabel(league.status)}</span>
              <div className={styles.lcTop}>
                <div className={styles.lcLogo}>
                  {native ? (
                    <Image src="/brand/af-shield-transparent.png" alt="" width={22} height={22} />
                  ) : logo ? (
                    <img src={logo} alt="" style={{ height: '100%', width: '100%', objectFit: 'cover' }} />
                  ) : (
                    (league.name || '?')[0]?.toUpperCase()
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.lcName}>{league.name || 'Untitled league'}</div>
                  <div className={styles.lcMeta}>
                    {league.teamCount ? `${league.teamCount}-Team ` : ''}
                    {league.scoring ? `${league.scoring} · ` : ''}
                    {league.sport || ''}
                  </div>
                </div>
              </div>
              <span className={styles.platBadge} style={{ marginTop: 10 }}>
                {platformLabel(league.platform)}
              </span>
            </div>
            <div className={styles.lcBody}>
              <div className={styles.lcStat3}>
                <div>
                  <span className={styles.lcStatLabel}>Format</span>
                  <span className={styles.lcStatVal}>{format ? String(format).replace(/_/g, ' ') : '—'}</span>
                </div>
                <div>
                  <span className={styles.lcStatLabel}>Teams</span>
                  <span className={styles.lcStatVal}>{league.teamCount || '—'}</span>
                </div>
                <div>
                  <span className={styles.lcStatLabel}>Role</span>
                  <span className={styles.lcStatVal}>{league.isCommissioner || league.userRole === 'commissioner' ? 'Commish' : 'Member'}</span>
                </div>
              </div>
              <span className={`${styles.signal} ${styles[SIGNAL_CLASS[signal.tone]]}`}>
                {SIGNAL_ICON[signal.tone]} {signal.label}
              </span>
              <span className={styles.goLeague}>Go to League</span>
            </div>
          </Link>
        )
      })}
      <Link href="/create-league" className={styles.emptyLcard}>
        <Image src="/brand/af-shield-transparent.png" alt="" width={32} height={32} />
        <div style={{ fontSize: 13, fontWeight: 800 }}>Create an AF league</div>
        <div style={{ fontSize: 11.5 }}>Start a native AllFantasy league, or import from any platform.</div>
      </Link>
    </div>
  )
}
