'use client'

import '@/components/core-app/af-core.css'
import '@/components/league/league-admin.css'
import { useState } from 'react'
import { NativeReadinessView, type SwitchState } from '@/components/league-home/NativeReadinessCard'
import type { NativeReadinessReport } from '@/lib/league/nativeReadiness'

const CHECKED_AT = '2027-02-01T12:00:00.000Z'
const NOW = Date.parse(CHECKED_AT) + 3 * 60_000

/** Sample data: a Sleeper dynasty league in February with the problems the checks can find. */
const BLOCKED: NativeReadinessReport = {
  leagueId: 'e2e-sleeper-dynasty', status: 'blocked', platformLabel: 'Sleeper', sport: 'NFL', teamCount: 12, playerCount: 300, checkedAt: CHECKED_AT,
  items: [
    { code: 'duplicate_copies', severity: 'blocker', title: '1 other copy of this league is on AllFantasy', action: 'Other members imported the same league on their own. Ask AllFantasy support to merge the copies into this one.' },
    { code: 'unmatched_players', severity: 'blocker', title: '3 players aren\u2019t matched to AllFantasy yet', names: ['Jaylen Carter', 'Marcus Holloway', 'Dee Whitfield'], action: 'Nothing for you to do. AllFantasy matches new players in its regular player updates. If these are still here in a few days, contact support.' },
    { code: 'unmapped_future_picks', severity: 'blocker', title: '1 future draft pick names a team we can\u2019t find', action: 'Refresh the import from Sleeper, then check again.' },
    { code: 'stale_sync', severity: 'heads_up', title: 'Last refreshed from Sleeper 4 days ago', action: 'Refresh the import before you switch, so AllFantasy starts from your latest rosters.' },
  ],
}
const READY: NativeReadinessReport = {
  ...BLOCKED, status: 'ready',
  items: [BLOCKED.items[3]!],
}

const BASEBALL: NativeReadinessReport = { ...READY, leagueId: 'e2e-espn-baseball', platformLabel: 'ESPN', sport: 'MLB', items: [] }

export default function NativeReadinessHarnessClient({ state }: { state: 'blocked' | 'ready' | 'mlb' | 'error' }) {
  // The switch itself never runs here: "Switch now" only shows its busy state.
  const [switchState, setSwitchState] = useState<SwitchState>({ confirming: false })
  return (
    <div className="af-core af-league-admin min-h-screen p-4 sm:p-5" data-testid="native-readiness-harness">
      <p className="mb-3 text-xs text-white/50">Sample data — harness for the Commissioner tab&apos;s readiness card.</p>
      <div className="mx-auto max-w-3xl">
        {state === 'error' ? (
          <section className="af-readiness rounded-2xl border border-white/[0.08] p-4 text-xs text-white/60" data-testid="native-readiness-card" data-status="error">
            We couldn&apos;t check whether this league can switch to AllFantasy.{' '}
            <button type="button" className="font-extrabold underline">Try again</button>
          </section>
        ) : (
          <NativeReadinessView
            report={state === 'ready' ? READY : state === 'mlb' ? BASEBALL : BLOCKED}
            onRecheck={() => {}}
            now={NOW}
            switchState={switchState}
            onStartSwitch={() => setSwitchState({ confirming: true })}
            onCancelSwitch={() => setSwitchState({ confirming: false })}
            onConfirmSwitch={() => setSwitchState((s) => ({ ...s, busy: true }))}
            onWeeklyLineups={(weeklyLineups) => setSwitchState((s) => ({ ...s, weeklyLineups }))}
          />
        )}
      </div>
    </div>
  )
}
