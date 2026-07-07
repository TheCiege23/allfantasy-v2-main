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
 * Sections wired to a clean, existing/deterministic, non-recommendation source:
 *   - Historical Intelligence → reuses the Phase 20/21 <ManagerReplayInsightsCard>
 *   - League Context          → reuses GET /api/app/leagues/[id]/standings
 *   - Current Team Health     → Phase 2 deterministic ManagerTeamHealthV1 contract
 *                               via GET /api/app/leagues/[id]/team-health
 * Sections whose only existing sources are AI/recommendation endpoints or that
 * need a new backend aggregation (out of scope for now) render an honest
 * "expanding soon" placeholder — never a fabricated summary:
 *   - Weekly Outlook · Transaction Readiness
 *
 * Gated by NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED (default off → the hub
 * shows a quiet "not available" state so nothing ships before it's ready).
 */

import { useCallback, useEffect, useState } from 'react'
import { ManagerReplayInsightsCard } from '@/components/dashboard/ManagerReplayInsightsCard'
// Type-only import from the pure types module (no runtime/server deps reach the
// client bundle). Do NOT import from the barrel — it re-exports the DB resolver.
import type { ManagerTeamHealthV1 } from '@/lib/decision-os/manager-intelligence/team-health/types'

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
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4" data-testid={testId}>
      <h3 className="mb-3 text-sm font-semibold text-white/90">{title}</h3>
      {children}
    </section>
  )
}

function StateMessage({ status }: { status: ResourceStatus }) {
  if (status === 'loading') return <p className="text-xs text-white/50" role="status">Loading…</p>
  if (status === 'forbidden' || status === 'not_found' || status === 'unauthorized') {
    return <p className="text-xs text-white/45">Not available.</p>
  }
  return <p className="text-xs text-red-300/80">Could not load. Try again.</p>
}

/** Honest placeholder for a section whose data has no clean, existing, non-recommendation client source yet. */
function ComingSoon({ title, testId, note }: { title: string; testId: string; note: string }) {
  return (
    <HubCard title={title} testId={testId}>
      <p className="text-xs text-white/40">{note}</p>
    </HubCard>
  )
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

type Tone = 'good' | 'warn' | 'bad'
function toneClass(tone: Tone): string {
  if (tone === 'good') return 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'
  if (tone === 'warn') return 'bg-amber-400/10 text-amber-300 ring-amber-400/20'
  return 'bg-red-400/10 text-red-300 ring-red-400/20'
}
function Chip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${toneClass(tone)}`}>{label}</span>
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
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6" data-testid="manager-intelligence-hub">
      <header>
        <h2 className="text-lg font-black text-white">Manager Intelligence</h2>
        <p className="mt-0.5 text-xs text-white/45">Everything worth your attention this week, in one place. Observations, not advice.</p>
      </header>

      {/* Historical Intelligence — reuses the replay panel unchanged (Phase 20/21). */}
      <ManagerReplayInsightsCard leagueId={leagueId} />

      <div className="grid gap-4 md:grid-cols-2" data-testid="manager-hub-grid">
        <LeagueContextModule leagueId={leagueId} />
        <ComingSoon
          title="Weekly Outlook"
          testId="hub-weekly-outlook"
          note="Matchup, projected difficulty, and schedule — expanding soon."
        />
        <TeamHealthModule leagueId={leagueId} />
        <ComingSoon
          title="Transaction Readiness"
          testId="hub-transaction-readiness"
          note="Waiver availability, roster flexibility, and bench pressure — expanding soon."
        />
      </div>
    </div>
  )
}
