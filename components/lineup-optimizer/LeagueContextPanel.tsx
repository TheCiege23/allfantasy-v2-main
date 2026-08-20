'use client'

/**
 * League-context plumbing for the canonical Lineup Optimizer.
 *
 * Responsibilities (additive only — does not change optimizer engine output):
 *   1. Read optional `?leagueId=` from the URL.
 *   2. Fetch the user's leagues from `/api/league/list`.
 *   3. When a leagueId is selected, fetch real league roster +
 *      slot template + lineup-lock context from `/api/league/roster?leagueId=…`.
 *   4. Map the API payload to the optimizer's `LineupRosterPlayer` /
 *      slot-code shape SAFELY. If the shape is missing or unknown,
 *      we fall back to recommendation-only and surface a note.
 *   5. Surface a clear context banner: "Using league context" /
 *      "No league selected — recommendation mode only" / "No leagues yet" /
 *      error.
 *   6. Apply Lineup remains disabled — see StickyActionBar. This panel
 *      does NOT call `/api/leagues/[leagueId]/roster/ai-apply-lineup`.
 *
 * Hard rules respected:
 *   - No fake players are introduced (we only map real DB rows).
 *   - No hardcoded rankings.
 *   - No backend apply calls.
 *   - Demo roster button is preserved upstream.
 *   - Mobile layout: stacked, single column under sm.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { LineupRosterPlayer } from './types'

type LeagueListItem = {
  id: string
  name?: string | null
  sport?: string | null
  sport_type?: string | null
  platform?: string | null
  navigationLeagueId?: string | null
  unifiedLeagueId?: string | null
  hasUnifiedRecord?: boolean
}

type LeagueListResponse = {
  leagues?: LeagueListItem[]
  sleeperUserId?: string | null
  error?: string
}

type UnifiedRosterRow = {
  id: string
  name: string
  position?: string | null
  team?: string | null
  injuryStatus?: string | null
  projectedPoints?: number | null
  product?: { isRookie?: boolean } | null
}

type LineupLockPayload = {
  locked?: boolean
  reason?: string | null
  lockedPlayerIds?: string[]
} | null

type RosterResponse = {
  source?: string
  rosterId?: string
  roster?: unknown
  unifiedRoster?: UnifiedRosterRow[]
  sport?: string
  leagueWeek?: number
  starterSlots?: Array<{ label: string; allowedPositions?: string[] }>
  lineupLock?: LineupLockPayload
  error?: string
}

export type LeagueContextPayload = {
  leagueId: string
  leagueName: string | null
  sport: string
  leagueWeek: number | null
  roster: LineupRosterPlayer[]
  rosterSlots: string[]
  lockedPlayerIds: string[]
  lineupLocked: boolean
  lineupLockReason: string | null
  /**
   * Raw `Roster.playerData` JSON straight from the API. Required by the
   * Apply Lineup confirm modal so we can fold optimizer recommendations
   * back into the exact shape `ai-apply-lineup` expects without losing
   * IR/TAXI/DEVY context.
   */
  persistedRosterRaw: unknown
}

export type LeagueContextStatus =
  | 'idle' // no leagueId, leagues not yet loaded
  | 'no-leagues' // user has zero leagues
  | 'pick' // multiple leagues, none selected
  | 'loading-roster'
  | 'loaded' // real roster mapped
  | 'unavailable' // roster missing / shape unknown / error
  | 'unauth'

interface Props {
  leagueIdFromQuery?: string
  onApplyContext: (payload: LeagueContextPayload | null) => void
}

function mapUnifiedRoster(rows: UnifiedRosterRow[] | undefined): LineupRosterPlayer[] {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const seen = new Set<string>()
  const out: LineupRosterPlayer[] = []
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') continue
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const pos = typeof r.position === 'string' && r.position.trim() ? r.position.trim() : null
    out.push({
      id: r.id,
      name: r.name,
      positions: pos ? [pos] : [],
      projectedPoints: typeof r.projectedPoints === 'number' && Number.isFinite(r.projectedPoints) ? r.projectedPoints : 0,
      team: r.team ?? undefined,
      injuryStatus: r.injuryStatus ?? undefined,
      isRookie: r.product?.isRookie ?? undefined,
    })
  }
  return out
}

function mapStarterSlots(slots: RosterResponse['starterSlots']): string[] {
  if (!Array.isArray(slots) || slots.length === 0) return []
  return slots
    .map((s) => (typeof s?.label === 'string' && s.label.trim() ? s.label.trim() : null))
    .filter((x): x is string => Boolean(x))
}

function leagueListIsRedraftish(item: LeagueListItem): boolean {
  // Show all real, unified leagues — Apply Lineup gating happens server-side.
  return Boolean(item.id && (item.hasUnifiedRecord ?? true))
}

