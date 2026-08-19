'use client'

import { useState } from 'react'
import { RedraftCommunicationPanel } from '@/components/redraft/RedraftCommunicationPanel'

const leagueId = 'g42-browser-league'

export default function G42NflRedraftCommunicationHarness() {
  const [activeTab, setActiveTab] = useState('home')

  return (
    <main className="min-h-screen bg-[#050814] px-4 py-5 text-white sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4" data-testid="g42-browser-harness">
        <header className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200/70">NFL Redraft</p>
          <h1 className="mt-1 text-2xl font-black">G42 Communication Proof</h1>
        </header>

        <RedraftCommunicationPanel
          leagueId={leagueId}
          isCommissioner
          onOpenChat={() => setActiveTab('league_chat')}
        />

        <aside className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-xs text-white/65" data-testid="g42-active-tab">
          Active tab: {activeTab}
        </aside>
      </div>
    </main>
  )
}
