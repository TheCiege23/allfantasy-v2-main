'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { fetchPlayerComparisonSnapshot } from '@/lib/player-comparison-ui/fetch-comparison-snapshot'
import type { PlayerComparisonPremiumSnapshot } from '@/lib/player-comparison-ui/types'
import { PlayerComparisonPremiumView } from '@/components/player-comparison-ui/PlayerComparisonPremiumView'
import { Button } from '@/components/ui/button'

export function PlayerComparePageClient(props: {
  initialPlayerA?: string
  initialPlayerB?: string
  initialSport?: string
  leagueId?: string | null
}) {
  const [playerA, setPlayerA] = useState(props.initialPlayerA ?? '')
  const [playerB, setPlayerB] = useState(props.initialPlayerB ?? '')
  const [sport, setSport] = useState(props.initialSport ?? 'NFL')
  const [data, setData] = useState<PlayerComparisonPremiumSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!playerA.trim() || !playerB.trim()) {
      setError('Enter two players')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snap = await fetchPlayerComparisonSnapshot({
        playerA: playerA.trim(),
        playerB: playerB.trim(),
        sport,
        leagueId: props.leagueId ?? null,
        source: 'tool_page',
      })
      setData(snap)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [playerA, playerB, sport, props.leagueId])

  useEffect(() => {
    const a = props.initialPlayerA?.trim()
    const b = props.initialPlayerB?.trim()
    if (!a || !b) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchPlayerComparisonSnapshot({
      playerA: a,
      playerB: b,
      sport: props.initialSport ?? sport,
      leagueId: props.leagueId ?? null,
      source: 'tool_page',
    })
      .then((snap) => {
        if (!cancelled) setData(snap)
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null)
          setError(e instanceof Error ? e.message : 'Failed')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Intentionally once on mount for URL-prefilled compare
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen bg-[#040915] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/core"
          className="mb-6 inline-flex items-center gap-2 text-sm text-white/55 hover:text-white/85"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Link>

        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Player comparison</h1>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Side-by-side edge, confidence, and AI summary — tuned for weekly starts with dynasty, draft, and waiver
            lenses.
          </p>
        </header>

        <div className="mb-6 rounded-2xl border border-white/10 bg-[#0a1228]/80 p-4 backdrop-blur-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-white/45">Player A</span>
              <input
                value={playerA}
                onChange={(e) => setPlayerA(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-white"
              />
            </label>
            <label className="block text-sm">
              <span className="text-white/45">Player B</span>
              <input
                value={playerB}
                onChange={(e) => setPlayerB(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-white"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="rounded-xl border border-white/12 bg-[#040915] px-3 py-2 text-sm"
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
              className="bg-cyan-500 text-[#040915] hover:bg-cyan-400"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Comparing
                </>
              ) : (
                'Compare'
              )}
            </Button>
          </div>
          {error ? <p className="mt-3 text-sm text-red-300/90">{error}</p> : null}
        </div>

        {loading && !data ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-12 w-12 animate-spin text-cyan-400/80" />
          </div>
        ) : data ? (
          <PlayerComparisonPremiumView data={data} leagueId={props.leagueId ?? null} />
        ) : (
          <p className="text-center text-sm text-white/40">Enter two players to see the full comparison.</p>
        )}
      </div>
    </main>
  )
}