export function LeagueContextPanel({ leagueIdFromQuery, onApplyContext }: Props) {
  const [leagues, setLeagues] = useState<LeagueListItem[] | null>(null)
  const [leaguesError, setLeaguesError] = useState<string | null>(null)
  const [unauth, setUnauth] = useState(false)
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(
    leagueIdFromQuery && leagueIdFromQuery.trim() ? leagueIdFromQuery.trim() : null,
  )
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [activePayload, setActivePayload] = useState<LeagueContextPayload | null>(null)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)

  // Sync incoming query param changes (browser back/forward, link nav).
  useEffect(() => {
    const next = leagueIdFromQuery && leagueIdFromQuery.trim() ? leagueIdFromQuery.trim() : null
    setSelectedLeagueId((prev) => (prev === next ? prev : next))
  }, [leagueIdFromQuery])

  // Load the user's leagues once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/league/list', { cache: 'no-store' })
        if (res.status === 401) {
          if (!cancelled) {
            setUnauth(true)
            setLeagues([])
          }
          return
        }
        const data = (await res.json()) as LeagueListResponse
        if (cancelled) return
        if (!res.ok) {
          setLeaguesError(data?.error || 'Failed to load leagues')
          setLeagues([])
          return
        }
        const list = Array.isArray(data?.leagues) ? data.leagues.filter(leagueListIsRedraftish) : []
        setLeagues(list)
      } catch (e) {
        if (!cancelled) {
          setLeaguesError(e instanceof Error ? e.message : 'Failed to load leagues')
          setLeagues([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // If query param missing AND user has exactly one league, auto-select it.
  useEffect(() => {
    if (selectedLeagueId) return
    if (!leagues || leagues.length !== 1) return
    setSelectedLeagueId(leagues[0]!.id)
  }, [leagues, selectedLeagueId])

  // Fetch league-scoped roster whenever the selection changes.
  useEffect(() => {
    if (!selectedLeagueId) {
      setActivePayload(null)
      setRosterError(null)
      setUnavailableReason(null)
      onApplyContext(null)
      return
    }
    let cancelled = false
    setRosterLoading(true)
    setRosterError(null)
    setUnavailableReason(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/league/roster?leagueId=${encodeURIComponent(selectedLeagueId)}`,
          { cache: 'no-store' },
        )
        if (res.status === 401) {
          if (!cancelled) {
            setUnauth(true)
            setRosterLoading(false)
          }
          return
        }
        const data = (await res.json()) as RosterResponse
        if (cancelled) return
        if (!res.ok) {
          setUnavailableReason(data?.error || `Roster request failed (${res.status})`)
          setActivePayload(null)
          onApplyContext(null)
          setRosterLoading(false)
          return
        }

        const mappedRoster = mapUnifiedRoster(data.unifiedRoster)
        const mappedSlots = mapStarterSlots(data.starterSlots)

        if (mappedRoster.length === 0) {
          setUnavailableReason(
            'League roster is empty or in an unrecognized shape — running in recommendation-only mode.',
          )
          setActivePayload(null)
          onApplyContext(null)
          setRosterLoading(false)
          return
        }

        const leagueMeta = leagues?.find((l) => l.id === selectedLeagueId) ?? null
        const payload: LeagueContextPayload = {
          leagueId: selectedLeagueId,
          leagueName: leagueMeta?.name ?? null,
          sport: (data.sport || leagueMeta?.sport || leagueMeta?.sport_type || 'NFL').toUpperCase(),
          leagueWeek: typeof data.leagueWeek === 'number' ? data.leagueWeek : null,
          roster: mappedRoster,
          rosterSlots: mappedSlots,
          lockedPlayerIds: Array.isArray(data.lineupLock?.lockedPlayerIds)
            ? data.lineupLock!.lockedPlayerIds!
            : [],
          lineupLocked: Boolean(data.lineupLock?.locked),
          lineupLockReason: data.lineupLock?.reason ?? null,
          persistedRosterRaw: data.roster,
        }
        setActivePayload(payload)
        onApplyContext(payload)
        setRosterLoading(false)
      } catch (e) {
        if (!cancelled) {
          setRosterError(e instanceof Error ? e.message : 'Failed to load league roster')
          setActivePayload(null)
          onApplyContext(null)
          setRosterLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // We intentionally exclude `onApplyContext` and `leagues` from deps —
    // re-fetching on parent re-render would cause loops. League name is
    // best-effort metadata only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLeagueId])

  const status: LeagueContextStatus = useMemo(() => {
    if (unauth) return 'unauth'
    if (rosterLoading) return 'loading-roster'
    if (selectedLeagueId && unavailableReason) return 'unavailable'
    if (selectedLeagueId && activePayload) return 'loaded'
    if (leagues && leagues.length === 0) return 'no-leagues'
    if (leagues && leagues.length > 0 && !selectedLeagueId) return 'pick'
    return 'idle'
  }, [unauth, rosterLoading, selectedLeagueId, unavailableReason, activePayload, leagues])

  const handleSelect = useCallback((id: string) => {
    setSelectedLeagueId(id || null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (id) url.searchParams.set('leagueId', id)
      else url.searchParams.delete('leagueId')
      window.history.replaceState({}, '', url.toString())
    }
  }, [])

  const banner = useMemo(() => {
    switch (status) {
      case 'loaded':
        return {
          tone: 'good' as const,
          title: 'Using league context',
          body: activePayload
            ? `${activePayload.leagueName ?? 'Selected league'} • ${activePayload.sport}${activePayload.leagueWeek ? ` • Week ${activePayload.leagueWeek}` : ''} • ${activePayload.roster.length} roster spots`
            : 'Real league roster loaded.',
        }
      case 'loading-roster':
        return { tone: 'info' as const, title: 'Loading league roster…', body: 'Fetching real roster, slots, and lock status.' }
      case 'pick':
        return {
          tone: 'warn' as const,
          title: 'No league selected — recommendation mode only',
          body: 'Pick a league below to load your real roster, scoring, and starting slots.',
        }
      case 'no-leagues':
        return {
          tone: 'warn' as const,
          title: 'No leagues yet',
          body: 'Create or import a league to use real league context. The optimizer still works with the demo roster.',
        }
      case 'unavailable':
        return {
          tone: 'warn' as const,
          title: 'League context unavailable — recommendation mode only',
          body: unavailableReason ?? 'Could not map this league\'s roster shape safely.',
        }
      case 'unauth':
        return {
          tone: 'warn' as const,
          title: 'Sign in to use league context',
          body: 'The optimizer still works with the demo roster while signed out.',
        }
      case 'idle':
      default:
        return { tone: 'info' as const, title: 'Loading leagues…', body: 'Checking for connected leagues.' }
    }
  }, [status, activePayload, unavailableReason])

  const toneClass: Record<'good' | 'warn' | 'info', string> = {
    good: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100',
    warn: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
    info: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
  }

  return (
    <section
      aria-label="Lineup Optimizer league context"
      className="mb-3 rounded-2xl border border-white/10 bg-black/25 p-3 sm:p-4"
      data-testid="lineup-optimizer-league-context"
      data-context-status={status}
    >
      <div
        className={`rounded-xl border px-3 py-2 text-xs sm:text-sm ${toneClass[banner.tone]}`}
        data-testid="lineup-optimizer-context-banner"
      >
        <p className="font-semibold">{banner.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/75 sm:text-xs">{banner.body}</p>
        {leaguesError ? (
          <p className="mt-1 text-[11px] text-red-200/85">League list error: {leaguesError}</p>
        ) : null}
        {rosterError ? (
          <p className="mt-1 text-[11px] text-red-200/85">Roster error: {rosterError}</p>
        ) : null}
      </div>

      {leagues && leagues.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-white/55 sm:flex-row sm:items-center sm:gap-2">
            <span>League</span>
            <select
              value={selectedLeagueId ?? ''}
              onChange={(e) => handleSelect(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-[#0a1228] px-2 py-1.5 text-sm text-white/90 sm:w-auto"
              data-testid="lineup-optimizer-league-selector"
            >
              <option value="">— Recommendation only —</option>
              {leagues.map((lg) => (
                <option key={lg.id} value={lg.id}>
                  {(lg.name ?? 'Untitled league').slice(0, 60)}
                  {lg.sport ? ` · ${lg.sport}` : ''}
                </option>
              ))}
            </select>
          </label>
          {status === 'loaded' && activePayload?.lineupLocked ? (
            <p
              className="text-[11px] text-amber-200/90"
              data-testid="lineup-optimizer-lock-warning"
            >
              Lineup is locked: {activePayload.lineupLockReason ?? 'Roster moves are restricted.'} Apply lineup will stay disabled.
            </p>
          ) : null}
        </div>
      ) : null}

      {status === 'no-leagues' ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link
            href="/leagues/create"
            className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 font-semibold text-cyan-100 hover:bg-cyan-500/20"
            data-testid="lineup-optimizer-cta-create"
          >
            Create a league
          </Link>
          <Link
            href="/dashboard?tab=import"
            className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 font-semibold text-white/80 hover:bg-white/10"
            data-testid="lineup-optimizer-cta-import"
          >
            Import from Sleeper
          </Link>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
        Apply Lineup remains disabled — recommendations only.
      </p>
    </section>
  )
}
