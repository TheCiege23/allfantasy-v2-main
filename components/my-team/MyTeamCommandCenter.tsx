'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowUpRight,
  CircleSlash,
  ClipboardList,
  ExternalLink,
  Info,
  LayoutGrid,
  Lock,
  ShieldCheck,
  Stethoscope,
  Swords,
  Trophy,
  Users,
} from 'lucide-react'
import type {
  GamePlanItem,
  LineupSlot,
  LineupView,
  MatchupView,
  MissionIndicator,
  MyTeamContext,
  RosterNeed,
  RosterStrengthView,
  SectionState,
  SourceAttribution,
} from '@/lib/my-team/types'
import './my-team.css'

export type MyTeamLeagueOption = {
  id: string
  name: string
  platform: string
  sport: string
  season: number | null
  logoUrl: string | null
  isCommissioner: boolean
}

export type MyTeamUnavailable = {
  title: string
  message: string
  actions: Array<{ label: string; href: string }>
}

export type MyTeamCommandCenterProps = {
  leagueOptions: MyTeamLeagueOption[]
  context: MyTeamContext | null
  unavailable: MyTeamUnavailable | null
  viewerName: string | null
  viewerImage: string | null
}

// ── Small shared pieces ──────────────────────────────────────────────────────

/**
 * The freshness badge is net-new for the Nocturne family — the dashboard has no
 * freshness UI at all. Every figure on this page is sourced, so it needs one.
 */
function FreshnessBadge({ attribution }: { attribution: SourceAttribution }) {
  const { freshness, fetchedAt, source } = attribution
  const label =
    freshness === 'fresh' ? 'Live' : freshness === 'stale' ? 'Stale' : 'Freshness unknown'
  const cls =
    freshness === 'fresh' ? 'mt-fresh' : freshness === 'stale' ? 'mt-fresh mt-fresh-stale' : 'mt-fresh mt-fresh-unknown'
  const when = (() => {
    const t = Date.parse(fetchedAt)
    if (!Number.isFinite(t)) return null
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  })()

  return (
    <span className={cls} title={`Source: ${source}`}>
      <span className="mt-fresh-dot" aria-hidden="true" />
      {label}
      {when ? ` · ${when}` : ''}
    </span>
  )
}

const UNAVAILABLE_KIND_LABEL: Record<string, string> = {
  provider_unavailable: 'Data unavailable',
  stale: 'Data is stale',
  insufficient_data: 'Not enough data',
  not_exposed_by_platform: 'Not exposed by this platform',
  unsupported_for_format: 'Not applicable to this league',
  engine_not_enabled: 'Not enabled',
  resync_required: 'Resync required',
  requires_upgrade: 'Upgrade required',
}

