'use client'

/**
 * Phase 3B → 3B.2 — Dashboard Intelligence Rail.
 *
 * Flag-gated client component (NEXT_PUBLIC_CHIMMY_INTELLIGENCE_RAIL=1).
 * Renders Chimmy intelligence as severity-hierarchic, grouped, expandable
 * cards plus an optional debug panel.
 *
 * Behavior:
 *  - One-shot fetch on mount.
 *  - Manual refresh (forceRefresh=1), 5s click debounce.
 *  - Skeleton on first load.
 *  - Last-good cards preserved on refresh failure.
 *  - No polling. Never blocks dashboard paint.
 *  - Critical cards auto-expanded; info/low cards compacted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  DashboardIntelligenceCard,
  DashboardSeverity,
} from '@/lib/chimmy-context/dashboard/contracts'
import { sortDashboardIntelligenceCards } from '@/lib/chimmy-context/dashboard/ordering'
import {
  groupIntelligenceCards,
  type IntelligenceGroup,
} from '@/lib/chimmy-context/dashboard/grouping'
import type { IntelligenceContextSlice } from '@/lib/chimmy-context/types'
import {
  decideInvalidation,
  onIntelligenceInvalidate,
  type IntelligenceInvalidateDetail,
} from '@/lib/dashboard/intelligence-events'
import {
  DashboardIntelligenceDebugPanel,
  type DebugCanaryMeta,
  type DebugForceRefreshMeta,
  type DebugProviderMeta,
} from './DashboardIntelligenceDebugPanel'
import { Skeleton as UISkeleton } from '@/components/ui/skeleton'

type IntelligenceApiResponse = {
  ok?: boolean
  generatedAt?: string
  intelligence?: IntelligenceContextSlice | null
  cards?: DashboardIntelligenceCard[]
  meta?: {
    durationMs?: number
    providers?: DebugProviderMeta[]
    canary?: DebugCanaryMeta
    forceRefresh?: DebugForceRefreshMeta
  }
}

type RailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready'
      cards: DashboardIntelligenceCard[]
      intelligence: IntelligenceContextSlice | null
      generatedAt: string
      meta: {
        durationMs: number | null
        providers: DebugProviderMeta[]
        canary: DebugCanaryMeta | null
        forceRefresh: DebugForceRefreshMeta | null
      }
    }
  | { status: 'error'; message: string }

const FLAG_ENABLED = process.env.NEXT_PUBLIC_CHIMMY_INTELLIGENCE_RAIL === '1'
/** Phase 5 — internal QA UI (thumbs/dismiss + extra debug meta) gate. */
const INTERNAL_QA_ENABLED = process.env.NEXT_PUBLIC_CHIMMY_INTELLIGENCE_QA === '1'
const REFRESH_DEBOUNCE_MS = 5_000
/** Treat per-league cached payloads younger than this as instant-display. */
const LEAGUE_CACHE_FRESH_MS = 60_000
/** Cap on number of distinct league payloads held in memory. */
const LEAGUE_CACHE_MAX_ENTRIES = 6
/** Coalesce window for reactive invalidation events so bursty writes
 *  (lineup save + roster change + matchup tick) trigger a single refresh. */
const REACTIVE_COALESCE_MS = 750

type LeagueAwareProps = {
  /** Active league id from `useDashboardToolLeague`. Null = user-global intelligence. */
  leagueId?: string | null
  /** Optional human label shown in header. */
  leagueName?: string | null
  /** Optional sport label (NFL / NBA / …). */
  leagueSport?: string | null
  /** Optional league type (redraft / dynasty / keeper / …). */
  leagueType?: string | null
}

type CachedPayload = {
  cards: DashboardIntelligenceCard[]
  intelligence: IntelligenceContextSlice | null
  generatedAt: string
  meta: {
    durationMs: number | null
    providers: DebugProviderMeta[]
    canary: DebugCanaryMeta | null
    forceRefresh: DebugForceRefreshMeta | null
  }
  cachedAt: number
}

function cacheKey(leagueId: string | null | undefined): string {
  return leagueId && leagueId.length > 0 ? `league:${leagueId}` : '__user__'
}

