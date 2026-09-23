'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { fetchPlayerComparisonSnapshot } from '@/lib/player-comparison-ui/fetch-comparison-snapshot'
import type { OpenPlayerComparisonPayload } from '@/lib/player-comparison-ui/types'
import type { PlayerComparisonPremiumSnapshot } from '@/lib/player-comparison-ui/types'
import { PlayerComparisonPremiumView } from './PlayerComparisonPremiumView'
import { Button } from '@/components/ui/button'

export type PlayerComparisonDrawerProps = {
  open: boolean
  onClose: () => void
  initialPayload: OpenPlayerComparisonPayload | null
}

export function PlayerComparisonDrawer({ open, onClose, initialPayload }: PlayerComparisonDrawerProps) {
  const [playerA, setPlayerA] = useState('')
  const [playerB, setPlayerB] = useState('')
  const [sport, setSport] = useState('NFL')
  const [leagueId, setLeagueId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [weekOrPeriod, setWeekOrPeriod] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PlayerComparisonPremiumSnapshot | null>(null)

  useEffect(() => {
    if (!open) return
    if (initialPayload) {
      setPlayerA(initialPayload.playerA)
      setPlayerB(initialPayload.playerB)
      setSport(initialPayload.sport || 'NFL')
      setLeagueId(initialPayload.leagueId ?? null)
      setTeamId(initialPayload.teamId ?? null)
      setWeekOrPeriod(initialPayload.weekOrPeriod ?? null)
    }
  }, [open, initialPayload])

  const run = useCallback(async () => {
    if (!playerA.trim() || !playerB.trim()) {
      setError('Enter two player names')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snap = await fetchPlayerComparisonSnapshot({
        playerA: playerA.trim(),
        playerB: playerB.trim(),
        sport,
        leagueId,
        teamId,
        weekOrPeriod,
        source: initialPayload?.source ?? 'manual',
      })
      setData(snap)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [playerA, playerB, sport, leagueId, teamId, weekOrPeriod, initialPayload?.source])

  /** Auto-run once when opened with two names from launcher */
  useEffect(() => {
    if (!open || !initialPayload) return
    const a = initialPayload.playerA?.trim()
    const b = initialPayload.playerB?.trim()
    if (!a || !b) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchPlayerComparisonSnapshot({
      playerA: a,
      playerB: b,
      sport: initialPayload.sport || 'NFL',
      leagueId: initialPayload.leagueId ?? null,
      teamId: initialPayload.teamId ?? null,
      weekOrPeriod: initialPayload.weekOrPeriod ?? null,
      source: initialPayload.source ?? 'manual',
    })
      .then((snap) => {
        if (!cancelled) setData(snap)
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null)
          setError(e instanceof Error ? e.message : 'Failed to load')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, initialPayload])

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm" aria-hidden onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[100] flex max-h-[94vh] flex-col rounded-t-2xl border border-white/10 bg-[#040915] pb-[env(safe-area-inset-bottom)] shadow-2xl sm:inset-y-4 sm:right-4 sm:left-auto sm:max-h-[none] sm:w-full sm:max-w-lg sm:rounded-2xl sm:pb-0"
        role="dialog"
        aria-label="Player comparison"
        data-testid="player-comparison-drawer"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">Player compare</p>
            <p className="text-sm font-semibold text-white">Side-by-side edge</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 space-y-2 border-b border-white/5 px-4 py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[10px] text-white/45">Player A</span>
              <input
                value={playerA}
                onChange={(e) => setPlayerA(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/12 bg-[#0a1228] px-3 py-2 text-sm text-white"
                placeholder="Name"
                data-testid="pc-drawer-input-a"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-white/45">Player B</span>
              <input
                value={playerB}
                onChange={(e) => setPlayerB(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/12 bg-[#0a1228] px-3 py-2 text-sm text-white"
                placeholder="Name"
                data-testid="pc-drawer-input-b"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="rounded-lg border border-white/12 bg-[#0a1228] px-3 py-2 text-sm text-white"
              data-testid="pc-drawer-sport"
            >
              {SUPPORTED_SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={loading}
              className="bg-cyan-500/90 text-[#040915] hover:bg-cyan-400"
              data-testid="pc-drawer-run"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </>
              ) : (
                'Compare'
              )}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-300/90">{error}</p> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && !data ? (
            <div className="flex justify-center py-16 text-white/50">
              <Loader2 className="h-10 w-10 animate-spin" />
            </div>
          ) : data ? (
            <PlayerComparisonPremiumView data={data} leagueId={leagueId} compact />
          ) : (
            <p className="text-center text-sm text-white/45">Enter two players and tap Compare.</p>
          )}
        </div>
      </div>
    </>
  )
}