function UnavailableBlock({ state }: { state: Extract<SectionState<unknown>, { status: 'unavailable' }> }) {
  return (
    <div className="mt-unavailable">
      <CircleSlash size={16} className="mt-unavailable-icon" aria-hidden="true" />
      <div className="mt-unavailable-body">
        <div className="mt-unavailable-kind">{UNAVAILABLE_KIND_LABEL[state.kind] ?? 'Unavailable'}</div>
        <p className="mt-unavailable-reason">{state.reason}</p>
        {state.resolveHref ? (
          <div className="mt-unavailable-actions">
            <a
              className="mt-btn mt-btn-sm"
              href={state.resolveHref}
              target={state.resolveHref.startsWith('http') ? '_blank' : undefined}
              rel={state.resolveHref.startsWith('http') ? 'noreferrer' : undefined}
            >
              {state.resolveLabel ?? 'Resolve'}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Section wrapper. Takes a `SectionState<T>` and a renderer for the ok branch, so
 * a section physically cannot be rendered without handling the unavailable case —
 * the honesty rule is enforced by the component signature, not by review.
 */
function Section<T>({
  id,
  title,
  kicker,
  state,
  action,
  children,
}: {
  id: string
  title: string
  kicker?: string
  state: SectionState<T>
  action?: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  return (
    <section className="mt-card" id={id} aria-labelledby={`${id}-title`}>
      <header className="mt-card-head">
        <div>
          {kicker ? <div className="mt-kicker">{kicker}</div> : null}
          <h2 className="mt-card-title" id={`${id}-title`}>
            {title}
          </h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.status === 'ok' ? <FreshnessBadge attribution={state.attribution} /> : null}
          {action}
        </div>
      </header>
      {state.status === 'ok' ? children(state.data) : <UnavailableBlock state={state} />}
    </section>
  )
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const diffMs = t - Date.now()
  if (diffMs <= 0) return 'Locked'
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `Locks in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Locks in ${hours}h ${mins % 60}m`
  return `Locks in ${Math.floor(hours / 24)}d`
}

function num(value: number | null, digits = 1): string {
  return value == null ? '—' : value.toFixed(digits)
}

// ── Mission control ──────────────────────────────────────────────────────────

function MissionControl({ indicators }: { indicators: MissionIndicator[] }) {
  const scrollTo = useCallback((targetId: string) => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="mt-mission" role="list" aria-label="Team mission control">
      {indicators.map((ind) => (
        <button
          key={ind.id}
          type="button"
          role="listitem"
          className={`mt-mission-tile tone-${ind.tone}`}
          onClick={() => scrollTo(ind.targetId)}
        >
          <div className="mt-mission-label">{ind.label}</div>
          <div className={`mt-mission-value${ind.value == null ? ' is-empty' : ''}`}>{ind.value ?? '—'}</div>
          {ind.unavailableReason ? (
            <div className="mt-mission-sub is-unavailable">{ind.unavailableReason}</div>
          ) : ind.sublabel ? (
            <div className="mt-mission-sub">{ind.sublabel}</div>
          ) : null}
        </button>
      ))}
    </div>
  )
}

// ── Game plan ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<GamePlanItem['priority'], string> = {
  critical: 'mt-badge mt-badge-critical',
  high: 'mt-badge mt-badge-warning',
  medium: 'mt-badge mt-badge-accent',
  low: 'mt-badge mt-badge-neutral',
}

function GamePlan({ items }: { items: GamePlanItem[] }) {
  if (items.length === 0) {
    return (
      <p className="mt-empty-note">
        The lineup scan completed for this league and flagged nothing to act on. This covers your lineup only — if the
        scan had failed, this section would say so rather than show an all-clear.
      </p>
    )
  }

  return (
    <div className="mt-plan-list">
      {items.map((item) => {
        const deadline = formatDeadline(item.deadlineIso)
        return (
          <article key={item.id} className={`mt-plan-item p-${item.priority}`}>
            <div className="mt-plan-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={PRIORITY_BADGE[item.priority]}>{item.priority}</span>
                <h3 className="mt-plan-title">{item.title}</h3>
              </div>
              <p className="mt-plan-reason">{item.reason}</p>
              <div className="mt-plan-meta">
                {item.playerName ? <span>{item.playerName}</span> : null}
                {item.slotLabel ? <span>Slot: {item.slotLabel}</span> : null}
                {deadline ? <span>{deadline}</span> : null}
                {item.confidence != null ? <span>Confidence: {Math.round(item.confidence * 100)}%</span> : null}
                {item.expectedGain != null ? <span>Est. +{item.expectedGain.toFixed(1)} pts</span> : null}
                <span>via {item.sourceModule}</span>
              </div>
            </div>
            {item.actionHref ? (
              <div className="mt-plan-actions">
                <a
                  className="mt-btn mt-btn-sm mt-btn-primary"
                  href={item.actionHref}
                  target={item.externalOnly ? '_blank' : undefined}
                  rel={item.externalOnly ? 'noreferrer' : undefined}
                >
                  {item.actionLabel}
                  {item.externalOnly ? <ExternalLink size={12} aria-hidden="true" /> : null}
                </a>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

// ── Lineup ───────────────────────────────────────────────────────────────────

function statusPill(slot: LineupSlot) {
  switch (slot.status) {
    case 'out':
      return <span className="mt-status-pill mt-status-out">OUT</span>
    case 'injured':
      return <span className="mt-status-pill mt-status-out">DOUBT</span>
    case 'questionable':
      return <span className="mt-status-pill mt-status-questionable">QUES</span>
    case 'bye':
      return <span className="mt-status-pill mt-status-questionable">BYE</span>
    case 'locked':
      return <span className="mt-status-pill mt-status-locked">LOCKED</span>
    case 'empty':
      return <span className="mt-status-pill mt-status-out">EMPTY</span>
    default:
      return <span className="mt-status-pill mt-status-ok">—</span>
  }
}

function LineupTable({ lineup }: { lineup: LineupView }) {
  // Column headers above nothing read as a broken table. Say why it's empty instead.
  if (lineup.starters.length === 0) {
    return (
      <div className="mt-unavailable">
        <CircleSlash size={16} className="mt-unavailable-icon" aria-hidden="true" />
        <div className="mt-unavailable-body">
          <div className="mt-unavailable-kind">No starting slots</div>
          <p className="mt-unavailable-reason">
            No starting lineup slots could be read for your roster this week. This usually means the roster has not been
            populated for the current scoring period yet.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mt-lineup">
        <div className="mt-lineup-head" aria-hidden="true">
          <span>Slot</span>
          <span>Player</span>
          <span className="mt-col-optional">Game</span>
          <span style={{ textAlign: 'right' }}>Proj</span>
          <span style={{ textAlign: 'right' }} className="mt-col-optional">
            Pts
          </span>
          <span style={{ textAlign: 'center' }}>Status</span>
        </div>

        <table className="mt-sr-only">
          <caption>Starting lineup</caption>
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Player</th>
              <th scope="col">Game</th>
              <th scope="col">Projected points</th>
              <th scope="col">Current points</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {lineup.starters.map((slot) => (
              <tr key={`sr-${slot.slotId}`}>
                <td>{slot.slotLabel}</td>
                <td>{slot.player?.name ?? 'Empty slot'}</td>
                <td>{slot.player?.gameLabel ?? '—'}</td>
                <td>{num(slot.player?.projectedPoints ?? null)}</td>
                <td>{num(slot.player?.currentPoints ?? null)}</td>
                <td>{slot.status}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {lineup.starters.map((slot) => (
          <div key={slot.slotId} className={`mt-lineup-row${slot.player ? '' : ' is-empty'}`}>
            <span className="mt-slot">{slot.slotLabel}</span>

            {slot.player ? (
              <span className="mt-player">
                <span style={{ minWidth: 0 }}>
                  <span className="mt-player-name">{slot.player.name}</span>
                  <span className="mt-player-sub">
                    {[slot.player.position, slot.player.team].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
            ) : (
              <span className="mt-empty-slot">No player started</span>
            )}

            <span className="mt-player-sub mt-col-optional">{slot.player?.gameLabel ?? '—'}</span>
            <span className="mt-num">{num(slot.player?.projectedPoints ?? null)}</span>
            <span className={`mt-num mt-col-optional${slot.player?.currentPoints == null ? ' mt-num-muted' : ''}`}>
              {num(slot.player?.currentPoints ?? null)}
            </span>
            <span style={{ textAlign: 'center' }}>{statusPill(slot)}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          paddingTop: 12,
          marginTop: 4,
          borderTop: '1px solid var(--color-neutral-800)',
          fontSize: 13,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--color-neutral-500)' }}>
          Projected total{' '}
          <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            {num(lineup.projectedTotal)}
          </strong>
        </span>
        {lineup.partial ? (
          <span className="mt-badge mt-badge-warning">
            <AlertTriangle size={11} aria-hidden="true" />
            Some projections missing
          </span>
        ) : null}
      </div>

      {lineup.bench.length === 0 ? (
        <p className="mt-empty-note" style={{ marginTop: 12 }}>
          Bench, IR, and taxi depth are not exposed by the matchup source this page reads. Your full roster — including
          bench moves — is in the league&rsquo;s My Team tab.
        </p>
      ) : null}
    </>
  )
}

// ── Matchup ──────────────────────────────────────────────────────────────────

function MatchupPanel({ view }: { view: MatchupView }) {
  const { payload, viewerWinProbabilityPct } = view
  const me = payload.left
  const them = payload.right

  // `right.rosterId === 'bye'` is the sentinel matchupCenterService uses for a
  // week with no opponent (see the game-day service README).
  const isBye = view.state === 'bye' || them.rosterId === 'bye'

  // The insights block is deterministic generated copy. Against a bye, or with no
  // projections on either side, lines like "projections are tight" describe nothing
  // real — so it is suppressed rather than shown as analysis.
  const hasProjections = me.projectedTotal > 0 || them.projectedTotal > 0
  const showInsight = !isBye && hasProjections && Boolean(payload.insights.matchupEdge)

  if (isBye) {
    return (
      <div className="mt-unavailable">
        <CircleSlash size={16} className="mt-unavailable-icon" aria-hidden="true" />
        <div className="mt-unavailable-body">
          <div className="mt-unavailable-kind">Bye week</div>
          <p className="mt-unavailable-reason">
            {me.teamName} has no opponent scheduled this week, so there is no matchup to project.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mt-matchup">
        <div className="mt-matchup-side">
          <div className="mt-matchup-team">{me.teamName}</div>
          <div className="mt-matchup-score">{me.totalPoints.toFixed(1)}</div>
          <div className="mt-matchup-proj">Proj {me.projectedTotal.toFixed(1)}</div>
        </div>

        <div className="mt-matchup-center">
          {viewerWinProbabilityPct == null ? (
            <>
              <div style={{ fontSize: 20, color: 'var(--color-neutral-700)' }}>—</div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', maxWidth: 130 }}>
                Win probability needs both projections
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {Math.round(viewerWinProbabilityPct)}%
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-500)' }}>win probability</div>
            </>
          )}
        </div>

        <div className="mt-matchup-side is-right">
          <div className="mt-matchup-team">{them.teamName}</div>
          <div className="mt-matchup-score">{them.totalPoints.toFixed(1)}</div>
          <div className="mt-matchup-proj">Proj {them.projectedTotal.toFixed(1)}</div>
        </div>
      </div>

      {/*
        Method disclosure is not optional here. This figure is a projected-points
        ratio, not a simulation — labeling it as one would overstate it.
      */}
      {viewerWinProbabilityPct != null ? (
        <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 12 }}>
          Derived from the ratio of projected totals, not a Monte Carlo simulation. Treat it as a directional read.
        </p>
      ) : null}

      {showInsight ? (
        <p style={{ fontSize: 13, color: 'var(--color-neutral-300)', marginTop: 12 }}>{payload.insights.matchupEdge}</p>
      ) : null}

      {payload.partialData ? (
        <div className="mt-badge mt-badge-warning" style={{ marginTop: 12 }}>
          <AlertTriangle size={11} aria-hidden="true" />
          Some inputs were unavailable — figures may shift
        </div>
      ) : null}
    </>
  )
}

// ── Rail widgets ─────────────────────────────────────────────────────────────

function RosterStrengthPanel({ view }: { view: RosterStrengthView }) {
  const max = Math.max(...view.positions.map((p) => p.value), 1)
  return (
    <>
      {view.positions.map((p) => (
        <div className="mt-strength-row" key={p.position}>
          <span className="mt-kicker" style={{ letterSpacing: '0.04em' }}>
            {p.position}
          </span>
          <span className="mt-strength-track">
            <span className="mt-strength-fill" style={{ width: `${Math.round((p.value / max) * 100)}%` }} />
          </span>
          <span className="mt-strength-val">{p.value.toFixed(1)}</span>
        </div>
      ))}
      <p style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 10 }}>
        Projected starter points by slot. {view.gradeBasis}
      </p>
    </>
  )
}

function RosterNeedsPanel({ needs }: { needs: RosterNeed[] }) {
  if (needs.length === 0) {
    return <p className="mt-empty-note">No structural gaps surfaced from this week&rsquo;s lineup scan.</p>
  }
  return (
    <>
      {needs.map((need) => (
        <div className="mt-need" key={need.position}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={need.severity === 'critical' ? 'mt-badge mt-badge-critical' : 'mt-badge mt-badge-warning'}>
              {need.position}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{need.severity}</span>
          </div>
          <p className="mt-need-summary">{need.summary}</p>
        </div>
      ))}
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'game-plan', label: "Today's game plan", icon: ClipboardList },
  { id: 'lineup', label: 'Lineup', icon: LayoutGrid },
  { id: 'matchup', label: 'Matchup', icon: Swords },
  { id: 'strength', label: 'Roster strength', icon: ShieldCheck },
  { id: 'needs', label: 'Where you need help', icon: Stethoscope },
  { id: 'outlook', label: 'Season outlook', icon: Trophy },
] as const

export default function MyTeamCommandCenter({
  leagueOptions,
  context,
  unavailable,
  viewerName,
}: MyTeamCommandCenterProps) {
  const router = useRouter()
  const [activeNav, setActiveNav] = useState<string>('game-plan')

  const onLeagueChange = useCallback(
    (leagueId: string) => {
      router.push(`/my-team?league=${encodeURIComponent(leagueId)}`)
    },
    [router],
  )

  const goTo = useCallback((id: string) => {
    setActiveNav(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const planCount = useMemo(() => {
    if (!context || context.gamePlan.status !== 'ok') return null
    return context.gamePlan.data.filter((i) => i.priority === 'critical' || i.priority === 'high').length
  }, [context])

  if (unavailable) {
    return (
      <div className="nocturne-team">
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '72px 20px' }}>
          <div className="mt-card">
            <div className="mt-kicker">My Team</div>
            <h1 style={{ fontSize: 24, marginTop: 6 }}>{unavailable.title}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-neutral-400)', marginTop: 10 }}>{unavailable.message}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              {unavailable.actions.map((a) => (
                <a key={a.href} className="mt-btn mt-btn-primary" href={a.href}>
                  {a.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!context) return null

  const { identity, write, league } = context
  const record = identity.record

  return (
    <div className="nocturne-team">
      <div className="mt-shell">
        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <aside className="mt-sidebar" aria-label="Team navigation">
          <div className="mt-card" style={{ padding: 14 }}>
            <div className="mt-kicker" style={{ marginBottom: 8 }}>
              Selected league
            </div>
            <label className="mt-sr-only" htmlFor="mt-league-select">
              Select league
            </label>
            <select
              id="mt-league-select"
              className="mt-select"
              value={league.id}
              onChange={(e) => onLeagueChange(e.target.value)}
            >
              {leagueOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className="mt-badge mt-badge-neutral">{context.sport}</span>
              {write.platformLabel ? <span className="mt-badge mt-badge-neutral">{write.platformLabel}</span> : null}
              {!write.canEditLineup ? <span className="mt-badge mt-badge-outline">Read only</span> : null}
              {context.viewerIsCommissioner ? <span className="mt-badge mt-badge-accent">Commissioner</span> : null}
            </div>
          </div>

          <nav className="mt-card mt-nav" style={{ padding: 10 }} aria-label="Sections">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mt-nav-item${activeNav === item.id ? ' is-active' : ''}`}
                  onClick={() => goTo(item.id)}
                  aria-current={activeNav === item.id ? 'true' : undefined}
                >
                  <Icon size={15} aria-hidden="true" />
                  {item.label}
                  {item.id === 'game-plan' && planCount ? <span className="mt-nav-count">{planCount}</span> : null}
                </button>
              )
            })}
          </nav>

          <div className="mt-card" style={{ padding: 14 }}>
            <div className="mt-kicker" style={{ marginBottom: 8 }}>
              Full roster
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 10 }}>
              Bench, IR, taxi, and roster moves live in the league view.
            </p>
            <a className="mt-btn mt-btn-sm mt-btn-block" href={`/league/${league.id}?tab=roster`}>
              Open full roster
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </div>
        </aside>

        {/* ── Main ──────────────────────────────────────────────────────── */}
        <main className="mt-main">
          <header className="mt-hero">
            <div className="mt-hero-id">
              <div className="mt-crest" aria-hidden="true">
                {identity.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={identity.avatarUrl} alt="" />
                ) : (
                  identity.teamName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="mt-kicker">My Team</div>
                <h1 className="mt-team-name">{identity.teamName}</h1>
                <div className="mt-hero-meta">
                  <span>{league.name}</span>
                  <span className="mt-dot">·</span>
                  {record ? (
                    <>
                      <span>
                        {record.ties
                          ? `${record.wins}–${record.losses}–${record.ties}`
                          : `${record.wins}–${record.losses}`}
                      </span>
                      <span className="mt-dot">·</span>
                    </>
                  ) : null}
                  <span>
                    {context.week > 0 ? `Week ${context.week}` : 'Week unresolved'}
                    {context.isPlayoffWeek ? ' · Playoffs' : ''}
                  </span>
                  {viewerName ? (
                    <>
                      <span className="mt-dot">·</span>
                      <span>{viewerName}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-hero-actions">
              {write.platformHref ? (
                <a className="mt-btn mt-btn-primary" href={write.platformHref} target="_blank" rel="noreferrer">
                  Open in {write.platformLabel}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              ) : null}
              <a className="mt-btn" href={`/league/${league.id}`}>
                League home
              </a>
            </div>
          </header>

          {write.readOnlyReason ? (
            <div className="mt-readonly">
              <Lock size={14} aria-hidden="true" />
              <span>{write.readOnlyReason}</span>
            </div>
          ) : null}

          <MissionControl indicators={context.missionControl} />

          <Section
            id="game-plan"
            kicker="Priority queue"
            title="Today's game plan"
            state={context.gamePlan}
            action={
              context.gamePlan.status === 'ok' && context.gamePlan.data.length > 0 ? (
                <span className="mt-badge mt-badge-neutral">
                  {context.gamePlan.data.length} {context.gamePlan.data.length === 1 ? 'item' : 'items'}
                </span>
              ) : null
            }
          >
            {(items) => <GamePlan items={items} />}
          </Section>

          <Section id="lineup" kicker="Starting lineup" title="Lineup command center" state={context.lineup}>
            {(lineup) => <LineupTable lineup={lineup} />}
          </Section>

          <Section id="matchup" kicker={`Week ${context.week}`} title="Matchup" state={context.matchup}>
            {(view) => <MatchupPanel view={view} />}
          </Section>

          <Section
            id="outlook"
            kicker="Season"
            title="Playoff & season outlook"
            state={context.playoffOutlook}
          >
            {() => null}
          </Section>
        </main>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside className="mt-rail" aria-label="Team analysis">
          <Section id="strength" kicker="Analysis" title="Roster strength" state={context.rosterStrength}>
            {(view) => <RosterStrengthPanel view={view} />}
          </Section>

          <Section id="needs" kicker="Analysis" title="Where you need help" state={context.rosterNeeds}>
            {(needs) => <RosterNeedsPanel needs={needs} />}
          </Section>

          <Section id="waivers" kicker="Opportunities" title="Waiver targets" state={context.waivers}>
            {() => null}
          </Section>

          <Section id="trades" kicker="Opportunities" title="Trade opportunities" state={context.trades}>
            {() => null}
          </Section>

          {context.degraded ? (
            <div className="mt-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 9 }}>
                <Info size={15} style={{ color: 'var(--color-neutral-500)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <p style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                  Some sections could not be sourced this cycle. Each one states why above rather than showing an
                  estimate.
                </p>
              </div>
            </div>
          ) : null}

          {context.viewerIsCommissioner ? (
            <div className="mt-card" style={{ padding: 14 }}>
              <div className="mt-kicker" style={{ marginBottom: 8 }}>
                <Users size={11} style={{ display: 'inline', marginRight: 4 }} aria-hidden="true" />
                Commissioner
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-500)', marginBottom: 10 }}>
                You commission this league. Oversight tools are separate from your own team so this page stays a
                manager surface.
              </p>
              <a className="mt-btn mt-btn-sm mt-btn-block" href={`/league/${league.id}/commissioner`}>
                Commissioner tools
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
