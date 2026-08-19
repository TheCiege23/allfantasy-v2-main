'use client'

/**
 * Decision OS Manager Intelligence Platform — Phase 1.
 *
 * A unified, display-only "Manager Intelligence Hub" that answers "what should
 * I pay attention to this week?" by composing EXISTING intelligence sources into
 * one experience — mirroring the hub pattern of CommissionerIntelligenceHub
 * (self-fetching modules, each a Card with loading/empty/error states).
 *
 * Scope discipline (Phase 1): consumes existing systems only. It changes no
 * Replay Framework / contract / API / recommendation logic. Replay is ONE
 * observational input among many — not the centrepiece — and the validation→
 * recommendation boundary stays intact (every section is descriptive/display).
 *
 * All five modules are wired to a clean, existing/deterministic, non-recommendation
 * source — the hub has no remaining placeholders:
 *   - Historical Intelligence → reuses the Phase 20/21 <ManagerReplayInsightsCard>
 *   - League Context          → reuses GET /api/app/leagues/[id]/standings
 *   - Current Team Health     → Phase 2 deterministic ManagerTeamHealthV1 contract
 *                               via GET /api/app/leagues/[id]/team-health
 *   - Weekly Outlook          → Phase 3 deterministic ManagerWeeklyOutlookV1 contract
 *                               via GET /api/app/leagues/[id]/weekly-outlook
 *   - Transaction Readiness   → Phase 4 deterministic ManagerTransactionReadinessV1
 *                               via GET /api/app/leagues/[id]/transaction-readiness
 * Every section stays descriptive/display-only; none consumes an AI/recommendation
 * endpoint (the validation→recommendation boundary is the platform's core rule).
 *
 * Gated by NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED (default off → the hub
 * shows a quiet "not available" state so nothing ships before it's ready).
 */

import { useCallback, useEffect, useState } from 'react'
import { ManagerReplayInsightsCard } from '@/components/dashboard/ManagerReplayInsightsCard'
// Type-only import from the pure types module (no runtime/server deps reach the
// client bundle). Do NOT import from the barrel — it re-exports the DB resolver.
import type { ManagerTeamHealthV1 } from '@/lib/decision-os/manager-intelligence/team-health/types'
import type { ManagerWeeklyOutlookV1 } from '@/lib/decision-os/manager-intelligence/weekly-outlook/types'
import type { ManagerTransactionReadinessV1 } from '@/lib/decision-os/manager-intelligence/transaction-readiness/types'

// ── generic fetch resource (adapted from CommissionerIntelligenceHub) ─────────
// Note: unlike the commissioner hub's endpoints (which wrap in `{ data }`), the
// standings endpoint returns its payload directly, so this variant stores the
// raw JSON body as T.

type ResourceStatus = 'loading' | 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'error'
interface Resource<T> { status: ResourceStatus; data?: T; reload: () => void }

function statusFromHttp(code: number): ResourceStatus {
  if (code === 200) return 'ok'
  if (code === 401) return 'unauthorized'
  if (code === 403) return 'forbidden'
  if (code === 404) return 'not_found'
  return 'error'
}

function useResource<T>(url: string): Resource<T> {
  const [status, setStatus] = useState<ResourceStatus>('loading')
  const [data, setData] = useState<T | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  useEffect(() => {
    let active = true
    setStatus('loading')
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const s = statusFromHttp(res.status)
        if (s === 'ok') {
          const body = (await res.json().catch(() => ({}))) as T
          if (active) {
            setData(body)
            setStatus('ok')
          }
        } else if (active) {
          setStatus(s)
        }
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [url, nonce])
  return { status, data, reload }
}

// ── shared UI ─────────────────────────────────────────────────────────────────

function HubCard({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  // min-height + items-stretch on the grid keeps cards visually aligned in the
  // demo; flex column pins the title and lets content fill.
  return (
    <section
      className="flex min-h-[148px] flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.14]"
      data-testid={testId}
    >
      <h3 className="mb-3 text-sm font-semibold text-white/90">{title}</h3>
      <div className="flex-1">{children}</div>
    </section>
  )
}

/** Consistent loading skeleton (keeps role="status" for a11y + tests). */
function LoadingSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/10" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/10" />
    </div>
  )
}

function StateMessage({ status }: { status: ResourceStatus }) {
  if (status === 'loading') return <LoadingSkeleton />
  if (status === 'forbidden' || status === 'not_found' || status === 'unauthorized') {
    return <p className="text-xs text-white/45">Not available.</p>
  }
  return <p className="text-xs text-red-300/80">Could not load. Try again.</p>
}

// ── League Context module (reuses the existing standings endpoint) ────────────

interface StandingsRow {
  rank?: number
  teamName?: string | null
  wins?: number
  losses?: number
  pointsFor?: number
  playoffSeed?: number | null
}
interface StandingsResponse {
  standings?: StandingsRow[]
  season?: number
}

