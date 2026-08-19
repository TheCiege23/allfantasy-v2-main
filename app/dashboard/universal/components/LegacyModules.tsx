'use client'

/**
 * Legacy fold-in: Overview/Legacy Score, Rankings, and Compare as real
 * dashboard modules, reusing the SAME real logic /af-legacy already uses —
 * not a rebuild:
 *
 * - Overview: `computeCompositeProfile` (lib/legacy/overview-scoring.ts,
 *   a pure function, no rebuild needed) fed by GET /api/legacy/profile
 *   (the same route af-legacy/page.tsx calls), rendered with the same
 *   OverviewReportCard/OverviewLanes/OverviewInsights components
 *   af-legacy uses. Requires a linked Sleeper username (profile.sleeperUsername)
 *   -- af-legacy's own Legacy Score is itself Sleeper-history-based, not a
 *   feature gap introduced here. Shows an honest empty state otherwise.
 * - Rankings: LeagueRankingsV2Panel (components/LeagueRankingsV2Panel.tsx)
 *   dropped in directly — it's a fully self-fetching component (its own
 *   GET /api/rankings/league-v2), never wired into af-legacy's monolith
 *   state, just needs a real leagueId.
 * - Compare: the same runManagerComparison logic af-legacy's Compare tab
 *   uses, lifted into a standalone call against the same real
 *   POST /api/legacy/compare (live Sleeper-backed comparison, unchanged).
 *   Rivalry Week cards are a DIFFERENT feature (only reachable today via
 *   the unrelated league-transfer preview tool) and are deliberately left
 *   out of this fold-in rather than wired through an unrelated endpoint.
 */

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { UserLeague } from '@/app/dashboard/types'
import { useSettingsProfile } from '@/hooks/useSettingsProfile'
import { computeCompositeProfile, type CompositeProfile, type LeagueRecord } from '@/lib/legacy/overview-scoring'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import styles from './universal-dashboard.module.css'

const OverviewReportCard = dynamic(() => import('@/app/af-legacy/components/OverviewReportCard'), { ssr: false })
const OverviewLanes = dynamic(() => import('@/app/af-legacy/components/OverviewLanes'), { ssr: false })
const OverviewInsights = dynamic(() => import('@/app/af-legacy/components/OverviewInsights'), { ssr: false })
const LeagueRankingsV2Panel = dynamic(() => import('@/components/LeagueRankingsV2Panel'), { ssr: false })

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

type LegacyTab = 'overview' | 'rankings' | 'compare'

type ComparisonResult = {
  winner?: string
  comparable_formats?: string[]
  fair_comparison_possible?: boolean
  head_to_head_breakdown?: { redraft_winner?: string; dynasty_winner?: string; specialty_winner?: string }
}

export function LegacyModules({
  leagues,
  guestSleeperUsername = null,
}: {
  leagues: BoardLeague[]
  /** Guest preview: sourced from the signed guest-session cookie instead of a real AppUser profile. */
  guestSleeperUsername?: string | null
}) {
  const [tab, setTab] = useState<LegacyTab>('overview')
  const { profile } = useSettingsProfile()
  const primaryLeague = leagues[0] ?? null
  const effectiveUsername = guestSleeperUsername ?? profile?.sleeperUsername ?? null

  return (
    <>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <h2>🏅 Your Legacy</h2>
        </div>
        <Link href="/af-legacy" className={styles.sectionHeadLink}>
          Open Legacy Hub →
        </Link>
      </div>
      <div className={styles.legacyCard}>
        <div className={styles.legacyTabs}>
          {(['overview', 'rankings', 'compare'] as LegacyTab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.legacyTab} ${tab === t ? styles.legacyTabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'overview' ? 'Legacy Score' : t === 'rankings' ? 'Rankings' : 'Compare'}
            </button>
          ))}
        </div>
        <div className={styles.legacyBody}>
          {tab === 'overview' && <LegacyOverviewModule sleeperUsername={effectiveUsername} />}
          {tab === 'rankings' && <LegacyRankingsModule league={primaryLeague} username={effectiveUsername ?? undefined} />}
          {tab === 'compare' && <LegacyCompareModule defaultUsername={effectiveUsername ?? ''} />}
        </div>
      </div>
    </>
  )
}

