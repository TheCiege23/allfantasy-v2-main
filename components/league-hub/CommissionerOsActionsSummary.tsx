'use client'

/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Parts 16-17.
 *
 * Commissioner-only — never rendered for a normal manager. Gated on the
 * real, server-verified `context.isCommissioner` from `ActiveLeagueContext`
 * (never a client-side guess); the API call itself is ALSO independently
 * authorization-checked server-side, so even if this component somehow
 * rendered for a non-commissioner, the fetch would still 404. Reuses the
 * same dark/opacity Tailwind convention as `UserOsActionsSummary.tsx` — no
 * dashboard redesign.
 *
 * Part 17 (copy-ready content workflow): preview/edit/copy/dismiss for any
 * recommendation that carries real `copyReadyContent` (storylines,
 * rivalries, draft grades). There is no "regenerate" call — the underlying
 * content is deterministic/template-based against real evidence, not an LLM
 * call, so identical inputs always produce identical text; "Refresh" re-runs
 * the same real coordinator against current data, which is the honest
 * equivalent of a regenerate for this phase's scoping. Dismiss is
 * client-side/session-only (no publish, no server mutation) — nothing here
 * is ever auto-sent anywhere.
 */
import { useCallback, useEffect, useState } from 'react'
import { useActiveLeagueContext } from './ActiveLeagueContextProvider'

interface CopyReadyContent {
  channel: string
  text: string
  characterCount: number
  characterLimit: number | null
  available: boolean
}

interface RecommendationSummary {
  id: string
  domain: string
  type: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  title: string
  summary: string
  governanceSeverity?: string
  humanReviewRequired?: boolean
  copyReadyContent?: CopyReadyContent[]
}

interface CommissionerRecommendationsApiResponse {
  bundle: { commissioner: RecommendationSummary[]; totalCount: number }
  domainStatus: Record<string, 'ok' | 'unavailable' | 'unsupported' | 'stale_blocked' | 'engine_error'>
  generatedAt: string
}

const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 }
const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-400',
  high: 'bg-amber-400',
  medium: 'bg-sky-400',
  low: 'bg-white/30',
}

const DOMAIN_LABEL: Record<string, string> = {
  health: 'League Health',
  engagement: 'Engagement',
  rankings: 'Rankings',
  storylines: 'Storylines',
  rivalries: 'Rivalries',
  draft: 'Draft',
  trades: 'Trades',
  integrity: 'Integrity',
}

const CHANNEL_LABEL: Record<string, string> = {
  league_chat: 'League chat',
  discord: 'Discord',
  email: 'Email',
  newsletter: 'Newsletter',
  social_caption: 'Social caption',
  in_app_only: 'In-app only',
}

/**
 * `LeagueTabs.tsx` gives NFL/NCAAF a `commissioner` tab id, while every
 * other sport uses `league` — linking the wrong id silently falls back to
 * that sport's default tab instead of the commissioner view.
 */
const FOOTBALL_SPORTS = new Set(['NFL', 'NCAAF', 'NCAAFB'])

function resolveCommissionerTabId(sport: string | undefined | null): string {
  if (!sport) return 'league'
  return FOOTBALL_SPORTS.has(sport.trim().toUpperCase()) ? 'commissioner' : 'league'
}