function LeagueContextModule({ leagueId }: { leagueId: string }) {
  const r = useResource<StandingsResponse>(`/api/app/leagues/${encodeURIComponent(leagueId)}/standings`)
  return (
    <HubCard title="League Context" testId="hub-league-context">
      {r.status !== 'ok' ? (
        <StateMessage status={r.status} />
      ) : !r.data?.standings || r.data.standings.length === 0 ? (
        <p className="text-xs text-white/45" data-testid="league-context-empty">No standings recorded yet.</p>
      ) : (
        <ul className="space-y-1 text-xs text-white/70" data-testid="league-context-content">
          {r.data.standings.slice(0, 6).map((row, i) => (
            <li key={`${row.teamName ?? i}-${i}`} className="flex items-center justify-between gap-3">
              <span className="truncate">
                <span className="text-white/40">{row.rank ?? i + 1}.</span> {row.teamName ?? 'Team'}
              </span>
              <span className="shrink-0 text-white/45">
                {typeof row.wins === 'number' ? `${row.wins}${typeof row.losses === 'number' ? `-${row.losses}` : ''}` : ''}
                {typeof row.pointsFor === 'number' ? ` · ${row.pointsFor} PF` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </HubCard>
  )
}

// ── Current Team Health module (Phase 2 — deterministic display contract) ─────
// Consumes the internal, session-authed, display-only Team Health route. The
// route returns `{ enabled, data? }`: `enabled:false` (server flag off) → a
// quiet "expanding soon" note; enabled + no data → empty; data → the summary.

interface TeamHealthResponse {
  enabled: boolean
  data?: ManagerTeamHealthV1
}

type Tone = 'good' | 'warn' | 'bad' | 'neutral'
function toneClass(tone: Tone): string {
  if (tone === 'good') return 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'
  if (tone === 'warn') return 'bg-amber-400/10 text-amber-300 ring-amber-400/20'
  if (tone === 'neutral') return 'bg-white/5 text-white/60 ring-white/15'
  return 'bg-red-400/10 text-red-300 ring-red-400/20'
}
function Chip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${toneClass(tone)}`}>{label}</span>
}
/** Render a chip only when the value maps to a tone (null tone → nothing). */
function OptionalChip({ label, tone }: { label: string; tone: Tone | null }) {
  return tone ? <Chip label={label} tone={tone} /> : null
}
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-white/45">{label}</dt>
      <dd className="font-medium text-white/80">{value}</dd>
    </div>
  )
}

const BENCH_TONE: Record<ManagerTeamHealthV1['benchAvailability'], Tone> = { healthy: 'good', thin: 'warn', critical: 'bad' }
const BENCH_LABEL: Record<ManagerTeamHealthV1['benchAvailability'], string> = {
  healthy: 'Bench: healthy',
  thin: 'Bench: thin',
  critical: 'Bench: critical',
}
const COMPLETE_TONE: Record<ManagerTeamHealthV1['rosterCompleteness'], Tone> = { excellent: 'good', good: 'good', needs_attention: 'warn' }
const COMPLETE_LABEL: Record<ManagerTeamHealthV1['rosterCompleteness'], string> = {
  excellent: 'Roster: excellent',
  good: 'Roster: good',
  needs_attention: 'Roster: needs attention',
}

function TeamHealthModule({ leagueId }: { leagueId: string }) {
  const r = useResource<TeamHealthResponse>(`/api/app/leagues/${encodeURIComponent(leagueId)}/team-health`)
  if (r.status !== 'ok') {
    return (
      <HubCard title="Current Team Health" testId="hub-team-health">
        <StateMessage status={r.status} />
      </HubCard>
    )
  }
  if (!r.data?.enabled) {
    return (
      <HubCard title="Current Team Health" testId="hub-team-health">
        <p className="text-xs text-white/40" data-testid="team-health-disabled">
          Injuries, byes, and roster readiness — expanding soon.
        </p>
      </HubCard>
    )
  }
  const h = r.data.data
  if (!h) {
    return (
      <HubCard title="Current Team Health" testId="hub-team-health">
        <p className="text-xs text-white/45" data-testid="team-health-empty">No roster data yet.</p>
      </HubCard>
    )
  }
  return (
    <HubCard title="Current Team Health" testId="hub-team-health">
      <div className="space-y-2.5" data-testid="team-health-content">
        <div className="flex flex-wrap gap-1.5">
          <Chip label={BENCH_LABEL[h.benchAvailability]} tone={BENCH_TONE[h.benchAvailability]} />
          <Chip label={COMPLETE_LABEL[h.rosterCompleteness]} tone={COMPLETE_TONE[h.rosterCompleteness]} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Stat label="Starters available" value={`${h.availableStarterCount} / ${h.starterCount}`} />
          <Stat label="Injured / out" value={h.injuredStarterCount} />
          <Stat label="Questionable" value={h.questionableStarterCount} />
          <Stat label="On bye" value={h.byeWeekStarterCount} />
        </dl>
        <p className="text-xs text-white/55">{h.summary}</p>
      </div>
    </HubCard>
  )
}

// ── Weekly Outlook module (Phase 3 — deterministic display contract) ──────────
// Consumes the internal, session-authed, display-only Weekly Outlook route.
// `{ enabled, data? }`: flag off → "expanding soon"; enabled + no data → empty;
// data → the observational outlook (matchup state, margin, lineup readiness).

interface WeeklyOutlookResponse {
  enabled: boolean
  data?: ManagerWeeklyOutlookV1
}

const STATE_LABEL: Record<ManagerWeeklyOutlookV1['matchupState'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  unavailable: 'No matchup',
}
const MARGIN_TONE: Record<ManagerWeeklyOutlookV1['projectedMargin'], Tone | null> = {
  favored: 'good',
  close: 'neutral',
  underdog: 'bad',
  unknown: null,
}
const MARGIN_LABEL: Record<ManagerWeeklyOutlookV1['projectedMargin'], string> = {
  favored: 'Favored',
  close: 'Close',
  underdog: 'Underdog',
  unknown: '',
}
const READINESS_TONE: Record<ManagerWeeklyOutlookV1['lineupReadiness'], Tone | null> = {
  ready: 'good',
  needs_attention: 'warn',
  incomplete: 'bad',
  unknown: null,
}
const READINESS_LABEL: Record<ManagerWeeklyOutlookV1['lineupReadiness'], string> = {
  ready: 'Lineup: ready',
  needs_attention: 'Lineup: needs attention',
  incomplete: 'Lineup: incomplete',
  unknown: '',
}

function WeeklyOutlookModule({ leagueId }: { leagueId: string }) {
  const r = useResource<WeeklyOutlookResponse>(`/api/app/leagues/${encodeURIComponent(leagueId)}/weekly-outlook`)
  if (r.status !== 'ok') {
    return (
      <HubCard title="Weekly Outlook" testId="hub-weekly-outlook">
        <StateMessage status={r.status} />
      </HubCard>
    )
  }
  if (!r.data?.enabled) {
    return (
      <HubCard title="Weekly Outlook" testId="hub-weekly-outlook">
        <p className="text-xs text-white/40" data-testid="weekly-outlook-disabled">
          Matchup, projected difficulty, and schedule — expanding soon.
        </p>
      </HubCard>
    )
  }
  const w = r.data.data
  if (!w) {
    return (
      <HubCard title="Weekly Outlook" testId="hub-weekly-outlook">
        <p className="text-xs text-white/45" data-testid="weekly-outlook-empty">No matchup data yet.</p>
      </HubCard>
    )
  }
  const hasProjection = w.projectedPointsFor != null && w.projectedPointsAgainst != null
  return (
    <HubCard title="Weekly Outlook" testId="hub-weekly-outlook">
      <div className="space-y-2.5" data-testid="weekly-outlook-content">
        <div className="flex items-center justify-between text-[11px] text-white/40">
          <span>{w.week != null ? `Week ${w.week}` : 'This week'}</span>
          <span>{STATE_LABEL[w.matchupState]}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <OptionalChip label={MARGIN_LABEL[w.projectedMargin]} tone={MARGIN_TONE[w.projectedMargin]} />
          <OptionalChip label={READINESS_LABEL[w.lineupReadiness]} tone={READINESS_TONE[w.lineupReadiness]} />
          {w.schedulePressure === 'high' ? <Chip label="Schedule: high" tone="warn" /> : null}
        </div>
        {hasProjection ? (
          <p className="text-xs text-white/70">
            Projected <span className="font-medium text-white/85">{w.projectedPointsFor}</span> –{' '}
            <span className="font-medium text-white/85">{w.projectedPointsAgainst}</span>
            {w.opponentName ? <span className="text-white/45"> vs {w.opponentName}</span> : null}
          </p>
        ) : w.opponentName ? (
          <p className="text-xs text-white/45">vs {w.opponentName}</p>
        ) : null}
        <p className="text-xs text-white/55">{w.summary}</p>
        {w.caveats.length > 0 ? (
          <ul className="space-y-0.5" data-testid="weekly-outlook-caveats">
            {w.caveats.map((c, i) => (
              <li key={i} className="text-[11px] text-white/35">• {c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </HubCard>
  )
}

// ── Transaction Readiness module (Phase 4 — deterministic display contract) ───
// Consumes the internal, session-authed, display-only Transaction Readiness route.
// `{ enabled, data? }`: flag off → "expanding soon"; enabled + no data → empty;
// data → the observational readiness picture (pressure, bench flexibility, counts).

interface TransactionReadinessResponse {
  enabled: boolean
  data?: ManagerTransactionReadinessV1
}

const TXN_PRESSURE_TONE: Record<ManagerTransactionReadinessV1['rosterPressure'], Tone | null> = {
  low: 'good',
  moderate: 'warn',
  high: 'bad',
  unknown: null,
}
const TXN_PRESSURE_LABEL: Record<ManagerTransactionReadinessV1['rosterPressure'], string> = {
  low: 'Pressure: low',
  moderate: 'Pressure: moderate',
  high: 'Pressure: high',
  unknown: '',
}
const TXN_FLEX_TONE: Record<ManagerTransactionReadinessV1['benchFlexibility'], Tone | null> = {
  flexible: 'good',
  limited: 'warn',
  tight: 'bad',
  unknown: null,
}
const TXN_FLEX_LABEL: Record<ManagerTransactionReadinessV1['benchFlexibility'], string> = {
  flexible: 'Bench: flexible',
  limited: 'Bench: limited',
  tight: 'Bench: tight',
  unknown: '',
}

function TransactionReadinessModule({ leagueId }: { leagueId: string }) {
  const r = useResource<TransactionReadinessResponse>(`/api/app/leagues/${encodeURIComponent(leagueId)}/transaction-readiness`)
  if (r.status !== 'ok') {
    return (
      <HubCard title="Transaction Readiness" testId="hub-transaction-readiness">
        <StateMessage status={r.status} />
      </HubCard>
    )
  }
  if (!r.data?.enabled) {
    return (
      <HubCard title="Transaction Readiness" testId="hub-transaction-readiness">
        <p className="text-xs text-white/40" data-testid="transaction-readiness-disabled">
          Waiver availability, roster flexibility, and bench pressure — expanding soon.
        </p>
      </HubCard>
    )
  }
  const t = r.data.data
  if (!t) {
    return (
      <HubCard title="Transaction Readiness" testId="hub-transaction-readiness">
        <p className="text-xs text-white/45" data-testid="transaction-readiness-empty">No roster data yet.</p>
      </HubCard>
    )
  }
  return (
    <HubCard title="Transaction Readiness" testId="hub-transaction-readiness">
      <div className="space-y-2.5" data-testid="transaction-readiness-content">
        <div className="flex flex-wrap gap-1.5">
          <OptionalChip label={TXN_PRESSURE_LABEL[t.rosterPressure]} tone={TXN_PRESSURE_TONE[t.rosterPressure]} />
          <OptionalChip label={TXN_FLEX_LABEL[t.benchFlexibility]} tone={TXN_FLEX_TONE[t.benchFlexibility]} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Stat label="Bench" value={t.benchCount} />
          <Stat label="Reserves" value={t.reserveCount} />
          <Stat label="On IR" value={t.injuredReserveCount} />
          <Stat label="Open slots" value={t.rosterOpenings} />
        </dl>
        <p className="text-xs text-white/55">{t.summary}</p>
        {t.caveats.length > 0 ? (
          <ul className="space-y-0.5" data-testid="transaction-readiness-caveats">
            {t.caveats.map((c, i) => (
              <li key={i} className="text-[11px] text-white/35">• {c}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </HubCard>
  )
}

// ── Hub ───────────────────────────────────────────────────────────────────────

export function ManagerIntelligenceHub({ leagueId }: { leagueId: string }) {
  const enabled = process.env.NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED === 'true'
  if (!enabled) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10" data-testid="manager-hub-disabled">
        <p className="text-sm text-white/50">The Manager Intelligence Hub isn’t available yet.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6" data-testid="manager-intelligence-hub">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight text-white">Manager Intelligence</h2>
          <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/55 ring-1 ring-white/10">
            Observations, not advice
          </span>
        </div>
        <p className="text-xs text-white/45">
          A unified read on your team this week — health, matchup, roster readiness, league context, and historical
          signal, all grounded in your league’s own data.
        </p>
      </header>

      {/* Historical Intelligence — reuses the replay panel unchanged (Phase 20/21). */}
      <ManagerReplayInsightsCard leagueId={leagueId} />

      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2" data-testid="manager-hub-grid">
        <LeagueContextModule leagueId={leagueId} />
        <WeeklyOutlookModule leagueId={leagueId} />
        <TeamHealthModule leagueId={leagueId} />
        <TransactionReadinessModule leagueId={leagueId} />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="text-[11px] text-white/35">
          Every signal is a descriptive summary of your league’s own data — not a prescription of which moves to make.
        </p>
        <a
          href={`/league/${encodeURIComponent(leagueId)}`}
          className="shrink-0 text-[11px] font-medium text-cyan-300/90 hover:underline"
          data-testid="manager-hub-back-cta"
        >
          Back to league →
        </a>
      </footer>
    </div>
  )
}
