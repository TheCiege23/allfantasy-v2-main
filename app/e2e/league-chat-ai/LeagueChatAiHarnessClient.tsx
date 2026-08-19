'use client'

import LeagueChatPanel from '@/components/chat/LeagueChatPanel'

export function LeagueChatAiHarnessClient() {
  return (
    <main className="min-h-screen bg-[#050915] p-6 text-white">
      <h1 className="mb-3 text-lg font-semibold">League Chat AI Harness</h1>
      <div className="max-w-4xl">
        <LeagueChatPanel
          leagueId="e2e-league-chat-ai"
          leagueName="E2E League Chat"
          isCommissioner
          defaultOpen
          className="min-h-[560px]"
        />
      </div>
    </main>
  )
}
