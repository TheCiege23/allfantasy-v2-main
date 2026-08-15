'use client'

import { useState } from 'react'
import { InviteManagementPanel, InviteModal, ReferralDashboard } from '@/components/invite'
import type { InviteShareChannel } from '@/lib/invite-engine/types'

export default function ViralLeagueInviteHarnessClient({ leagueId }: { leagueId: string }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [lastShareChannel, setLastShareChannel] = useState<InviteShareChannel | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const bumpRefresh = () => setRefreshKey((current) => current + 1)

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Viral Invite Engine Harness</h1>
            <p className="mt-2 text-sm text-white/70">
              Audits generate, preview, accept, sharing, expiration, and referral stat refresh flows.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            data-testid="open-invite-modal"
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-black"
          >
            Open invite modal
          </button>
        </div>

        {lastShareChannel && (
          <div
            data-testid="last-share-channel"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80"
          >
            Last share action: {lastShareChannel}
          </div>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-lg font-semibold">Referral dashboard</h2>
          <ReferralDashboard key={refreshKey} />
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-lg font-semibold">Invite management</h2>
          <InviteManagementPanel key={`panel-${refreshKey}`} />
        </section>
      </div>

      <InviteModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        inviteType="league"
        targetId={leagueId}
        targetLabel="E2E invite audit league"
        onGenerated={() => bumpRefresh()}
        onShared={(channel) => {
          setLastShareChannel(channel)
          bumpRefresh()
        }}
      />
    </main>
  )
}
