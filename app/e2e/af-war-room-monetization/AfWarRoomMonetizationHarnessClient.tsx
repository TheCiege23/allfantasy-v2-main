'use client'

import LegacyStrategyTab from '@/app/af-legacy/components/tabs/LegacyStrategyTab'
import { DraftHelperPanel } from '@/components/app/draft-room/DraftHelperPanel'
import { AFWarRoomPlanSpotlight } from '@/components/monetization/AFWarRoomPlanSpotlight'

export function AfWarRoomMonetizationHarnessClient() {
  return (
    <main className="min-h-screen space-y-4 bg-[#05060a] p-6 text-white">
      <h1 className="text-xl font-semibold">E2E AF War Room Monetization Harness</h1>

      <AFWarRoomPlanSpotlight />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white/80">Draft room context</h2>
        <DraftHelperPanel
          loading={false}
          error={null}
          recommendation={{
            player: { name: 'E2E Prospect', position: 'RB', team: 'DAL', adp: 24 },
            reason: 'Strong value at current slot based on roster and board.',
            confidence: 78,
          }}
          alternatives={[]}
          reachWarning={null}
          valueWarning={null}
          scarcityInsight={null}
          stackInsight={null}
          correlationInsight={null}
          formatInsight={null}
          byeNote={null}
          explanation="Deterministic baseline recommendation for test harness."
          evidence={['Needs-based score favors RB depth.']}
          caveats={[]}
          uncertainty={null}
          executionMode="deterministic_rules_engine"
          sport="NFL"
          round={4}
          pick={8}
          leagueId="e2e-war-room"
          leagueName="E2E War Room"
          rosterSlots={['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BENCH']}
          queueLength={4}
          aiExplanationEnabled={false}
          onRefresh={() => {}}
        />
      </section>

      <section className="rounded-xl border border-white/10 bg-black/20 p-3">
        <h2 className="mb-2 text-sm font-semibold text-white/80">Strategy tool context</h2>
        <LegacyStrategyTab leagues={[{ league_id: 'e2e-legacy-league', season: 2026 }]} username="e2e-user" />
      </section>
    </main>
  )
}
