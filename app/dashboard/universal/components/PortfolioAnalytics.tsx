'use client'

/**
 * Portfolio Analytics.
 *
 * The mockup's original "Season Performance Index" line chart and "Points
 * For · last 6 weeks" bar chart both need real historical weekly scoring
 * aggregated across every league a user plays — that cross-league weekly
 * rollup still doesn't exist (`getDashboardLeagueListForUser` carries no
 * per-week point history), so those two specific metrics stay out of scope
 * rather than being faked. In their place: two real charts built entirely
 * from data already loaded into this component (`leagues`, the same list
 * the league board renders) — "Leagues by Season" and "Leagues by
 * Platform" — both genuine counts, zero new API calls, zero sample data.
 * "This Week's Best Matchup" is unchanged and still real, via the same
 * `buildMatchupCenterPayload` the League Hub Matchup tab uses.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { UserLeague } from '@/app/dashboard/types'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import styles from './universal-dashboard.module.css'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

// AF dataviz palette — cycled per category, never used as a semantic (success/warning)
// color so it stays distinct from status tokens elsewhere in the design system.
const CHART_PALETTE = ['#0891b2', '#8b5cf6', '#d97706', '#059669']

const PLATFORM_LABELS: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MFL',
  fantrax: 'Fantrax',
  fleaflicker: 'Fleaflicker',
  allfantasy: 'AllFantasy',
  af: 'AllFantasy',
  native: 'AllFantasy',
  manual: 'Manual',
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform
}

type CountBucket = { label: string; count: number }

function countBy<T>(items: T[], keyFn: (item: T) => string): CountBucket[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyFn(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }))
}

/** Honest axis: starts at 0, bar length is a true linear proportion of the max value. */
function BarChart({ data, orientation }: { data: CountBucket[]; orientation: 'horizontal' | 'vertical' }) {
  if (data.length === 0) return null
  const max = Math.max(...data.map((d) => d.count), 1)

  if (orientation === 'vertical') {
    return (
      <div className={styles.barChartVertical}>
        {data.map((d, i) => (
          <div key={d.label} className={styles.barChartVCol}>
            <div className={styles.barChartVTrack}>
              <div
                className={styles.barChartVFill}
                style={{
                  height: `${Math.max((d.count / max) * 100, 4)}%`,
                  background: CHART_PALETTE[i % CHART_PALETTE.length],
                }}
                title={`${d.label}: ${d.count}`}
              />
            </div>
            <div className={styles.barChartVValue}>{d.count}</div>
            <div className={styles.barChartVLabel}>{d.label}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.barChartHorizontal}>
      {data.map((d, i) => (
        <div key={d.label} className={styles.barChartHRow}>
          <div className={styles.barChartHLabel}>{d.label}</div>
          <div className={styles.barChartHTrack}>
            <div
              className={styles.barChartHFill}
              style={{
                width: `${Math.max((d.count / max) * 100, 4)}%`,
                background: CHART_PALETTE[i % CHART_PALETTE.length],
              }}
            />
          </div>
          <div className={styles.barChartHValue}>{d.count}</div>
        </div>
      ))}
    </div>
  )
}

import { formatWinProbabilityPercents, winProbabilitySortDistance } from '@/lib/matchup-center/winProbability'

type MatchupSide = { teamName: string; totalPoints: number; projectedTotal: number }
type MatchupPayload = {
  leagueId: string
  matchupStatus: 'upcoming' | 'live' | 'final'
  left: MatchupSide
  right: MatchupSide
  winProbabilityLeft: number | null
}

export function PortfolioAnalytics({ leagues }: { leagues: BoardLeague[] }) {
  const [best, setBest] = useState<{ leagueName: string; leagueId: string; navId: string; payload: MatchupPayload } | null>(null)
  const [loading, setLoading] = useState(true)

  const leaguesBySeason = useMemo(() => {
    const buckets = countBy(
      leagues.filter((l) => l.season != null),
      (l) => String(l.season)
    )
    return buckets.sort((a, b) => Number(a.label) - Number(b.label)).slice(-8)
  }, [leagues])

  const leaguesByPlatform = useMemo(() => {
    const buckets = countBy(leagues, (l) => platformLabel(l.platform))
    return buckets.sort((a, b) => b.count - a.count)
  }, [leagues])

  useEffect(() => {
    let cancelled = false
    const candidates = leagues.filter((l) => String(l.status ?? '').toLowerCase().includes('season') || l.status === 'playoffs')
    if (candidates.length === 0) {
      setLoading(false)
      return
    }
    Promise.all(
      candidates.slice(0, 12).map((l) =>
        fetch(`/api/leagues/${encodeURIComponent(l.navigationLeagueId ?? l.id)}/matchup-center`, {
          cache: 'no-store',
          credentials: 'include',
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload: MatchupPayload | null) => (payload ? { league: l, payload } : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return
      const live = results.filter((r): r is NonNullable<typeof r> => r !== null && (r.payload.matchupStatus === 'live' || r.payload.matchupStatus === 'upcoming'))
      // "Best" = closest real contest — smallest |winProbabilityLeft - 50|, live matchups first.
      live.sort((a, b) => {
        if (a.payload.matchupStatus !== b.payload.matchupStatus) return a.payload.matchupStatus === 'live' ? -1 : 1
        const distA = winProbabilitySortDistance(a.payload.winProbabilityLeft)
        const distB = winProbabilitySortDistance(b.payload.winProbabilityLeft)
        return distA - distB
      })
      const top = live[0]
      if (top) {
        setBest({
          leagueName: top.league.name || 'Untitled league',
          leagueId: top.league.id,
          navId: top.league.navigationLeagueId ?? top.league.id,
          payload: top.payload,
        })
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [leagues])

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <h2>Portfolio Analytics</h2>
        </div>
      </div>
      <div className={styles.analytics}>
        <div className={styles.chartCard}>
          <h3>Leagues by Season</h3>
          {leaguesBySeason.length > 0 ? (
            <>
              <BarChart data={leaguesBySeason} orientation="vertical" />
              <p className={styles.sub} style={{ marginTop: 10 }}>
                Real count of your leagues per season, most recent {leaguesBySeason.length} seasons shown.
                Week-by-week scoring trend charts need a cross-league scoring rollup that doesn&apos;t exist yet —
                real per-league scoring trends are available today on each league&apos;s own Matchups tab.
              </p>
            </>
          ) : (
            <p className={styles.sub}>Import a league to see your season-by-season activity here.</p>
          )}
        </div>
        <div className={styles.miniStack}>
          <div className={styles.mini}>
            <div className={styles.mh}>Leagues by Platform</div>
            {leaguesByPlatform.length > 0 ? (
              <BarChart data={leaguesByPlatform} orientation="horizontal" />
            ) : (
              <p className={styles.sub} style={{ marginTop: 8 }}>No leagues connected yet.</p>
            )}
          </div>
          <div className={styles.mini}>
            <div className={styles.mh}>This Week&apos;s Best Matchup</div>
            <FeatureGate featureId="matchup_explanations" featureNameOverride="Matchup win-probability analysis">
              {loading ? (
                <p className={styles.sub} style={{ marginTop: 8 }}>
                  Checking your leagues…
                </p>
              ) : best ? (
                <Link href={`/league/${encodeURIComponent(best.navId)}?tab=matchups`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  {(() => {
                    const pcts = formatWinProbabilityPercents(best.payload.winProbabilityLeft)
                    return pcts ? (
                      <>
                        <div className={styles.wpRow}>
                          <span>{pcts.leftPct}%</span>
                          <span>{pcts.rightPct}%</span>
                        </div>
                        <div className={styles.wpBar}>
                          <span className={styles.wpWin} style={{ width: `${pcts.leftPct}%` }} />
                          <span className={styles.wpLose} style={{ width: `${pcts.rightPct}%` }} />
                        </div>
                      </>
                    ) : null
                  })() ?? (
                    <p className={styles.sub} style={{ marginTop: 8 }}>
                      Win probability unavailable — real projections are missing for some starters.
                    </p>
                  )}
                  <div className={styles.wpTeams}>
                    <span>
                      {best.payload.left.teamName} · {best.payload.left.totalPoints.toFixed(1)} pts
                    </span>
                    <span>
                      {best.payload.right.teamName} · {best.payload.right.totalPoints.toFixed(1)} pts
                    </span>
                  </div>
                  <div className={styles.sub} style={{ marginTop: 8 }}>
                    {best.leagueName}
                  </div>
                </Link>
              ) : (
                <p className={styles.sub} style={{ marginTop: 8 }}>
                  No live or upcoming matchups this week yet.
                </p>
              )}
            </FeatureGate>
          </div>
        </div>
      </div>
    </>
  )
}
