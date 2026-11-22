'use client'

import { Suspense, useEffect, useState } from 'react'
import { ConnectedAccountsSettingsSection } from '@/app/settings/components/sections/ConnectedAccountsSettingsSection'
import type { SettingsProfile } from '@/app/settings/components/sections/settings-types'

function fixture(spotifyConnectAllowed: boolean): SettingsProfile {
  return {
    userId: 'preview-user',
    username: 'preview',
    email: 'preview@allfantasy.test',
    displayName: 'Preview User',
    discordUserId: null,
    spotifyConnectedAt: null,
    spotifyDisplayName: null,
    spotifyConnectAllowed,
  } as unknown as SettingsProfile
}

export function SettingsCardPreviewClient() {
  const [tester, setTester] = useState(true)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tester') === '0') setTester(false)
  }, [])

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Spotify settings preview</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Real Connected Accounts section with a fixture profile. Dev only. Provider rows may show
            loading or errors here: there is no session or database behind this page.
          </p>
        </div>
        <div className="flex gap-2">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setTester(v)}
              className={`rounded-full px-3 py-1 text-xs ${tester === v ? 'bg-[#1DB954] text-black' : 'bg-white/10'}`}
            >
              {v ? 'On the tester allowlist' : 'Not on the allowlist'}
            </button>
          ))}
        </div>
        <Suspense fallback={null}>
          <ConnectedAccountsSettingsSection key={String(tester)} profile={fixture(tester)} onRefetchProfile={() => {}} />
        </Suspense>
      </div>
    </div>
  )
}