function LegacyOverviewModule({ sleeperUsername }: { sleeperUsername: string | null }) {
  const [profile, setProfile] = useState<CompositeProfile | null>(null)
  const [tier, setTier] = useState<{ tierName?: string; tierLevel?: number; careerXp?: number }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sleeperUsername) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetch(`/api/legacy/profile?sleeper_username=${encodeURIComponent(sleeperUsername)}`, { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { league_history?: LeagueRecord[]; ranking_preview?: { career?: { tier_name?: string; level?: number; total_xp?: number } } } | null) => {
        if (cancelled || !data) return
        const records = Array.isArray(data.league_history) ? data.league_history : []
        if (records.length > 0) setProfile(computeCompositeProfile(records))
        setTier({
          tierName: data.ranking_preview?.career?.tier_name,
          tierLevel: data.ranking_preview?.career?.level,
          careerXp: data.ranking_preview?.career?.total_xp,
        })
      })
      .catch(() => setError('Could not load your Legacy Score right now.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [sleeperUsername])

  if (!sleeperUsername) {
    return (
      <div className={styles.legacyEmpty}>
        Your Legacy Score is built from your Sleeper league history.{' '}
        <Link href="/settings">Link your Sleeper account</Link> to see it here.
      </div>
    )
  }
  if (loading) return <p style={{ fontSize: 12, color: 'var(--faint)' }}>Loading your Legacy Score…</p>
  if (error) return <p style={{ fontSize: 12, color: 'var(--faint)' }}>{error}</p>
  if (!profile) {
    return (
      <div className={styles.legacyEmpty}>
        No league history found yet for @{sleeperUsername}.{' '}
        <Link href="/af-legacy">Import your history in the Legacy Hub</Link> to build your score.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverviewReportCard profile={profile} tierName={tier.tierName} tierLevel={tier.tierLevel} careerXp={tier.careerXp} />
      <OverviewLanes lanes={profile.lanes} />
      <OverviewInsights profile={profile} lanes={profile.lanes} />
    </div>
  )
}

function LegacyRankingsModule({ league, username }: { league: BoardLeague | null; username?: string }) {
  if (!league) {
    return <div className={styles.legacyEmpty}>Connect or create a league to see league rankings here.</div>
  }
  const leagueId = league.navigationLeagueId ?? league.id
  return (
    <FeatureGate featureId="league_rankings" featureNameOverride="League Rankings">
      <LeagueRankingsV2Panel leagueId={leagueId} leagueName={league.name ?? undefined} username={username} />
    </FeatureGate>
  )
}

function LegacyCompareModule({ defaultUsername }: { defaultUsername: string }) {
  const [usernameA, setUsernameA] = useState(defaultUsername)
  const [usernameB, setUsernameB] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ComparisonResult | null>(null)

  useEffect(() => {
    if (defaultUsername) setUsernameA(defaultUsername)
  }, [defaultUsername])

  async function runCompare() {
    if (!usernameA.trim() || !usernameB.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/legacy/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username_a: usernameA.trim(), username_b: usernameB.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Comparison failed.')
        return
      }
      setResult(data.comparison ?? null)
    } catch {
      setError('Comparison failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className={styles.compareRow}>
        <div className={styles.compareField}>
          <label>Your Sleeper username</label>
          <input value={usernameA} onChange={(e) => setUsernameA(e.target.value)} placeholder="you" />
        </div>
        <div className={styles.compareField}>
          <label>Compare against</label>
          <input value={usernameB} onChange={(e) => setUsernameB(e.target.value)} placeholder="opponent username" />
        </div>
        <button type="button" className={styles.compareBtn} onClick={runCompare} disabled={loading}>
          {loading ? 'Comparing…' : 'Compare'}
        </button>
      </div>
      {error && <p style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</p>}
      {result && (
        <div className={styles.compareResult}>
          <div className={styles.compareWinner}>{result.winner ? `${result.winner} leads overall` : 'Comparison complete'}</div>
          <div className={styles.compareGrid}>
            {result.head_to_head_breakdown?.redraft_winner && (
              <div className={styles.compareStat}>
                <div className={styles.compareStatLabel}>Redraft</div>
                <div className={styles.compareStatVal}>{result.head_to_head_breakdown.redraft_winner}</div>
              </div>
            )}
            {result.head_to_head_breakdown?.dynasty_winner && (
              <div className={styles.compareStat}>
                <div className={styles.compareStatLabel}>Dynasty</div>
                <div className={styles.compareStatVal}>{result.head_to_head_breakdown.dynasty_winner}</div>
              </div>
            )}
            {result.head_to_head_breakdown?.specialty_winner && (
              <div className={styles.compareStat}>
                <div className={styles.compareStatLabel}>Specialty</div>
                <div className={styles.compareStatVal}>{result.head_to_head_breakdown.specialty_winner}</div>
              </div>
            )}
          </div>
          {result.fair_comparison_possible === false && (
            <p style={{ marginTop: 10, fontSize: 11, color: 'var(--faint)' }}>
              Limited overlap in comparable formats — {(result.comparable_formats ?? []).join(', ') || 'none'} shared.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
