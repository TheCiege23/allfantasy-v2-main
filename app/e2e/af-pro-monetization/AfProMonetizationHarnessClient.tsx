'use client'

import { AFProPlanSpotlight } from '@/components/monetization/AFProPlanSpotlight'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'

export function AfProMonetizationHarnessClient() {
  return (
    <main className="min-h-screen bg-[#05060a] p-6 text-white">
      <h1 className="mb-4 text-xl font-semibold">E2E AF Pro Monetization Harness</h1>

      <AFProPlanSpotlight className="mb-4" />

      <div className="space-y-3">
        <InContextMonetizationCard
          title="Trade analyzer access"
          featureId="trade_analyzer"
          tokenRuleCodes={['ai_trade_analyzer_full_review']}
          testIdPrefix="afpro-trade"
        />
        <InContextMonetizationCard
          title="Matchup explanation access"
          featureId="matchup_explanations"
          tokenRuleCodes={['ai_matchup_explanation_single']}
          testIdPrefix="afpro-matchup"
        />
        <InContextMonetizationCard
          title="Planning tools access"
          featureId="planning_tools"
          tokenRuleCodes={['ai_weekly_planning_session']}
          testIdPrefix="afpro-planning"
        />
        <InContextMonetizationCard
          title="Player AI recommendations"
          featureId="player_ai_recommendations"
          tokenRuleCodes={['ai_lineup_recommendation_explanation_single']}
          testIdPrefix="afpro-player-ai"
        />
      </div>
    </main>
  )
}

