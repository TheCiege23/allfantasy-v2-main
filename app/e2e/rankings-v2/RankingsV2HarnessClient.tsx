"use client"

import LeagueRankingsV2Panel from "@/components/LeagueRankingsV2Panel"

export default function RankingsV2HarnessClient() {
  return (
    <div className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-4">
        <h1 className="text-2xl font-semibold">Rankings V2 Harness</h1>
        <p className="text-sm text-white/70">
          E2E harness for rankings, coaching, and manager psychology click audit.
        </p>
        <LeagueRankingsV2Panel
          leagueId="league_rankings_v2_1"
          leagueName="Audit League"
          username="alpha"
        />
      </div>
    </div>
  )
}
