'use client'

/**
 * G15.6 — Commissioner Hub read-only surface.
 *
 * Consumes ONLY the G15.5 Intelligence API contracts (no DB/provider/raw access, no writes).
 * Each module owns its own loading/empty/error/permission state. Commissioner-only modules
 * (health, action-items) render a clean "commissioner only / unavailable" card on 401/403/404
 * and "upgrade" on 402 — no hidden data leaks through fallbacks.
 *
 * Types are local (mirroring the API contract) so this client bundle never imports server-only
 * intelligence modules.
 */
import { useCallback, useEffect, useState } from 'react'
// Type-only import from the pure types module (no server/prisma deps reach the
// client bundle). Do NOT import from the barrel — it re-exports the DB resolver.
import type { CommissionerTradeReviewV1 } from '@/lib/decision-os/commissioner-intelligence/trade-review/types'

// ── Contract types (mirror /api/v1/intelligence DTOs) ────────────────────────
interface ActivitySummary {
  leagueId: string
  sport: string | null
  leagueConcept: string | null
  totalEvents: number
  firstEventAt: string | null
  lastActivityAt: string | null
  openTradeProposals: number
  counts: { trade: number; waiver: number; lineup: number; draft: number; scoring: number; governance: number; lifecycle: number; other: number }
}
interface HealthSnapshot {
  leagueId: string
  healthScore: number
  status: 'healthy' | 'cooling' | 'stale' | 'unknown'
  totalManagers: number
  activeManagers: number
  daysSinceLastActivity: number | null
  openTradeProposals: number
}
interface ActionItem { kind: string; severity: 'info' | 'warning' | 'action'; message: string }
interface AuditItem { eventId: string; type: string; summary: string; occurredAt: string; actorType: string | null }

// G15.14 — Story preview contract (mirror /api/v1/stories DTOs).
interface StorySection { heading: string; body: string }
interface StoryPreview {
  type: string
  title: string
  summary: string
  sections: StorySection[]
  safetyNote: string
  status: 'ok' | 'empty' | 'restricted'
  empty: boolean
  generatedAt: string
  sourceFreshness: string | null
}
const STORY_TITLES: Record<string, string> = {
  weekly_recap: 'Weekly League Recap',
  what_happened_recently: 'What Happened Recently',
  activity_report: 'League Activity Report',
  commissioner_summary: 'Commissioner Summary',
  health_narrative: 'League Health Narrative',
}
// Member-readable vs commissioner-only (matches the story API permission model).
const STORY_CARDS: { type: string; commissionerOnly: boolean }[] = [
  { type: 'weekly_recap', commissionerOnly: false },
  { type: 'what_happened_recently', commissionerOnly: false },
  { type: 'activity_report', commissionerOnly: false },
  { type: 'commissioner_summary', commissionerOnly: true },
  { type: 'health_narrative', commissionerOnly: true },
]

type ResourceStatus = 'loading' | 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'upgrade' | 'error'
interface Resource<T> { status: ResourceStatus; data?: T; reload: () => void }

