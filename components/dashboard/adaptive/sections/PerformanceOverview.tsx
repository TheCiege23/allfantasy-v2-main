'use client'

/**
 * "Performance Overview" — the four analytics cards.
 *
 * Three of the four are wired to real, server-computed league data:
 *   Weekly Scoring Trend    → weeklyPointsDistribution (my roster) + the league mean
 *   Position Strength       → positionValues indexed against the league average
 *   Roster Strength Radar   → the same values, as a shape vs the average
 *
 * The fourth, Waiver Efficiency, has NO source in this codebase — there is no
 * points-per-FAAB-dollar or spend-vs-value metric anywhere — so it renders an honest empty
 * state naming the gap. It is deliberately still here, in its designed position, rather
 * than quietly dropped: the layout is the design's, and the card says why it's blank.
 *
 * Layout: desktop 4-up, tablet 2-up, mobile stacked.
 */

import { HorizontalBarChart, LineAreaChart, RadarChart } from '../charts'
import { positionTone, type LeagueAnalytics } from '../hooks/useLeagueAnalytics'
import type { DeviceKind } from '../hooks/useDeviceKind'
import { LockableCard, NoMetric } from '../ui/Gating'

export function PerformanceOverview({
  analytics, unavailable, loading, device, locked, onUnlock, scope,
}: {
  analytics: LeagueAnalytics | null
  unavailable: 'no-league' | 'not-supported' | 'failed' | null
  loading: boolean
  device: DeviceKind
  locked: boolean
  onUnlock: () => void
  /**
   * Why analytics may be unavailable before any request is made. `no-provider` is its own
   * case because the league IS selected — it just has no provider id for the rankings
   * engine to resolve, which "select a league" would misdescribe.
   */
  scope: { kind: 'ok' | 'no-league' | 'no-provider'; leagueName?: string }
}) {
  const columns = device === 'desktop' ? 'repeat(4,1fr)' : device === 'tablet' ? 'repeat(2,1fr)' : '1fr'

  // One reason string for the three league-sourced cards, so they never disagree about why
  // they're empty. Each distinguishes "no data for this league" from "the request failed".
  const emptyReason = (metric: string): string => {
    if (scope.kind === 'no-league') return `Select a league to see ${metric}.`
    if (scope.kind === 'no-provider') {
      return `${scope.leagueName ?? 'This league'} isn’t provider-linked, so it has no ${metric}.`
    }
    if (loading) return 'Loading…'
    if (unavailable === 'not-supported') return `This league has no ${metric} yet — it needs synced weekly results.`
    if (unavailable === 'failed') return `Couldn’t load ${metric}. Try again shortly.`
    return `No ${metric} for this league yet.`
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <h2 className="af-section-title">Performance Overview</h2>
        <a href="/rankings" style={{ fontSize: 12, color: 'var(--af-cyan)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          View All Analytics →
        </a>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: columns, marginBottom: 22 }}>
        {/* ── 1. Weekly scoring trend ─────────────────────────────────────── */}
        <LockableCard locked={locked} lockLabel="Pro Feature" onUnlock={onUnlock}>
          <div className="af-card-label" style={{ marginBottom: 8 }}>Weekly Scoring Trend</div>
          {analytics?.scoring ? (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                <Legend color="var(--af-violet)" label="You" />
                <Legend color="rgba(255,255,255,.3)" label="League Avg" dashed />
              </div>
              <LineAreaChart
                series={analytics.scoring.mine}
                comparison={analytics.scoring.leagueAvg}
                labels={analytics.scoring.weekLabels}
              />
            </>
          ) : (
            <NoMetric reason={emptyReason('scoring history')} />
          )}
        </LockableCard>

        {/* ── 2. Position strength vs league average ──────────────────────── */}
        <LockableCard locked={locked} lockLabel="Pro Feature" onUnlock={onUnlock}>
          <div className="af-card-label" style={{ marginBottom: 10 }}>
            Position Strength{' '}
            <span style={{ color: 'var(--af-text-faint)', textTransform: 'none', fontWeight: 500 }}>
              vs League Avg
            </span>
          </div>
          {analytics?.positionStrength ? (
            <HorizontalBarChart
              // 100 = league average, so the bar scale is centred on parity rather than on
              // whichever team happens to be strongest.
              max={200}
              rows={analytics.positionStrength.map((p) => ({
                key: p.key,
                value: p.indexed,
                color: positionTone(p.indexed),
              }))}
            />
          ) : (
            <NoMetric reason={emptyReason('position values')} />
          )}
        </LockableCard>

        {/* ── 3. Roster strength radar ────────────────────────────────────── */}
        <LockableCard locked={locked} lockLabel="Pro Feature" onUnlock={onUnlock}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="af-card-label" style={{ alignSelf: 'flex-start', marginBottom: 4 }}>
            Roster Strength{' '}
            <span style={{ color: 'var(--af-text-faint)', textTransform: 'none', fontWeight: 500 }}>Radar</span>
          </div>
          {analytics?.positionStrength && analytics.positionStrength.length >= 3 ? (
            <RadarChart
              categories={analytics.positionStrength.map((p) => p.key)}
              values={analytics.positionStrength.map((p) => p.indexed)}
              // Flat 100 baseline = the league average, the same benchmark the bars use.
              comparison={analytics.positionStrength.map(() => 100)}
              max={200}
            />
          ) : (
            <NoMetric reason={emptyReason('roster values')} />
          )}
        </LockableCard>

        {/* ── 4. Waiver efficiency — no source exists ─────────────────────── */}
        <LockableCard locked={locked} lockLabel="Pro Feature" onUnlock={onUnlock}>
          <div className="af-card-label" style={{ marginBottom: 8 }}>
            Waiver Efficiency{' '}
            <span style={{ color: 'var(--af-text-faint)', textTransform: 'none', fontWeight: 500 }}>
              Last 4 Weeks
            </span>
          </div>
          <NoMetric
            reason="FAAB efficiency isn’t tracked yet — nothing in AllFantasy measures points returned per waiver dollar."
            action={{ label: 'See waiver tools', href: '/waiver-wire' }}
          />
        </LockableCard>
      </div>
    </>
  )
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--af-text-dim)' }}>
      <span style={{
        width: 8, height: 2, background: dashed ? 'none' : color, display: 'inline-block',
        borderTop: dashed ? `2px dashed ${color}` : undefined,
      }} />
      {label}
    </div>
  )
}
