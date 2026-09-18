'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MatchupSimCard } from '@/components/sports/MatchupSimCard'

type League = { id: string; name: string; sport: string }

export function MatchupSimulatorClient({
  userId,
  leagues,
  initialLeagueId,
  initialSport,
}: {
  userId: string
  leagues: League[]
  initialLeagueId?: string
  initialSport?: string
}) {
  const [leagueId, setLeagueId] = useState(initialLeagueId ?? leagues[0]?.id ?? '')
  const selectedLeague = leagues.find((l) => l.id === leagueId) ?? leagues[0]
  const sport = selectedLeague?.sport ?? initialSport ?? 'NFL'

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0a0f] to-[#0f0f1a] py-12">
      <div className="container mx-auto max-w-2xl px-4">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/core" className="text-white/40 hover:text-white/60">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-black text-white">Matchup Simulator</h1>
        </div>

        {leagues.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-[#0c0c1e] p-8 text-center">
            <p className="text-sm text-white/50">Import a league first to simulate matchups.</p>
            <Link
              href="/import"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-[13px] font-bold text-black"
            >
              Import League
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/30">League</label>
              <select
                value={leagueId}
                onChange={(e) => setLeagueId(e.target.value)}
                className="w-full rounded-xl border border-white/[0.12] bg-[#0c0c1e] px-3 py-2.5 text-sm text-white"
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name} ({l.sport})</option>
                ))}
              </select>
            </div>

            <MatchupSimCard
              leagueId={leagueId}
              sport={sport}
              teamAName="My Team"
              teamBName="Opponent"
            />
          </>
        )}
      </div>
    </div>
  )
}
