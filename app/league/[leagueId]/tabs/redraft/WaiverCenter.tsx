'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Loader2, TrendingUp, Zap } from 'lucide-react'
import { ProjectionChip } from '@/components/sports/ProjectionCard'
import { PlayerAvatar } from '@/components/app/draft-room/PlayerAvatar'
import {
  fetchRedraftWaiverClaims,
  fetchRedraftWaiverRuntime,
  type RedraftWaiverClaimClient,
  type RedraftWaiverRuntimeClient,
} from '@/lib/redraft/client'

type WaiverTarget = {
  name: string
  position: string
  team: string
  priority: number
  reason: string
  projectedPoints?: number
  /** Optional player headshot — falls back to silhouette+initials when missing. */
  headshotUrl?: string | null
  teamLogoUrl?: string | null
}

export function WaiverCenter({
  seasonId,
  leagueId,
  rosterId,
  sport,
}: {
  seasonId: string | null
  leagueId?: string
  rosterId?: string | null
  sport?: string
}) {
  const [targets, setTargets] = useState<WaiverTarget[]>([])
  const [claims, setClaims] = useState<RedraftWaiverClaimClient[]>([])
  const [runtime, setRuntime] = useState<RedraftWaiverRuntimeClient | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!seasonId || !rosterId) {
      setClaims([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [rows, waiverRuntime] = await Promise.all([
          fetchRedraftWaiverClaims(seasonId, rosterId),
          leagueId
            ? fetchRedraftWaiverRuntime({
                leagueId,
                seasonId,
                rosterId,
                includeFreeAgents: false,
              }).catch(() => null)
            : Promise.resolve(null),
        ])
        if (!cancelled) {
          setClaims(rows)
          setRuntime(waiverRuntime)
        }
      } catch {
        if (!cancelled) {
          setClaims([])
          setRuntime(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId, seasonId, rosterId])

  async function fetchSuggestions() {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/waiver-ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.error ?? 'Failed to load suggestions')
        return
      }
      const data = await res.json()
      const picks = Array.isArray(data?.suggestions) ? data.suggestions
        : Array.isArray(data?.picks) ? data.picks
        : Array.isArray(data?.targets) ? data.targets : []
      setTargets(picks.map((p: any, i: number) => ({
        name: p.playerName ?? p.name ?? p.player ?? '',
        position: p.position ?? '',
        team: p.team ?? 'FA',
        priority: p.priority ?? p.score ?? (picks.length - i),
        reason: p.reason ?? p.rationale ?? p.note ?? '',
        projectedPoints: p.projectedPoints ?? p.expectedPoints ?? null,
        headshotUrl: p.headshotUrl ?? p.imageUrl ?? p.photoUrl ?? null,
        teamLogoUrl: p.teamLogoUrl ?? null,
      })))
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[#ff3d81]" />
          <h3 className="text-[14px] font-bold text-white">Waiver Center</h3>
        </div>
        <button
          type="button"
          onClick={fetchSuggestions}
          disabled={loading || !leagueId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff3d81]/15 px-3 py-1.5 text-[11px] font-semibold text-[#ff9ec0] transition hover:bg-[#ff3d81]/25 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {loading ? 'Loading...' : 'Find targets'}
        </button>
      </div>

      {!leagueId && (
        <p className="text-xs text-white/40">Select a league to get waiver suggestions.</p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {targets.length === 0 && !loading && leagueId && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <p className="text-sm text-white/40">Use the waiver board to review available players and pending moves.</p>
          <p className="mt-1 text-xs text-white/20">Targets use your league roster and player pool context when available.</p>
        </div>
      )}

      {runtime && (
        <div
          data-testid="redraft-waiver-runtime-summary"
          className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-300" />
              <h4 className="text-[12px] font-bold text-white">Waiver runtime</h4>
            </div>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase text-white/55">
              {runtime.settings.mode}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
              <p className="text-[10px] text-white/35">Pending</p>
              <p className="mt-0.5 text-[15px] font-bold text-white">{runtime.coverage.pendingClaims}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
              <p className="text-[10px] text-white/35">FAAB teams</p>
              <p className="mt-0.5 text-[15px] font-bold text-white">{runtime.coverage.faabTeams}</p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
              <p className="text-[10px] text-white/35">Priority</p>
              <p className="mt-0.5 text-[15px] font-bold text-white">
                {runtime.priorityOrder.find((row) => row.rosterId === rosterId)?.waiverPriority ?? '-'}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
              <p className="text-[10px] text-white/35">Transactions</p>
              <p className="mt-0.5 text-[15px] font-bold text-white">{runtime.coverage.processedTransactions}</p>
            </div>
          </div>
        </div>
      )}

      {targets.length > 0 && (
        <div className="space-y-1.5">
          {targets.map((t, i) => (
            <Link
              key={`${t.name}-${i}`}
              href={`/player/${encodeURIComponent(t.name.toLowerCase().replace(/\s+/g, '-'))}`}
              className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.1] hover:bg-white/[0.04]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff3d81]/10 text-[10px] font-bold text-[#ff9ec0]">
                {i + 1}
              </span>
              <PlayerAvatar
                headshotUrl={t.headshotUrl ?? null}
                teamLogoUrl={t.teamLogoUrl ?? null}
                teamAbbr={t.team}
                position={t.position}
                displayName={t.name}
                size={32}
                testIdBase={`waiver-target-avatar-${i}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-white/80">{t.name}</span>
                  <span className="text-[10px] text-[#ff9ec0]/60">{t.position}</span>
                  <span className="text-[10px] text-white/30">{t.team}</span>
                  {t.projectedPoints != null && <ProjectionChip points={t.projectedPoints} />}
                </div>
                {t.reason && <p className="mt-0.5 text-[10px] text-white/35 line-clamp-1">{t.reason}</p>}
              </div>
              <div className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                {t.priority}/10
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[12px] font-bold text-white">Waiver claims</h4>
          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/45">
            {sport ?? 'NFL'}
          </span>
        </div>
        {!seasonId || !rosterId ? (
          <p className="text-[11px] text-white/40">Select a roster to view waiver claims.</p>
        ) : claims.length === 0 ? (
          <p className="text-[11px] text-white/40">No waiver claims submitted for this roster.</p>
        ) : (
          <div className="space-y-2">
            {claims.map((claim) => (
              <div key={claim.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-white">{claim.addPlayerName}</p>
                    <p className="text-[10px] text-white/40">
                      {claim.dropPlayerName ? `Drop ${claim.dropPlayerName}` : 'No drop'} - FAAB{' '}
                      {claim.bidAmount ?? 0}
                    </p>
                  </div>
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                      claim.status === 'approved'
                        ? 'bg-emerald-400/15 text-emerald-200'
                        : claim.status === 'denied'
                          ? 'bg-rose-400/15 text-rose-200'
                          : 'bg-[#ff3d81]/15 text-[#ffd7e5]',
                    ].join(' ')}
                  >
                    {claim.status}
                  </span>
                </div>
                {claim.denialReason ? <p className="mt-1 text-[10px] text-amber-100/80">{claim.denialReason}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
