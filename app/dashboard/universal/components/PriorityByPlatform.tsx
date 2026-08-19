'use client'

/**
 * "The single most important need per connected platform" — real, derived
 * from the same rule-based signal UniversalLeaguesBoard already computes
 * (roster legality, draft scheduling, in-season status), grouped by
 * platform and reduced to the single most urgent league per platform. No
 * fabricated matchup/trade copy — the mockup's example cards ("3 roster
 * issues", "Draft in 6 weeks") are illustrative; this renders whatever the
 * real worst signal for that platform actually is.
 */

import Link from 'next/link'
import type { UserLeague } from '@/app/dashboard/types'
import styles from './universal-dashboard.module.css'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

type SignalTone = 'attention' | 'info' | 'good'

const TONE_RANK: Record<SignalTone, number> = { attention: 0, info: 1, good: 2 }
const TONE_CLASS: Record<SignalTone, string> = {
  attention: 'prioNeedAtt',
  info: 'prioNeedInfo',
  good: 'prioNeedGood',
}
const TONE_ICON: Record<SignalTone, string> = { attention: '⚠', info: '🗓', good: '✓' }

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

function deriveSignal(league: BoardLeague, rosterIssues: number): { tone: SignalTone; label: string; sub: string; cta: string } {
  if (rosterIssues > 0) {
    return {
      tone: 'attention',
      label: `${rosterIssues} lineup issue${rosterIssues === 1 ? '' : 's'} to fix`,
      sub: league.name || 'Untitled league',
      cta: 'Fix lineup →',
    }
  }

  const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()

  if (status === 'pre_draft' || status === 'predraft' || status === 'setup') {
    const when = formatDate(league.draftDate)
    return league.draftDate
      ? { tone: 'info', label: `Draft ${when}`, sub: league.name || 'Untitled league', cta: 'Prep war room →' }
      : { tone: 'attention', label: 'Draft not scheduled', sub: league.name || 'Untitled league', cta: 'Schedule draft →' }
  }

  if (status === 'drafting') {
    return { tone: 'attention', label: 'Draft in progress', sub: league.name || 'Untitled league', cta: 'Join draft room →' }
  }

  if (status === 'in_season' || status === 'inseason' || status === 'playoffs') {
    return {
      tone: 'good',
      label: "You're all set",
      sub: typeof league.currentWeek === 'number' && league.currentWeek > 0 ? `${league.name} · Week ${league.currentWeek}` : league.name || 'Untitled league',
      cta: 'View league →',
    }
  }

  return { tone: 'info', label: statusLabel(league.status), sub: league.name || 'Untitled league', cta: 'View league →' }
}

export function PriorityByPlatform({ leagues, rosterIssues }: { leagues: BoardLeague[]; rosterIssues: Record<string, number> }) {
  const byPlatform = new Map<string, BoardLeague[]>()
  for (const l of leagues) {
    const key = String(l.platform ?? '').toLowerCase() || 'other'
    const arr = byPlatform.get(key)
    if (arr) arr.push(l)
    else byPlatform.set(key, [l])
  }

  const cards = Array.from(byPlatform.entries())
    .map(([platform, plLeagues]) => {
      let best: { league: BoardLeague; signal: ReturnType<typeof deriveSignal> } | null = null
      for (const l of plLeagues) {
        const signal = deriveSignal(l, rosterIssues[l.id] ?? 0)
        if (!best || TONE_RANK[signal.tone] < TONE_RANK[best.signal.tone]) {
          best = { league: l, signal }
        }
      }
      return best ? { platform, count: plLeagues.length, ...best } : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => TONE_RANK[a.signal.tone] - TONE_RANK[b.signal.tone])

  if (cards.length === 0) return null

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <h2>Priority by Platform</h2>
        </div>
        <Link href="/dashboard/universal" className={styles.sectionHeadLink}>
          Manage all →
        </Link>
      </div>
      <div className={styles.prio}>
        {cards.map((c) => {
          const href = `/league/${encodeURIComponent(c.league.navigationLeagueId ?? c.league.id)}`
          return (
            <Link key={c.platform} href={href} className={styles.prioCard}>
              <div className={styles.prioHead}>
                <span className={styles.platBadge}>{platformLabel(c.platform)}</span>
                <span className={styles.prioCount}>{c.count} league{c.count === 1 ? '' : 's'}</span>
              </div>
              <div className={`${styles.prioNeed} ${styles[TONE_CLASS[c.signal.tone]]}`}>
                {TONE_ICON[c.signal.tone]} {c.signal.label}
              </div>
              <div className={styles.prioSub}>{c.signal.sub}</div>
              <span className={styles.prioCta}>{c.signal.cta}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}
