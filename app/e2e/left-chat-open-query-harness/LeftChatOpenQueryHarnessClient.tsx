'use client'

import { useSearchParams } from 'next/navigation'
import { LeftChatPanel } from '@/app/dashboard/components/LeftChatPanel'
import { normalizeOpenChatQueryParam } from '@/lib/dashboard/open-chat-query'
import type { UserLeague } from '@/app/dashboard/types'

const MOCK_LEAGUE: UserLeague = {
  id: 'e2e-open-chat-harness',
  name: 'Open Chat Harness',
  platform: 'manual',
  sport: 'NFL',
  format: 'redraft',
  teamCount: 12,
}

export function LeftChatOpenQueryHarnessClient() {
  const searchParams = useSearchParams()
  const initialOpenChat = normalizeOpenChatQueryParam(searchParams.get('openChat'))

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-4 text-white">
      <h1 className="mb-2 text-lg font-semibold">Left chat openChat query harness</h1>
      <p className="mb-4 max-w-lg text-xs text-white/50" data-testid="left-chat-open-harness-help">
        Pass <code className="text-cyan-300">?openChat=league|chimmy|dms|af_huddle</code>. With a league context,
        the default rail is league chat.
      </p>
      <div className="h-[520px] w-[min(100%,400px)] overflow-hidden rounded-xl border border-white/10">
        <LeftChatPanel
          selectedLeague={MOCK_LEAGUE}
          activeLeagueId={MOCK_LEAGUE.id}
          userId="e2e-open-chat-user"
          userDisplayName="E2E User"
          rootId="e2e-left-chat-open-query"
          leagues={[MOCK_LEAGUE]}
          initialOpenChat={initialOpenChat}
        />
      </div>
    </main>
  )
}
