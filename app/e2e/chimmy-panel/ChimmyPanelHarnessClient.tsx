'use client'

import { ChimmyChatPageClient } from '@/app/chimmy/chat/ChimmyChatPageClient'
import type { CommsLeague } from '@/components/core-app/comms/ChimmyPanel'

/** Harness only (app/e2e is 404 in production). SAMPLE leagues, invented. */
const LEAGUES: CommsLeague[] = [
  { id: 'h1', name: 'Sample Dynasty League', platform: 'sleeper', platformLeagueId: null },
  { id: 'h2', name: 'Sample Redraft League', platform: 'espn', platformLeagueId: null },
  { id: 'h3', name: 'Sample Best Ball', platform: 'sleeper', platformLeagueId: null },
]

export default function ChimmyPanelHarnessClient() {
  return (
    <div className="af-core" data-testid="chimmy-panel-harness">
      <ChimmyChatPageClient userId="harness-user" leagues={LEAGUES} tokenCost={1} planAllowance={null} />
    </div>
  )
}
