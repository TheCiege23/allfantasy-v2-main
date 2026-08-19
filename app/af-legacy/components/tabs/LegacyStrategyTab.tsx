'use client'

import StrategyPlanner from '@/components/StrategyPlanner'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'

type LegacyLeagueLite = {
  league_id: string
  season: number
}

export default function LegacyStrategyTab({
  leagues,
  username,
}: {
  leagues: LegacyLeagueLite[]
  username?: string
}) {
  const latestSeason = leagues.length > 0 ? Math.max(...leagues.map((l) => l.season)) : undefined
  const currentSeasonLeagues = latestSeason ? leagues.filter((l) => l.season === latestSeason) : []

  return (
    <>
      <p className="text-center text-sm sm:text-base text-white/60 mb-4">
        Get a personalized strategy based on your roster, standings, and draft capital.
      </p>
      <InContextMonetizationCard
        title="Player planning access"
        featureId="planning_tools"
        tokenRuleCodes={['ai_weekly_planning_session']}
        className="mb-4"
        testIdPrefix="legacy-planning-monetization"
      />
      <InContextMonetizationCard
        title="AF Legacy long-range strategy access"
        featureId="future_planning"
        tokenRuleCodes={['ai_strategy_3_5_year_planning', 'ai_war_room_multi_step_planning']}
        className="mb-4"
        testIdPrefix="legacy-war-room-monetization"
      />
      <FeatureGate
        featureId="future_planning"
        featureNameOverride="AF Legacy future planning"
        className="mb-4"
      >
        <div className="mb-4 rounded-xl border border-violet-400/25 bg-violet-500/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-violet-200/90">AF Legacy module</p>
          <p className="mt-1 text-sm text-white/75">
            Unlock future game planning, 3-5 year strategy plans, and roster construction workflows in AF Legacy.
          </p>
          <a
            href="/war-room"
            className="mt-2 inline-flex rounded-lg border border-violet-300/35 bg-violet-500/20 px-2.5 py-1 text-xs text-violet-100 hover:bg-violet-500/30"
            data-testid="legacy-war-room-open-link"
          >
            Open AF Legacy
          </a>
        </div>
      </FeatureGate>
      <div className="bg-black/30 border border-purple-500/20 rounded-2xl p-4 sm:p-6">
        <FeatureGate featureId="planning_tools" featureNameOverride="Player planning tools">
          <StrategyPlanner leagues={currentSeasonLeagues as any} sleeperUsername={username || ""} />
        </FeatureGate>
      </div>
    </>
  )
}