// ─── Severity → visual hierarchy ────────────────────────────────────────────

type SeverityTier = DashboardSeverity

function tierContainerClasses(tier: SeverityTier): string {
  switch (tier) {
    case 'critical':
      return 'border-rose-500/60 bg-rose-500/10 text-rose-100 shadow-[0_0_24px_-12px_rgba(244,63,94,0.6)]'
    case 'high':
      return 'border-orange-500/50 bg-orange-500/10 text-orange-100 shadow-[0_0_16px_-12px_rgba(249,115,22,0.55)]'
    case 'moderate':
      return 'border-amber-400/45 bg-amber-400/10 text-amber-100'
    case 'low':
      return 'border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-100'
    default:
      return 'border-white/10 bg-white/[0.04] text-white/85'
  }
}

function tierPaddingClasses(tier: SeverityTier): string {
  switch (tier) {
    case 'critical':
    case 'high':
      return 'px-3.5 py-3'
    case 'moderate':
      return 'px-3 py-2.5'
    case 'low':
    case 'info':
    default:
      return 'px-3 py-2'
  }
}

function tierBadgeClasses(tier: SeverityTier): string {
  switch (tier) {
    case 'critical':
      return 'bg-rose-500/25 text-rose-50'
    case 'high':
      return 'bg-orange-500/25 text-orange-50'
    case 'moderate':
      return 'bg-amber-500/25 text-amber-50'
    case 'low':
      return 'bg-emerald-500/20 text-emerald-50'
    default:
      return 'bg-white/[0.08] text-white/60'
  }
}

function tierCtaClasses(tier: SeverityTier): string {
  switch (tier) {
    case 'critical':
    case 'high':
      return 'border-rose-400/50 text-rose-100 hover:bg-rose-500/15'
    case 'moderate':
      return 'border-amber-400/45 text-amber-100 hover:bg-amber-500/15'
    case 'low':
    default:
      return 'border-emerald-400/35 text-emerald-100 hover:bg-emerald-500/15'
  }
}

function isExpandableTier(tier: SeverityTier): boolean {
  return tier !== 'info'
}

function whyThisMatters(card: DashboardIntelligenceCard): string | null {
  switch (card.id) {
    case 'urgency':
      return 'Driven by lineup, schedule, and waiver decisions due before kickoff.'
    case 'top_risks':
      return 'Composite of roster, injury, volatility, playoff, matchup, and structural signals.'
    case 'coaching':
      return 'Adaptive recommendations weighted by recent behavior and matchup posture.'
    case 'playoff_outlook':
      return 'Projection of seeding and clinching scenarios based on current standings.'
    case 'roster_outlook':
      return 'Forward-looking roster strength relative to your remaining schedule.'
    case 'team_identity':
      return 'How your roster construction biases strategy decisions.'
    case 'competitive_context':
      return 'Where you stand relative to the rest of the league this week.'
    default:
      return null
  }
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <p className="text-[11px] font-semibold text-white/55">
        Checking grounded league signals...
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <UISkeleton
            key={i}
            className="h-[68px] rounded-xl"
            style={{ animationDelay: `${i * 100}ms` }}
            aria-hidden
          />
        ))}
      </div>
    </div>
  )
}

