'use client'

/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Parts 16-17.
 *
 * Mounted by the server-gated commissioner hub with an explicit league id.
 * The API independently checks authorization. Styled with `af-ch-os-*` classes
 * in af-commish-hub.css on the Core theme tokens — never Tailwind white/colour
 * utilities, which af-core.css forbids in this scope because light mode clamps
 * them unreadable.
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

/**
 * The area a recommendation belongs to, from its `type`.
 *
 * 🛑 NOT FROM `domain`. On a commissioner recommendation `domain` names the OS it belongs to —
 * every generator sets `'commissioner'` — so `DOMAIN_LABEL[top.domain]` never matched and the
 * card printed the raw word, upper-cased by `.af-label`: "COMMISSIONER" on every card. Seen
 * 2026-10-01 in a signed-in check. Each generator's `type` starts with its area instead.
 */
const TYPE_AREA: ReadonlyArray<[prefix: string, area: string]> = [
  ['league_health', 'health'],
  ['engagement_', 'engagement'],
  ['mission_control_action', 'health'],
  ['power_rankings', 'rankings'],
  ['storyline_', 'storylines'],
  ['rivalry_', 'rivalries'],
  ['draft_', 'draft'],
  ['trade_', 'trades'],
  ['integrity_', 'integrity'],
]

export function recommendationAreaLabel(rec: { type: string }): string {
  const area = TYPE_AREA.find(([prefix]) => rec.type.startsWith(prefix))?.[1]
  // An unknown type gets a neutral label, never a raw internal value.
  return (area && DOMAIN_LABEL[area]) || 'Commissioner action'
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

const UNVERIFIED = 'unverified'

export function CommissionerOsActionsSummary({ leagueId, sport }: { leagueId: string; sport?: string | null }) {
  const [data, setData] = useState<CommissionerRecommendationsApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // The parent hub is server-gated for commissioners and co-commissioners. The API
  // independently checks the session's league role before returning recommendations.
  const canonicalLeagueId = leagueId

  const load = useCallback(() => {
    if (!canonicalLeagueId) {
      setData(null)
      return () => {}
    }
    let active = true
    setIsLoading(true)
    setError(null)
    fetch(`/api/league-hub/context/${encodeURIComponent(canonicalLeagueId)}/commissioner-recommendations`, {
      cache: 'no-store',
    })
      .then((response) => {
        // The hub admits whoever `getLeagueRole` calls commissioner, which includes the
        // importer of any league. This route trusts ownership only on native leagues, so an
        // importer who never verified as commissioner reaches the hub and gets a 404 here.
        // That is a missing verification, not a failure — say so instead of showing red.
        if (response.status === 404) return Promise.reject(new Error(UNVERIFIED))
        return response.ok ? response.json() : Promise.reject(new Error('Failed to load commissioner recommendations'))
      })
      .then((payload: CommissionerRecommendationsApiResponse) => {
        if (!active) return
        setData(payload)
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error && e.message === UNVERIFIED ? UNVERIFIED : 'Could not load Commissioner OS for this league')
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [canonicalLeagueId])

  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  return (
    <section
      className="af-ch-os"
      data-testid="commissioner-os-actions-summary"
    >
      <div className="af-ch-os-head">
        <h2 className="af-ch-os-title">Commissioner OS</h2>
        <div className="af-ch-os-head-actions">
          <button
            type="button"
            onClick={load}
            className="af-ch-os-textbtn"
          >
            Refresh
          </button>
          <a
            href={`/league/${canonicalLeagueId}?tab=${resolveCommissionerTabId(sport)}`}
            className="af-ch-os-link"
          >
            View all
          </a>
        </div>
      </div>

      {isLoading ? (
        <div className="af-ch-os-skeleton" aria-busy="true" />
      ) : error === UNVERIFIED ? (
        <p className="af-ch-os-note" data-testid="commissioner-os-unverified">
          Recommendations appear once you are verified as this league&apos;s commissioner on its provider.
        </p>
      ) : error ? (
        <p className="af-ch-os-note" data-tone="bad" role="alert">{error}</p>
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
    <div className="af-ch-os-body">
      {top ? (
        <div className="af-ch-os-card">
          <div className="af-ch-os-card-head">
            <div className="af-ch-os-card-domain">
              <span className="af-ch-os-dot" data-priority={top.priority} aria-hidden />
              <span className="af-label">{recommendationAreaLabel(top)}</span>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(top.id)}
              className="af-ch-os-textbtn"
            >
              Dismiss
            </button>
          </div>
          <p className="af-ch-os-card-title">{top.title}</p>
          {/* A summary that only repeats the title says nothing; it read "Recommended review" twice. */}
          {top.summary && top.summary.trim() !== top.title.trim() ? <p className="af-ch-os-card-summary">{top.summary}</p> : null}
        </div>
      ) : (
        <p className="af-ch-os-note">No commissioner action needed right now.</p>
      )}

      <div className="af-ch-os-chips">
        {urgentCount > 0 ? (
          <span className="af-ch-os-chip" data-tone="bad">
            {urgentCount} urgent
          </span>
        ) : null}
        {reviewCount > 0 ? (
          <span className="af-ch-os-chip" data-tone="warn">
            {reviewCount} review recommended
          </span>
        ) : null}
        {domainEntries.map(([domain, status]) => (
          <span
            key={domain}
            className="af-ch-os-chip"
            data-tone={status === 'ok' ? 'neutral' : 'off'}
            title={status}
          >
            {DOMAIN_LABEL[domain] ?? domain}
          </span>
        ))}
      </div>

      {copyReady.length > 0 ? <CopyReadyPanel recommendations={copyReady} onDismiss={onDismiss} /> : null}

      <p className="af-ch-os-stamp">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>
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
    <div className="af-ch-os-copy">
      <h3 className="af-label">Copy-ready content</h3>
      <div className="af-ch-os-copy-list">
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
    <div className="af-ch-os-card">
      <div className="af-ch-os-card-head">
        <p className="af-ch-os-copy-title">{recommendation.title}</p>
        <button
          type="button"
          onClick={() => onDismiss(recommendation.id)}
          className="af-ch-os-textbtn"
        >
          Dismiss
        </button>
      </div>

      {available.length > 1 ? (
        <div className="af-ch-os-chips">
          {available.map((c, i) => (
            <button
              key={c.channel}
              type="button"
              onClick={() => setChannelIndex(i)}
              className="af-ch-os-chip"
              data-tone={i === channelIndex ? 'active' : 'neutral'}
              aria-pressed={i === channelIndex}
            >
              {CHANNEL_LABEL[c.channel] ?? c.channel}
            </button>
          ))}
        </div>
      ) : (
        <p className="af-label af-ch-os-channel">
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
        className="af-ch-os-draft"
      />

      <div className="af-ch-os-card-head">
        <span className="af-ch-os-count" data-tone={overLimit ? 'bad' : undefined}>
          {draft.length}
          {active.characterLimit !== null ? ` / ${active.characterLimit}` : ''}
        </span>
        <div className="af-ch-os-head-actions">
          {copied ? <span className="af-ch-os-copied">Copied</span> : null}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(draft).then(() => setCopied(true))
            }}
            disabled={overLimit}
            className="af-btn af-ch-os-copy-btn"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}
