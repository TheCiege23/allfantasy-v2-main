'use client'

/**
 * Token Tools strip, row 3 (Import Center · Legacy & Achievements · League Health), and the
 * commissioner token strip.
 *
 * Every number here is real:
 *  - token costs come from `lib/tokens/pricing-matrix.ts`, the same table `TokenSpendService`
 *    charges against. The design's placeholder costs (10/15/20/25) are NOT used — showing an
 *    invented price next to a spend button is the one fabrication that would cost users money.
 *  - import provider status comes from `lib/league-import/provider-ui-config.ts`, whose
 *    `available` flag is a product-readiness signal backed by its own reconciliation test.
 *    Three providers are deliberately `false` there; they render as unavailable, not connected.
 *  - XP/level come from the real rank payload; league health from the commissioner engine.
 */

import Link from 'next/link'
import { Coins } from 'lucide-react'
import { TOKEN_SPEND_RULE_MATRIX } from '@/lib/tokens/pricing-matrix'
import { IMPORT_PROVIDER_UI_OPTIONS } from '@/lib/league-import/provider-ui-config'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import { LinearProgressChart, MultiRingChart } from '../charts'
import type { DeviceKind } from '../hooks/useDeviceKind'
import { LockableCard, NoMetric, type UnlockRequest } from '../ui/Gating'

export type RankSummary = {
  level: number | null
  levelName: string | null
  progressPct: number | null
  nextLevelName: string | null
  wins: number | null
  losses: number | null
  titles: number | null
  seasons: number | null
}

/**
 * The token tools worth surfacing on a fantasy dashboard.
 *
 * Two filters, both necessary:
 *  - the matrix also prices AllFantasy's other products (World Cup pools, Survivor, Big
 *    Brother), identifiable by code prefix. A fantasy-football dashboard offering "Survivor
 *    idol timing breakdown" would be nonsense, so those are excluded by prefix rather than
 *    by tier — tier alone surfaces mostly Survivor entries.
 *  - `low` tier is the per-explanation micro-spend (a single start/sit line); the design's
 *    strip is deep reports, so mid + high only.
 */
const OTHER_PRODUCT_PREFIXES = ['world_cup_', 'survivor_', 'big_brother_']

function tokenTools(category: 'ai_feature' | 'commissioner_function') {
  return TOKEN_SPEND_RULE_MATRIX
    .filter((e) => e.category === category)
    .filter((e) => e.tier === 'mid' || e.tier === 'high')
    .filter((e) => !OTHER_PRODUCT_PREFIXES.some((p) => e.code.startsWith(p)))
    .slice()
    .sort((a, b) => a.tokenCost - b.tokenCost)
    .slice(0, 8)
}