function CardTile({
  card,
  expanded,
  onToggle,
  onFeedback,
  recentFeedback,
  cardIndex,
}: {
  card: DashboardIntelligenceCard
  expanded: boolean
  onToggle: () => void
  onFeedback?: (
    eventType: 'thumbs_up' | 'thumbs_down' | 'dismiss',
    reason?: 'not_useful' | 'incorrect' | 'too_repetitive'
  ) => void
  /** Phase 6A — transient ack shown for ~1.5s after a QA action. */
  recentFeedback?: 'thumbs_up' | 'thumbs_down' | 'dismiss' | null
  cardIndex?: number
}) {
  const tier = card.severity
  const why = whyThisMatters(card)
  const expandable = isExpandableTier(tier) && (card.bullets.length > 0 || why !== null)
  const compact = tier === 'low' || tier === 'info'

  return (
    <div
      className={cn(`rounded-xl border ${tierContainerClasses(tier)} ${tierPaddingClasses(tier)}`, 'animate-[stagger-in_200ms_ease-out_both]')}
      style={{ animationDelay: `${Math.min(cardIndex ?? 0, 5) * 80}ms` }}
      data-card-id={card.id}
      data-severity={card.severity}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${tierBadgeClasses(
                tier
              )}`}
            >
              {card.severity}
            </span>
            <p className="truncate text-[10px] uppercase tracking-[0.08em] opacity-70">
              {card.title}
            </p>
          </div>
          {card.headline ? (
            <p
              className={`mt-1 font-semibold leading-snug ${
                compact ? 'text-[13px]' : 'text-sm'
              }`}
            >
              {card.headline}
            </p>
          ) : (
            <p className="mt-1 text-sm font-semibold leading-snug opacity-60">—</p>
          )}
        </div>
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            className="shrink-0 rounded-md border border-white/10 p-1 text-white/60 hover:bg-white/[0.06]"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded ? 'rotate-180' : '')} />
          </button>
        ) : null}
      </div>

      {expandable ? (
        <div className={cn('overflow-hidden transition-[max-height,opacity] duration-200 ease-out', expanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0')}>
          <div className="mt-2 space-y-1.5 border-t border-white/10 pt-2">
          {why ? <p className="text-[11px] italic opacity-75">{why}</p> : null}
          {card.bullets.length > 0 ? (
            <ul className="space-y-0.5 text-[11px] opacity-85">
              {card.bullets.slice(0, 4).map((b, i) => (
                <li key={i} className="leading-snug">
                  • {b}
                </li>
              ))}
            </ul>
          ) : null}
          {card.ctaHref && card.ctaLabel ? (
            <Link
              href={card.ctaHref}
              className={`mt-1.5 inline-flex items-center rounded border px-2 py-1 text-[10px] font-semibold transition ${tierCtaClasses(tier)}`}
            >
              {card.ctaLabel} →
            </Link>
          ) : null}
          {onFeedback ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2"
              data-testid="intelligence-card-qa"
            >
              <span className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan-100/45">
                Admin feedback
              </span>
              {recentFeedback ? (
                <span
                  className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-200"
                  data-testid="intelligence-card-qa-ack"
                  role="status"
                  aria-live="polite"
                >
                  thanks — {recentFeedback.replace('_', ' ')}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onFeedback('thumbs_up')}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/65 hover:border-cyan-300/25 hover:bg-cyan-300/[0.08]"
                aria-label="Helpful"
              >
                up
              </button>
              <button
                type="button"
                onClick={() => onFeedback('thumbs_down', 'not_useful')}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/65 hover:border-cyan-300/25 hover:bg-cyan-300/[0.08]"
                aria-label="Not useful"
              >
                down
              </button>
              <button
                type="button"
                onClick={() => onFeedback('thumbs_down', 'incorrect')}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/65 hover:border-amber-300/25 hover:bg-amber-300/[0.08]"
                aria-label="Incorrect"
              >
                incorrect
              </button>
              <button
                type="button"
                onClick={() => onFeedback('thumbs_down', 'too_repetitive')}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/65 hover:border-amber-300/25 hover:bg-amber-300/[0.08]"
                aria-label="Repetitive"
              >
                repetitive
              </button>
              <button
                type="button"
                onClick={() => onFeedback('dismiss')}
                className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-white/45 hover:border-rose-300/25 hover:bg-rose-500/[0.08] hover:text-rose-100"
                aria-label="Dismiss"
              >
                dismiss
              </button>
            </div>
          ) : null}
        </div>
        </div>
      ) : null}
    </div>
  )
}

function GroupSection({
  group,
  expandedIds,
  onToggle,
  onFeedback,
  recentFeedbackByCard,
}: {
  group: IntelligenceGroup
  expandedIds: Set<string>
  onToggle: (cardId: string) => void
  onFeedback?: (
    cardId: string,
    eventType: 'thumbs_up' | 'thumbs_down' | 'dismiss',
    severity: DashboardSeverity,
    reason?: 'not_useful' | 'incorrect' | 'too_repetitive'
  ) => void
  recentFeedbackByCard?: Record<string, 'thumbs_up' | 'thumbs_down' | 'dismiss' | null>
}) {
  return (
    <div className="space-y-1.5" data-group-id={group.id}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
        {group.title}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {group.cards.map((card, i) => (
          <CardTile
            key={card.id}
            card={card}
            cardIndex={i}
            expanded={expandedIds.has(card.id)}
            onToggle={() => onToggle(card.id)}
            recentFeedback={recentFeedbackByCard?.[card.id] ?? null}
            onFeedback={
              onFeedback
                ? (eventType, reason) =>
                    onFeedback(card.id, eventType, card.severity, reason)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

function formatRelativeAge(generatedAt: string | null | undefined, nowMs: number): string {
  if (!generatedAt) return ''
  const t = Date.parse(generatedAt)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, nowMs - t)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

// ─── Rail ───────────────────────────────────────────────────────────────────

export function DashboardIntelligenceRail(props: LeagueAwareProps = {}) {
  if (!FLAG_ENABLED) return null
  return (
    <DashboardIntelligenceRailInner
      leagueId={props.leagueId ?? null}
      leagueName={props.leagueName ?? null}
      leagueSport={props.leagueSport ?? null}
      leagueType={props.leagueType ?? null}
    />
  )
}

function DashboardIntelligenceRailInner({
  leagueId,
  leagueName,
  leagueSport,
  leagueType,
}: Required<LeagueAwareProps>) {
  const [state, setState] = useState<RailState>({ status: 'idle' })
  const lastFetchRef = useRef<number>(0)
  const inFlightRef = useRef<AbortController | null>(null)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  /** In-memory per-league cache (keyed by leagueId or '__user__'). Cap ~6 entries. */
  const cacheRef = useRef<Map<string, CachedPayload>>(new Map())
  /** Tracks the league scope of the currently-displayed `state.ready` payload. */
  const displayedScopeRef = useRef<string | null>(null)
  /** True while a soft (reactive) refresh is in-flight on the visible scope. */
  const [softRefreshing, setSoftRefreshing] = useState(false)
  /** Coalesce timer for reactive invalidation bursts. */
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Phase 5 — operational diagnostics (debug panel only). */
  const [lastRefreshReason, setLastRefreshReason] = useState<string | null>('initial')
  const [invalidationSource, setInvalidationSource] = useState<string | null>(null)
  const [cacheStatus, setCacheStatus] = useState<'hit' | 'miss' | 'stale' | null>(null)
  /** Phase 6A — session-scoped QA: dismissed card ids (cleared on tab close). */
  const [dismissedCardIds, setDismissedCardIds] = useState<Set<string>>(() => new Set())
  /** Phase 6A — transient ack map: card.id → 'thumbs_up' | 'thumbs_down' | 'dismiss'. */
  const [recentFeedbackByCard, setRecentFeedbackByCard] = useState<
    Record<string, 'thumbs_up' | 'thumbs_down' | 'dismiss' | null>
  >({})
  const ackTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  /** Phase 6A — rolling per-tab invalidation counter (debug surface only). */
  const invalidationCountRef = useRef<{ count: number; windowStartedAt: number }>({
    count: 0,
    windowStartedAt: Date.now(),
  })

  const applyPayload = useCallback((scope: string, payload: CachedPayload) => {
    displayedScopeRef.current = scope
    setState({
      status: 'ready',
      cards: payload.cards,
      intelligence: payload.intelligence,
      generatedAt: payload.generatedAt,
      meta: payload.meta,
    })
  }, [])

  const fetchIntelligence = useCallback(
    async (force: boolean, scopeLeagueId: string | null) => {
      const now = Date.now()
      if (force && now - lastFetchRef.current < REFRESH_DEBOUNCE_MS) return
      lastFetchRef.current = now

      const scope = cacheKey(scopeLeagueId)
      const sameScopeReady =
        displayedScopeRef.current === scope

      if (inFlightRef.current) inFlightRef.current.abort()
      const ctl = new AbortController()
      inFlightRef.current = ctl

      // Preserve last-good cards only when same scope; otherwise show skeleton.
      setState((prev) => {
        if (prev.status === 'ready' && sameScopeReady) return prev
        return { status: 'loading' }
      })
      if (sameScopeReady) setSoftRefreshing(true)

      try {
        const params = new URLSearchParams()
        if (scopeLeagueId) params.set('leagueId', scopeLeagueId)
        if (force) params.set('forceRefresh', '1')
        const qs = params.toString()
        const res = await fetch(`/api/ai/intelligence${qs ? `?${qs}` : ''}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctl.signal,
        })
        if (!res.ok) throw new Error(`http_${res.status}`)
        const payload = (await res.json()) as IntelligenceApiResponse
        const cards = Array.isArray(payload.cards) ? payload.cards : []
        const providers = Array.isArray(payload.meta?.providers)
          ? payload.meta!.providers!
          : []
        const cached: CachedPayload = {
          cards,
          intelligence: payload.intelligence ?? null,
          generatedAt: payload.generatedAt ?? new Date().toISOString(),
          meta: {
            durationMs:
              typeof payload.meta?.durationMs === 'number'
                ? payload.meta.durationMs
                : null,
            providers,
            canary: payload.meta?.canary ?? null,
            forceRefresh: payload.meta?.forceRefresh ?? null,
          },
          cachedAt: Date.now(),
        }

        // LRU-ish bookkeeping (re-insert moves to most-recent end).
        const cache = cacheRef.current
        if (cache.has(scope)) cache.delete(scope)
        cache.set(scope, cached)
        while (cache.size > LEAGUE_CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value
          if (typeof oldest === 'string') cache.delete(oldest)
          else break
        }

        applyPayload(scope, cached)
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') return
        setState((prev) =>
          prev.status === 'ready'
            ? prev
            : { status: 'error', message: 'intelligence_unavailable' }
        )
      } finally {
        if (inFlightRef.current === ctl) inFlightRef.current = null
        setSoftRefreshing(false)
      }
    },
    [applyPayload]
  )

  // Initial + league-scope-change fetch. Cache hit → instant display; revalidate in background
  // when the cache entry is older than LEAGUE_CACHE_FRESH_MS.
  useEffect(() => {
    const scope = cacheKey(leagueId)
    const cached = cacheRef.current.get(scope)
    if (cached) {
      applyPayload(scope, cached)
      const ageMs = Date.now() - cached.cachedAt
      if (ageMs <= LEAGUE_CACHE_FRESH_MS) {
        setCacheStatus('hit')
        setLastRefreshReason('cache_hit')
        return
      }
      setCacheStatus('stale')
      setLastRefreshReason('stale_revalidate')
      void fetchIntelligence(false, leagueId)
      return
    }
    setCacheStatus('miss')
    setLastRefreshReason('initial')
    void fetchIntelligence(false, leagueId)
    return () => {
      inFlightRef.current?.abort()
      inFlightRef.current = null
    }
  }, [leagueId, fetchIntelligence, applyPayload])

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Reactive invalidation: subscribe to `af-intelligence-invalidate` events.
  // Coalesce bursts so e.g. lineup-save + roster-change + matchup-tick fire one refresh.
  useEffect(() => {
    const unsub = onIntelligenceInvalidate((detail: IntelligenceInvalidateDetail) => {
      const decision = decideInvalidation(detail, leagueId)
      const targetScope = cacheKey(detail.leagueId ?? null)
      // Always drop the matching cache entry so the next read is fresh.
      cacheRef.current.delete(targetScope)
      // If event is global, also drop every entry.
      if ((detail.leagueId ?? null) === null) cacheRef.current.clear()
      setInvalidationSource(detail.reason ?? 'unknown')
      // Phase 6A — surface a rolling 60s invalidation count to the debug panel.
      const nowTs = Date.now()
      const w = invalidationCountRef.current
      if (nowTs - w.windowStartedAt > 60_000) {
        w.count = 1
        w.windowStartedAt = nowTs
      } else {
        w.count += 1
      }
      if (decision !== 'refresh') return
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
      coalesceTimerRef.current = setTimeout(() => {
        coalesceTimerRef.current = null
        // Bypass the manual-refresh 5s debounce: this is an external signal.
        lastFetchRef.current = 0
        setLastRefreshReason('invalidation')
        setCacheStatus('miss')
        void fetchIntelligence(false, leagueId)
      }, REACTIVE_COALESCE_MS)
    })
    return () => {
      unsub()
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current)
        coalesceTimerRef.current = null
      }
    }
  }, [leagueId, fetchIntelligence])

  const orderedCards = useMemo(() => {
    if (state.status !== 'ready') return [] as DashboardIntelligenceCard[]
    return sortDashboardIntelligenceCards(state.cards, state.intelligence)
  }, [state])

  const groups = useMemo<IntelligenceGroup[]>(
    () => groupIntelligenceCards(orderedCards),
    [orderedCards]
  )

  // Auto-expand critical cards on first appearance; user toggles override after.
  useEffect(() => {
    if (state.status !== 'ready') return
    setExpandedIds((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const c of orderedCards) {
        if (c.severity === 'critical' && !next.has(c.id)) {
          next.add(c.id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [state.status, orderedCards])

  const toggle = useCallback((cardId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      const willExpand = !next.has(cardId)
      if (willExpand) next.add(cardId)
      else next.delete(cardId)
      // Phase 6A — fire interaction telemetry (internal-only; endpoint no-ops otherwise).
      if (INTERNAL_QA_ENABLED) {
        try {
          void fetch('/api/ai/intelligence/feedback', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventType: willExpand ? 'expand' : 'collapse',
              cardId,
              leagueId,
              surface: 'rail',
            }),
          }).catch(() => {})
        } catch {
          /* swallow */
        }
      }
      return next
    })
  }, [leagueId])

  // Phase 5 — internal QA feedback POST. Fire-and-forget, never blocks UI.
  // Endpoint silently no-ops for non-internal callers.
  const cohortLabelForFeedback =
    state.status === 'ready' ? state.meta.canary?.cohortLabel ?? null : null
  const postFeedback = useCallback(
    (
      cardId: string,
      eventType: 'thumbs_up' | 'thumbs_down' | 'dismiss',
      severity: DashboardSeverity,
      reason?: 'not_useful' | 'incorrect' | 'too_repetitive'
    ) => {
      if (!INTERNAL_QA_ENABLED) return
      // Phase 6A — session-scoped dismiss (hides card until tab close).
      if (eventType === 'dismiss') {
        setDismissedCardIds((prev) => {
          if (prev.has(cardId)) return prev
          const next = new Set(prev)
          next.add(cardId)
          return next
        })
      }
      // Phase 6A — transient ack, auto-clears after ~1.5s.
      setRecentFeedbackByCard((prev) => ({ ...prev, [cardId]: eventType }))
      const existingTimer = ackTimerRef.current.get(cardId)
      if (existingTimer) clearTimeout(existingTimer)
      const t = setTimeout(() => {
        setRecentFeedbackByCard((prev) =>
          prev[cardId] ? { ...prev, [cardId]: null } : prev
        )
        ackTimerRef.current.delete(cardId)
      }, 1500)
      ackTimerRef.current.set(cardId, t)
      try {
        void fetch('/api/ai/intelligence/feedback', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType,
            cardId,
            severity,
            reason,
            leagueId,
            cohortLabel: cohortLabelForFeedback,
            surface: 'rail',
          }),
        }).catch(() => {
          /* swallow — never let QA UI break the rail */
        })
      } catch {
        /* swallow */
      }
    },
    [leagueId, cohortLabelForFeedback]
  )

  // Phase 6A — cleanup ack timers on unmount.
  useEffect(() => {
    const timers = ackTimerRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

  const generatedAt = state.status === 'ready' ? state.generatedAt : null
  const ageLabel = useMemo(() => formatRelativeAge(generatedAt, nowMs), [generatedAt, nowMs])

  if (state.status === 'ready' && groups.length === 0) return null

  const debugProviders = state.status === 'ready' ? state.meta.providers : []
  const debugCanary = state.status === 'ready' ? state.meta.canary : null
  const debugDurationMs = state.status === 'ready' ? state.meta.durationMs : null
  const debugForceRefresh =
    state.status === 'ready' ? state.meta.forceRefresh : null

  // Pressure tier hook — future Sunday-mode can switch refresh cadence on this.
  const pressureTier: 'high' | 'normal' =
    state.status === 'ready' && orderedCards.some((c) => c.severity === 'critical')
      ? 'high'
      : 'normal'

  return (
    <section
      className="overflow-hidden rounded-2xl border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_38%),linear-gradient(135deg,#07101f,#07091b)] p-4 shadow-[0_18px_52px_-40px_rgba(34,211,238,0.85)]"
      data-testid="dashboard-intelligence-rail"
      data-pressure={pressureTier}
      data-soft-refreshing={softRefreshing ? '1' : '0'}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100/78">
            Chimmy Intelligence
          </p>
          {leagueId && leagueName ? (
            <p className="mt-0.5 truncate text-[11px] text-white/60" title={leagueName}>
              {leagueName}
              {leagueSport || leagueType ? (
                <span className="ml-1.5 text-[10px] uppercase tracking-[0.06em] text-white/35">
                  {[leagueSport, leagueType].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </p>
          ) : !leagueId ? (
            <p className="mt-0.5 text-[10px] uppercase tracking-[0.06em] text-white/35">
              All leagues
            </p>
          ) : null}
          {ageLabel ? (
            <p className={cn('mt-0.5 text-[10px]', generatedAt && Date.now() - Date.parse(generatedAt) > 300_000 ? 'text-amber-300' : 'text-white/40')}>
              Updated {ageLabel}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setLastRefreshReason('manual')
            setCacheStatus('miss')
            // Phase 6A — interaction telemetry (internal-only).
            if (INTERNAL_QA_ENABLED) {
              try {
                void fetch('/api/ai/intelligence/feedback', {
                  method: 'POST',
                  credentials: 'same-origin',
                  cache: 'no-store',
                  keepalive: true,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    eventType: 'manual_refresh',
                    leagueId,
                    cohortLabel: cohortLabelForFeedback,
                    surface: 'rail',
                  }),
                }).catch(() => {})
              } catch {
                /* swallow */
              }
            }
            void fetchIntelligence(true, leagueId)
          }}
          disabled={state.status === 'loading'}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-1 text-[11px] font-bold text-cyan-50/78 hover:border-cyan-300/35 hover:bg-cyan-300/[0.10] disabled:opacity-50"
        >
          {softRefreshing && state.status === 'ready' ? (
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/80"
              aria-hidden
            />
          ) : null}
          {state.status === 'loading'
            ? 'Refreshing...'
            : softRefreshing
            ? 'Updating'
            : 'Refresh'}
        </button>
      </div>

      {state.status === 'loading' || state.status === 'idle' ? <Skeleton /> : null}

      {state.status === 'ready' && groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((g) => {
            const filteredGroup: IntelligenceGroup = {
              ...g,
              cards: g.cards.filter((c) => !dismissedCardIds.has(c.id)),
            }
            if (filteredGroup.cards.length === 0) return null
            return (
              <GroupSection
                key={g.id}
                group={filteredGroup}
                onFeedback={INTERNAL_QA_ENABLED ? postFeedback : undefined}
                recentFeedbackByCard={
                  INTERNAL_QA_ENABLED ? recentFeedbackByCard : undefined
                }
                expandedIds={expandedIds}
                onToggle={toggle}
              />
            )
          })}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <p className="text-[12px] text-white/50">
          Intelligence temporarily unavailable. No new card is shown without grounded data.
        </p>
      ) : null}

      <DashboardIntelligenceDebugPanel
        durationMs={debugDurationMs}
        canary={debugCanary}
        providers={debugProviders}
        cards={state.status === 'ready' ? orderedCards : []}
        forceRefresh={debugForceRefresh}
        cacheStatus={cacheStatus}
        lastRefreshReason={lastRefreshReason}
        invalidationSource={invalidationSource}
        recentInvalidationCount={invalidationCountRef.current.count}
        generatedAt={generatedAt}
      />
    </section>
  )
}

export default DashboardIntelligenceRail
