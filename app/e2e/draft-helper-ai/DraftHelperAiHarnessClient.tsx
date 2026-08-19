'use client'

import { useState } from 'react'
import { DraftHelperPanel } from '@/components/app/draft-room/DraftHelperPanel'

export function DraftHelperAiHarnessClient() {
  const [aiExplanationEnabled, setAiExplanationEnabled] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)

  return (
    <main className="min-h-screen bg-[#050915] p-6 text-white">
      <h1 className="mb-2 text-lg font-semibold">Draft Helper AI Harness</h1>
      <p className="mb-3 text-xs text-white/60" data-testid="draft-helper-harness-refresh-count">
        Refresh count: {refreshCount}
      </p>
      <div className="max-w-sm">
        <DraftHelperPanel
          loading={false}
          error={null}
          recommendation={{
            player: { name: 'Atlas Runner', position: 'RB', team: 'NYJ', adp: 14.2 },
            reason: 'Best value at current board slot.',
            confidence: 86,
          }}
          alternatives={[
            {
              player: { name: 'Blaze Catcher', position: 'WR', team: 'DAL' },
              reason: 'High target share projection.',
              confidence: 80,
            },
          ]}
          reachWarning={null}
          valueWarning="Positive value at current ADP window."
          scarcityInsight="RB tier is thinning quickly."
          stackInsight={null}
          correlationInsight={null}
          formatInsight="FLEX setup keeps this pick versatile."
          byeNote={null}
          explanation="Deterministic recommendation from ADP and roster need."
          evidence={['Need score RB: 82', 'ADP edge: +3.1']}
          caveats={['Monitor same-team exposure.']}
          uncertainty={null}
          executionMode={aiExplanationEnabled ? 'ai_explained' : 'instant_automated'}
          sport="NFL"
          round={3}
          pick={7}
          leagueId="e2e-draft-helper"
          leagueName="E2E Draft Helper League"
          rosterSlots={['QB', 'RB', 'WR', 'TE', 'FLEX']}
          queueLength={2}
          aiExplanationEnabled={aiExplanationEnabled}
          onAiExplanationToggle={setAiExplanationEnabled}
          onRefresh={() => setRefreshCount((value) => value + 1)}
          onPlayerClick={() => {
            // Harness-only noop.
          }}
        />
      </div>
    </main>
  )
}
