"use client"

import Link from "next/link"
import type { CrossLeagueUserStatsResult } from "@/lib/user-stats"
import { UserStatsClient } from "@/app/user/stats/UserStatsClient"

const POPULATED_STATS: CrossLeagueUserStatsResult = {
  wins: 86,
  losses: 54,
  ties: 2,
  championships: 6,
  playoffAppearances: 11,
  draftGrades: {
    count: 14,
    averageScore: 82.4,
    latestGrade: "A-",
  },
  tradeSuccess: {
    tradesSent: 37,
    tradesAccepted: 21,
    acceptanceRate: 21 / 37,
  },
  seasonsPlayed: 15,
  leaguesPlayed: 9,
}

const EMPTY_STATS: CrossLeagueUserStatsResult = {
  wins: 0,
  losses: 0,
  ties: 0,
  championships: 0,
  playoffAppearances: 0,
  draftGrades: {
    count: 0,
    averageScore: 0,
    latestGrade: null,
  },
  tradeSuccess: {
    tradesSent: 0,
    tradesAccepted: 0,
    acceptanceRate: 0,
  },
  seasonsPlayed: 0,
  leaguesPlayed: 0,
}

export default function UserStatsHarnessClient({ showEmpty }: { showEmpty: boolean }) {
  return (
    <main className="min-h-screen mode-surface mode-readable px-4 py-6">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
            User Stats Harness
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Deterministic harness for cross-league user stats UI.
          </p>
          <Link
            data-testid="user-stats-harness-toggle"
            href={showEmpty ? "/e2e/user-stats" : "/e2e/user-stats?state=empty"}
            className="rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--panel2)" }}
          >
            {showEmpty ? "Show populated stats" : "Show empty stats"}
          </Link>
        </header>

        <UserStatsClient initialStats={showEmpty ? EMPTY_STATS : POPULATED_STATS} error={null} />
      </div>
    </main>
  )
}