function statusFromHttp(code: number): ResourceStatus {
  if (code === 200) return 'ok'
  if (code === 401) return 'unauthorized'
  if (code === 402) return 'upgrade'
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
          const body = (await res.json().catch(() => ({}))) as { data?: T }
          if (active) {
            setData(body.data)
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

// ── Shared UI ────────────────────────────────────────────────────────────────
const card = 'rounded-xl border border-white/10 bg-[#0a1328] p-4 transition-colors hover:border-white/20'
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className={card} data-testid={testId}>
      <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

function StateMessage({ status, commissionerOnly }: { status: ResourceStatus; commissionerOnly?: boolean }) {
  if (status === 'loading') {
    return (
      <div className="space-y-2" data-testid="state-loading" role="status" aria-label="Loading">
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-white/10" />
        <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/10" />
      </div>
    )
  }
  if (status === 'forbidden' || status === 'not_found' || status === 'unauthorized') {
    return (
      <p className="text-xs text-white/45" data-testid="state-restricted">
        {commissionerOnly ? 'Commissioner only.' : 'Not available.'}
      </p>
    )
  }
  if (status === 'upgrade') return <p className="text-xs text-amber-300/80" data-testid="state-upgrade">Premium feature — upgrade required.</p>
  return <p className="text-xs text-red-300/80" data-testid="state-error">Could not load. Try again.</p>
}

// ── Modules ──────────────────────────────────────────────────────────────────
function ActivityModule({ leagueId }: { leagueId: string }) {
  const r = useResource<ActivitySummary>(`/api/v1/intelligence/leagues/${encodeURIComponent(leagueId)}/activity`)
  return (
    <Card title="League Activity Summary" testId="module-activity">
      {r.status !== 'ok' ? (
        <StateMessage status={r.status} />
      ) : !r.data || r.data.totalEvents === 0 ? (
        <p className="text-xs text-white/45" data-testid="activity-empty">No activity recorded yet.</p>
      ) : (
        <div data-testid="activity-content">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/70">
            <span><span className="text-white/40">Total events</span> {r.data.totalEvents}</span>
            <span><span className="text-white/40">Open trades</span> {r.data.openTradeProposals}</span>
            <span><span className="text-white/40">Last activity</span> {fmtDate(r.data.lastActivityAt)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['trade', 'waiver', 'lineup', 'draft', 'scoring', 'governance', 'lifecycle', 'other'] as const).map((k) => (
              <div key={k} className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1.5 text-[11px]">
                <div className="capitalize text-white/40">{k}</div>
                <div className="text-white/85">{r.data!.counts[k]}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function HealthModule({ leagueId }: { leagueId: string }) {
  const r = useResource<HealthSnapshot>(`/api/v1/intelligence/leagues/${encodeURIComponent(leagueId)}/health`)
  const color = { healthy: 'text-emerald-300', cooling: 'text-amber-300', stale: 'text-red-300', unknown: 'text-white/40' }
  return (
    <Card title="League Health" testId="module-health">
      {r.status !== 'ok' ? (
        <StateMessage status={r.status} commissionerOnly />
      ) : !r.data || r.data.status === 'unknown' ? (
        <p className="text-xs text-white/45" data-testid="health-empty">Not enough data yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/70" data-testid="health-content">
          <span className={`text-lg font-bold ${color[r.data.status]}`}>{r.data.healthScore}</span>
          <span className={`font-semibold capitalize ${color[r.data.status]}`}>{r.data.status}</span>
          <span><span className="text-white/40">Active managers</span> {r.data.activeManagers}/{r.data.totalManagers}</span>
          <span><span className="text-white/40">Days since activity</span> {r.data.daysSinceLastActivity ?? '—'}</span>
        </div>
      )}
    </Card>
  )
}

function ActionItemsModule({ leagueId }: { leagueId: string }) {
  const r = useResource<ActionItem[]>(`/api/v1/intelligence/leagues/${encodeURIComponent(leagueId)}/action-items`)
  const sev = { info: 'border-sky-500/30 text-sky-200', warning: 'border-amber-500/30 text-amber-200', action: 'border-red-500/30 text-red-200' }
  return (
    <Card title="Commissioner Action Items" testId="module-action-items">
      {r.status !== 'ok' ? (
        <StateMessage status={r.status} commissionerOnly />
      ) : !r.data || r.data.length === 0 ? (
        <p className="text-xs text-white/45" data-testid="action-items-empty">All clear — no action items.</p>
      ) : (
        <ul className="space-y-2" data-testid="action-items-content">
          {r.data.map((it, i) => (
            <li key={`${it.kind}-${i}`} className={`rounded-lg border bg-black/20 px-3 py-2 text-xs ${sev[it.severity]}`}>
              {it.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AuditFeedModule({ leagueId }: { leagueId: string }) {
  const [items, setItems] = useState<AuditItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [status, setStatus] = useState<ResourceStatus>('loading')
  const [loadedOnce, setLoadedOnce] = useState(false)

  const load = useCallback(
    async (after?: string | null) => {
      setStatus('loading')
      const qs = new URLSearchParams({ limit: '10', ...(after ? { cursor: after } : {}) })
      try {
        const res = await fetch(`/api/v1/intelligence/leagues/${encodeURIComponent(leagueId)}/audit-feed?${qs}`, { cache: 'no-store' })
        const s = statusFromHttp(res.status)
        if (s !== 'ok') {
          setStatus(s)
          return
        }
        const body = (await res.json().catch(() => ({}))) as { data?: AuditItem[]; meta?: { nextCursor?: string | null } }
        setItems((prev) => (after ? [...prev, ...(body.data ?? [])] : body.data ?? []))
        setCursor(body.meta?.nextCursor ?? null)
        setStatus('ok')
        setLoadedOnce(true)
      } catch {
        setStatus('error')
      }
    },
    [leagueId],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card title="League Activity Timeline" testId="module-audit-feed">
      {status !== 'ok' && !loadedOnce ? (
        <StateMessage status={status} />
      ) : items.length === 0 ? (
        <p className="text-xs text-white/45" data-testid="audit-feed-empty">No events yet.</p>
      ) : (
        <div data-testid="audit-feed-content">
          <ul className="space-y-1.5">
            {items.map((it) => (
              <li key={it.eventId} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-1.5 text-[11px]">
                <span className="text-white/80">{it.summary}</span>
                <span className="shrink-0 text-white/35">{fmtDate(it.occurredAt)}</span>
              </li>
            ))}
          </ul>
          {cursor ? (
            <button
              type="button"
              onClick={() => void load(cursor)}
              disabled={status === 'loading'}
              className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.04] disabled:opacity-40"
              data-testid="audit-feed-load-more"
            >
              {status === 'loading' ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </div>
      )}
    </Card>
  )
}

// G15.14 — read-only Story Cards. Each card owns its loading/empty/restricted/upgrade state and
// consumes ONLY the story preview API (deterministic; no LLM call, no writes, no auto-post).
// Commissioner-only story types render a clean "Commissioner only" card on 401/403/404.
function StoryCard({ leagueId, type, commissionerOnly }: { leagueId: string; type: string; commissionerOnly: boolean }) {
  const r = useResource<StoryPreview>(`/api/v1/stories/leagues/${encodeURIComponent(leagueId)}/preview?type=${encodeURIComponent(type)}`)
  const title = r.data?.title ?? STORY_TITLES[type] ?? 'League Story'
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4" data-testid={`story-card-${type}`}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {r.status !== 'ok' ? (
        <div className="mt-2">
          <StateMessage status={r.status} commissionerOnly={commissionerOnly} />
        </div>
      ) : !r.data || r.data.empty ? (
        <p className="mt-2 text-xs text-white/45" data-testid={`story-empty-${type}`}>
          {r.data?.summary ?? 'Not enough recorded league activity yet to tell this story.'}
        </p>
      ) : (
        <div className="mt-2 space-y-3" data-testid={`story-content-${type}`}>
          <p className="text-xs text-white/70">{r.data.summary}</p>
          {r.data.sections.map((s, i) => (
            <div key={`${s.heading}-${i}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{s.heading}</div>
              <p className="whitespace-pre-line text-xs text-white/75">{s.body}</p>
            </div>
          ))}
          <p className="text-[10px] italic text-white/30" data-testid={`story-safety-${type}`}>{r.data.safetyNote}</p>
        </div>
      )}
    </div>
  )
}

function StoriesModule({ leagueId }: { leagueId: string }) {
  return (
    <Card title="League Stories" testId="module-stories">
      <p className="mb-3 text-[11px] text-white/40">Auto-generated, read-only narrative drafts from recorded league activity.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {STORY_CARDS.map((c) => (
          <StoryCard key={c.type} leagueId={leagueId} type={c.type} commissionerOnly={c.commissionerOnly} />
        ))}
      </div>
    </Card>
  )
}

// ── Trade Review (Phase 4 — deterministic review-WORKLOAD, not fairness) ──────
// Consumes the internal, session-authed, commissioner-scoped, default-off route
// `{ enabled, data? }`. flag off → "expanding soon"; enabled + no data → empty;
// data → observational workload (pending / recent / review windows / votes).
interface TradeReviewResponse {
  enabled: boolean
  data?: CommissionerTradeReviewV1
}

const TR_ACTIVITY_COLOR: Record<CommissionerTradeReviewV1['tradeActivity'], string> = {
  quiet: 'text-white/40',
  normal: 'text-emerald-300',
  active: 'text-cyan-300',
  unknown: 'text-white/40',
}
const TR_WORKLOAD: Record<CommissionerTradeReviewV1['reviewWorkload'], { color: string; label: string }> = {
  none: { color: 'text-white/40', label: 'None' },
  watch: { color: 'text-amber-300', label: 'Watch' },
  requires_review: { color: 'text-red-300', label: 'Requires review' },
  unknown: { color: 'text-white/40', label: 'Unknown' },
}

function TradeReviewContent({ data }: { data: CommissionerTradeReviewV1 }) {
  const wl = TR_WORKLOAD[data.reviewWorkload]
  return (
    <div className="space-y-3" data-testid="trade-review-content">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-white/70">
        <span><span className="text-white/40">Pending</span> {data.pendingTradeCount}</span>
        <span><span className="text-white/40">Recent (14d)</span> {data.recentTradeCount}</span>
        <span><span className="text-white/40">Review windows</span> {data.reviewWindowCount}</span>
        <span><span className="text-white/40">Votes</span> {data.voteCount}</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className={`font-semibold capitalize ${TR_ACTIVITY_COLOR[data.tradeActivity]}`}>Activity: {data.tradeActivity}</span>
        <span className={`font-semibold ${wl.color}`}>Workload: {wl.label}</span>
      </div>
      <p className="text-xs text-white/60">{data.summary}</p>
      {data.caveats.length > 0 ? (
        <ul className="space-y-0.5" data-testid="trade-review-caveats">
          {data.caveats.map((c, i) => (
            <li key={i} className="text-[11px] text-white/35">• {c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function TradeReviewModule({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{ status: ResourceStatus; body?: TradeReviewResponse }>({ status: 'loading' })
  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    fetch(`/api/app/leagues/${encodeURIComponent(leagueId)}/commissioner/trade-review`, { cache: 'no-store' })
      .then(async (res) => {
        const s = statusFromHttp(res.status)
        if (s === 'ok') {
          const body = (await res.json().catch(() => ({}))) as TradeReviewResponse
          if (active) setState({ status: 'ok', body })
        } else if (active) {
          setState({ status: s })
        }
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [leagueId])

  return (
    <Card title="Trade Review" testId="module-trade-review">
      {state.status !== 'ok' ? (
        <StateMessage status={state.status} commissionerOnly />
      ) : !state.body?.enabled ? (
        <p className="text-xs text-white/40" data-testid="trade-review-disabled">Trade-review workload — expanding soon.</p>
      ) : !state.body.data ? (
        <p className="text-xs text-white/45" data-testid="trade-review-empty">No trade data yet.</p>
      ) : (
        <TradeReviewContent data={state.body.data} />
      )}
    </Card>
  )
}

export function CommissionerIntelligenceHub({ leagueId }: { leagueId: string }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8 text-white" data-testid="commissioner-intelligence-hub">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Commissioner Intelligence</h1>
            <p className="mt-0.5 text-xs text-white/45">
              A read-only view of your league’s activity, health, action items, stories, and event
              timeline — grounded in your league’s own recorded events.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-medium text-white/55 ring-1 ring-white/10">
            Observations, not actions
          </span>
        </div>
      </header>

      <ActivityModule leagueId={leagueId} />
      <HealthModule leagueId={leagueId} />
      <ActionItemsModule leagueId={leagueId} />
      <TradeReviewModule leagueId={leagueId} />
      <StoriesModule leagueId={leagueId} />
      <AuditFeedModule leagueId={leagueId} />

      <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
        <p className="text-[11px] text-white/35">
          Every module is a read-only observation of your league’s own activity — never a prescribed
          commissioner action.
        </p>
        <a
          href={`/league/${encodeURIComponent(leagueId)}`}
          className="shrink-0 text-[11px] font-medium text-cyan-300/90 hover:underline"
          data-testid="commissioner-hub-back-cta"
        >
          Back to league →
        </a>
      </footer>
    </main>
  )
}

export default CommissionerIntelligenceHub
