'use client'

import { AFAllAccessBundleSpotlight } from '@/components/monetization/AFAllAccessBundleSpotlight'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'

export function AllAccessBundleHarnessClient() {
  return (
    <main className="min-h-screen space-y-4 bg-[#05060a] p-6 text-white">
      <h1 className="text-xl font-semibold">E2E All-Access Bundle Harness</h1>

      <AFAllAccessBundleSpotlight />

      <section className="space-y-3">
        <InContextMonetizationCard
          title="AF Pro feature access"
          featureId="trade_analyzer"
          tokenRuleCodes={['ai_trade_analyzer_full_review']}
          testIdPrefix="all-access-pro"
        />
        <InContextMonetizationCard
          title="AF Commissioner feature access"
          featureId="commissioner_automation"
          tokenRuleCodes={['commissioner_ai_cycle_run']}
          testIdPrefix="all-access-commissioner"
        />
        <InContextMonetizationCard
          title="AF War Room feature access"
          featureId="draft_strategy_build"
          tokenRuleCodes={['ai_war_room_multi_step_planning']}
          testIdPrefix="all-access-war-room"
        />
      </section>
    </main>
  )
}
