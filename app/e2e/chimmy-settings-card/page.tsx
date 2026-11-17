'use client'

import ChimmyActionCard from '@/components/chimmy/ChimmyActionCard'
import type { ChimmyActionCard as Card } from '@/lib/chimmy-chat/actionCards'

/**
 * The league-settings confirm card Chimmy shows a commissioner (stage 5, 2026-11-16), with fixed data.
 * The /e2e layout blocks this route in production; the spec stubs /api/chimmy/actions/confirm.
 */

const BASE = {
  token: 'signed.token-value',
  league: { id: 'L1', name: 'Dynasty Ten', sport: 'NFL' },
  week: 0,
  season: 2026,
  expiresAt: '2099-01-01T00:00:00.000Z',
}

const PRESEASON: Card = {
  ...BASE,
  actionId: 'e2e-settings-1',
  kind: 'settings',
  title: 'Change league settings',
  settings: {
    changes: [
      { label: 'FAAB budget', from: '$100', to: '$200' },
      { label: 'Minimum FAAB bid', from: '$0', to: '$1' },
    ],
    midSeason: false,
  },
  warnings: [],
}

const MID_SEASON: Card = {
  ...BASE,
  actionId: 'e2e-settings-2',
  kind: 'settings',
  title: 'Change the trade deadline',
  settings: { changes: [{ label: 'Trade deadline', from: 'Week 11', to: 'Week 12' }], midSeason: true },
  warnings: ['The season has started. This applies from now on, to every team, and is announced in the league. Tap Confirm, then confirm again.'],
}

export default function ChimmySettingsCardHarness() {
  return (
    <main className="min-h-screen bg-[#07111f] p-4 sm:p-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div data-testid="settings-card-preseason">
          <ChimmyActionCard card={PRESEASON} />
        </div>
        <div data-testid="settings-card-mid-season">
          <ChimmyActionCard card={MID_SEASON} />
        </div>
      </div>
    </main>
  )
}