export function TokenToolsStrip({
  tokenBalance, onSpend, category, title,
}: {
  /** null when the balance hasn't loaded yet or the fetch failed — never a fabricated 0. */
  tokenBalance: number | null
  onSpend: (req: UnlockRequest) => void
  category: 'ai_feature' | 'commissioner_function'
  title: string
}) {
  const tools = tokenTools(category)
  if (tools.length === 0) return null

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <h2 className="af-section-title">{title}</h2>
        <span style={{
          fontSize: 10, color: 'var(--af-gold)', background: 'rgba(245,158,11,.12)',
          border: '1px solid rgba(245,158,11,.3)', padding: '2px 7px', borderRadius: 6, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <Coins size={11} strokeWidth={2.5} />
          {tokenBalance == null ? 'Balance unavailable' : `${tokenBalance} available`}
        </span>
      </div>
      <div className="af-hscroll">
        {tools.map((t) => {
          const affordable = tokenBalance != null && tokenBalance >= t.tokenCost
          return (
            <button
              key={t.code}
              type="button"
              className={`af-token-tool${category === 'commissioner_function' ? ' is-commish' : ''}`}
              onClick={() => onSpend({
                title: t.featureLabel,
                body: t.description,
                tier: 'Tokens',
                primaryLabel: affordable ? `Use ${t.tokenCost} Tokens` : `Buy tokens — need ${t.tokenCost}`,
                // Spending happens server-side through TokenSpendService on the feature's own
                // surface. The modal routes there (or to top-up) rather than "spending" here.
                primaryHref: affordable ? '/tokens' : '/pricing',
                comparePlansHref: '/pricing',
              })}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 6, lineHeight: 1.35 }}>
                {t.featureLabel}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
                color: affordable ? 'var(--af-gold)' : 'var(--af-text-faint)',
              }}>
                <Coins size={11} strokeWidth={2.5} />
                {t.tokenCost} Token{t.tokenCost === 1 ? '' : 's'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BottomRow({
  device, rank, connectedPlatforms, health, isCommissioner, commissionerLocked, onUnlockCommissioner,
}: {
  device: DeviceKind
  rank: RankSummary
  /** Platform slugs the user actually has leagues from. */
  connectedPlatforms: Set<string>
  health: CommissionerLeagueHealthSnapshot | null
  isCommissioner: boolean
  commissionerLocked: boolean
  onUnlockCommissioner: () => void
}) {
  const cols = device === 'desktop' ? (isCommissioner ? 'repeat(3,1fr)' : 'repeat(2,1fr)') : '1fr'

  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: cols, marginBottom: 22 }}>
      {/* ── Import Center ────────────────────────────────────────────────── */}
      <div className="af-card">
        <Head label="Import Center" action={{ label: 'Import', href: '/import' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {IMPORT_PROVIDER_UI_OPTIONS.map((p) => {
            const connected = connectedPlatforms.has(p.provider)
            return (
              <div key={p.provider} style={{
                background: 'var(--af-surface-2)', borderRadius: 9, padding: 9, textAlign: 'center',
                opacity: p.available ? 1 : 0.5,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>
                  {p.provider === 'mfl' ? 'MFL' : p.label}
                </div>
                <div style={{
                  fontSize: 9.5, marginTop: 3,
                  color: connected ? 'var(--af-emerald)' : p.available ? 'var(--af-text-faint)' : 'var(--af-text-faint)',
                }}>
                  {connected ? '✓ Connected' : p.available ? 'Not connected' : 'Unavailable'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Legacy & Achievements ────────────────────────────────────────── */}
      <div className="af-card">
        <Head label="Legacy & Achievements" action={{ label: 'View All', href: '/af-legacy' }} />
        {rank.level != null || rank.levelName ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: 'var(--af-surface-2)',
                border: '2px solid var(--af-violet)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontFamily: 'var(--af-font-display)', fontSize: 20,
                color: '#fff', flexShrink: 0,
              }}>
                {rank.level ?? '–'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                  {rank.level != null ? `Level ${rank.level}` : 'Unranked'}
                  {rank.levelName ? ` — ${rank.levelName}` : ''}
                </div>
                {rank.progressPct != null && rank.nextLevelName && (
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>
                    {rank.progressPct}% to {rank.nextLevelName}
                  </div>
                )}
              </div>
            </div>
            {rank.progressPct != null && (
              <div style={{ marginBottom: 12 }}>
                <LinearProgressChart value={rank.progressPct} />
              </div>
            )}
            <div className="af-kicker" style={{ marginBottom: 7 }}>Career</div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <CareerStat label="Record" value={
                rank.wins != null && rank.losses != null ? `${rank.wins}-${rank.losses}` : null
              } />
              <CareerStat label="Titles" value={rank.titles != null ? String(rank.titles) : null} />
              <CareerStat label="Seasons" value={rank.seasons != null ? String(rank.seasons) : null} />
            </div>
          </>
        ) : (
          <NoMetric
            reason="Your AllFantasy rank appears once league history is imported."
            action={{ label: 'Import history', href: '/legacy-import' }}
          />
        )}
      </div>

      {/* ── League Health (commissioners only) ───────────────────────────── */}
      {isCommissioner && (
        <LockableCard locked={commissionerLocked} lockLabel="Commissioner Pro" onUnlock={onUnlockCommissioner}>
          <Head label="League Health (Commissioner)" action={{ label: 'Full Report →', href: '/commissioner-hub' }} />
          {health ? <HealthBody health={health} /> : (
            <NoMetric reason="No commissioner health snapshot for this league yet." />
          )}
        </LockableCard>
      )}
    </div>
  )
}

function HealthBody({ health }: { health: CommissionerLeagueHealthSnapshot }) {
  /*
   * `source: 'dashboard-fallback'` snapshots are built from a league-list row with `rosters: []`,
   * so every activity metric reads 0 for reasons that have nothing to do with league health.
   * Scores stay (they're computed either way); the activity line is suppressed rather than
   * reported as a real "no trades, no waivers".
   */
  const activityIsReal = health.source !== 'dashboard-fallback'

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
        <MultiRingChart
          centerValue={String(Math.round(health.healthScore))}
          rings={[
            { label: 'Engagement', value: health.engagementScore, color: 'var(--af-violet)' },
            { label: 'Fairness', value: health.fairnessScore, color: 'var(--af-cyan)' },
            { label: 'Sustainability', value: health.sustainabilityScore, color: 'var(--af-emerald)' },
          ]}
        />
        <div style={{ fontSize: 11, lineHeight: 2, minWidth: 0 }}>
          <HealthLine color="var(--af-violet)" label="Engagement" value={Math.round(health.engagementScore)} />
          <HealthLine color="var(--af-cyan)" label="Fairness" value={Math.round(health.fairnessScore)} />
          <HealthLine color="var(--af-emerald)" label="Sustainability" value={Math.round(health.sustainabilityScore)} />
        </div>
      </div>
      {activityIsReal ? (
        <div style={{ fontSize: 11, color: 'var(--af-text-dim)' }}>
          Trades <b style={{ color: '#fff' }}>{health.metrics.tradeActivity}</b>
          {' · '}Waivers <b style={{ color: '#fff' }}>{health.metrics.waiverActivity}</b>
          {' · '}Active managers <b style={{ color: '#fff' }}>{health.metrics.activeManagers}/{health.teamCount}</b>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: 'var(--af-text-faint)', lineHeight: 1.5 }}>
          Activity counts need a full league sync — scores shown are from the summary snapshot.
        </div>
      )}
      {health.summary && (
        <div style={{ fontSize: 11, color: 'var(--af-text-dim)', marginTop: 8, lineHeight: 1.5 }}>
          {health.summary}
        </div>
      )}
    </>
  )
}

function HealthLine({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div style={{ color: 'var(--af-text-muted)' }}>
      <span style={{ color }}>●</span> {label} <b style={{ color: '#fff' }}>{value}</b>
    </div>
  )
}

function CareerStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="af-stat" style={{ fontSize: 18 }}>{value ?? '–'}</div>
      <div style={{ fontSize: 9.5, color: 'var(--af-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
    </div>
  )
}

function Head({ label, action }: { label: string; action?: { label: string; href: string } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
      <div className="af-card-label">{label}</div>
      {action && (
        <Link href={action.href} style={{ fontSize: 11, color: 'var(--af-cyan)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {action.label}
        </Link>
      )}
    </div>
  )
}

/** Footer legend strip — explains what blur means, per the design. */
export function LegendStrip() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '12px 4px', borderTop: '1px solid rgba(139,92,246,.15)', marginTop: 6,
    }}>
      <LegendDot color="var(--af-emerald)" label="Free Feature" />
      <LegendDot color="var(--af-violet)" label="Pro Feature" />
      <LegendDot color="var(--af-gold)" label="Token Feature" />
      <LegendDot color="var(--af-blue)" label="Commissioner Feature" />
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--af-text-faint)' }}>
        🔒 Blurred = Upgrade Required
      </span>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: 'var(--af-text-faint)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}