export function CommissionerOsActionsSummary() {
  const { context } = useActiveLeagueContext()
  const [data, setData] = useState<CommissionerRecommendationsApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const isCommissioner = context?.isCommissioner === true
  const canonicalLeagueId = context?.canonicalLeagueId

  const load = useCallback(() => {
    if (!canonicalLeagueId || !isCommissioner) {
      setData(null)
      return () => {}
    }
    let active = true
    setIsLoading(true)
    setError(null)
    fetch(`/api/league-hub/context/${encodeURIComponent(canonicalLeagueId)}/commissioner-recommendations`, {
      cache: 'no-store',
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Failed to load commissioner recommendations'))
      )
      .then((payload: CommissionerRecommendationsApiResponse) => {
        if (!active) return
        setData(payload)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load Commissioner OS for this league')
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [canonicalLeagueId, isCommissioner])

  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  // Never rendered for a normal manager — no widget, no placeholder, nothing.
  if (!isCommissioner) return null

  return (
    <section
      className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4"
      data-testid="commissioner-os-actions-summary"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-amber-200/80">Commissioner OS</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={load}
            className="text-xs text-white/40 underline decoration-dotted hover:text-white/60"
          >
            Refresh
          </button>
          <a
            href={`/league/${canonicalLeagueId}?tab=${resolveCommissionerTabId(context?.sport)}`}
            className="text-xs text-cyan-400 underline"
          >
            View all
          </a>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-lg border border-white/10 bg-white/5" aria-busy="true" />
      ) : error ? (
        <p className="mt-3 text-sm text-red-300">{error}</p>
      ) : (
        <CommissionerOsBody data={data} dismissedIds={dismissedIds} onDismiss={(id) => setDismissedIds((prev) => new Set(prev).add(id))} />
      )}
    </section>
  )
}

function CommissionerOsBody({
  data,
  dismissedIds,
  onDismiss,
}: {
  data: CommissionerRecommendationsApiResponse | null
  dismissedIds: Set<string>
  onDismiss: (id: string) => void
}) {
  if (!data) return null

  const recs = [...data.bundle.commissioner]
    .filter((r) => !dismissedIds.has(r.id))
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
  const urgentCount = recs.filter((r) => r.priority === 'critical' || r.priority === 'high').length
  const reviewCount = recs.filter((r) => r.humanReviewRequired).length
  const top = recs[0] ?? null
  const domainEntries = Object.entries(data.domainStatus)
  const copyReady = recs.filter((r) => r.copyReadyContent && r.copyReadyContent.some((c) => c.available))

  return (
    <div className="mt-3">
      {top ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[top.priority]}`} aria-hidden />
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
                {DOMAIN_LABEL[top.domain] ?? top.domain}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(top.id)}
              className="text-[11px] text-white/30 hover:text-white/60"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1 text-sm font-semibold text-white">{top.title}</p>
          <p className="mt-0.5 text-xs text-white/60">{top.summary}</p>
        </div>
      ) : (
        <p className="text-sm text-white/50">No commissioner action needed right now.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {urgentCount > 0 ? (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
            {urgentCount} urgent
          </span>
        ) : null}
        {reviewCount > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            {reviewCount} review recommended
          </span>
        ) : null}
        {domainEntries.map(([domain, status]) => (
          <span
            key={domain}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              status === 'ok' ? 'border-white/10 bg-white/5 text-white/60' : 'border-white/10 bg-white/[0.03] text-white/30'
            }`}
            title={status}
          >
            {DOMAIN_LABEL[domain] ?? domain}
          </span>
        ))}
      </div>

      {copyReady.length > 0 ? <CopyReadyPanel recommendations={copyReady} onDismiss={onDismiss} /> : null}

      <p className="mt-2 text-[11px] text-white/35">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </div>
  )
}

function CopyReadyPanel({
  recommendations,
  onDismiss,
}: {
  recommendations: RecommendationSummary[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/40">Copy-ready content</h3>
      <div className="mt-2 flex flex-col gap-2">
        {recommendations.map((rec) => (
          <CopyReadyCard key={rec.id} recommendation={rec} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  )
}

function CopyReadyCard({
  recommendation,
  onDismiss,
}: {
  recommendation: RecommendationSummary
  onDismiss: (id: string) => void
}) {
  const available = (recommendation.copyReadyContent ?? []).filter((c) => c.available)
  const [channelIndex, setChannelIndex] = useState(0)
  const active = available[channelIndex] ?? available[0]
  const [draft, setDraft] = useState(active?.text ?? '')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDraft(active?.text ?? '')
    setCopied(false)
  }, [active?.channel, active?.text])

  if (!active) return null

  const overLimit = active.characterLimit !== null && draft.length > active.characterLimit

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-white/70">{recommendation.title}</p>
        <button
          type="button"
          onClick={() => onDismiss(recommendation.id)}
          className="text-[11px] text-white/30 hover:text-white/60"
        >
          Dismiss
        </button>
      </div>

      {available.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {available.map((c, i) => (
            <button
              key={c.channel}
              type="button"
              onClick={() => setChannelIndex(i)}
              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                i === channelIndex
                  ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300'
                  : 'border-white/10 bg-white/5 text-white/50'
              }`}
            >
              {CHANNEL_LABEL[c.channel] ?? c.channel}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] uppercase tracking-wide text-white/30">
          {CHANNEL_LABEL[active.channel] ?? active.channel}
        </p>
      )}

      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setCopied(false)
        }}
        rows={3}
        className="mt-2 w-full resize-none rounded-md border border-white/10 bg-black/30 p-2 text-xs text-white/80 focus:border-cyan-400/40 focus:outline-none"
      />

      <div className="mt-1.5 flex items-center justify-between">
        <span className={`text-[10px] ${overLimit ? 'text-red-300' : 'text-white/30'}`}>
          {draft.length}
          {active.characterLimit !== null ? ` / ${active.characterLimit}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {copied ? <span className="text-[11px] text-emerald-300">Copied</span> : null}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(draft).then(() => setCopied(true))
            }}
            disabled={overLimit}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}
