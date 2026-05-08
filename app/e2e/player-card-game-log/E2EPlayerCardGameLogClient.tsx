'use client'

import { GameLogTab } from '@/app/player/[playerId]/tabs/GameLogTab'
import type { PlayerIdentity } from '@/app/player/[playerId]/PlayerProfileClient'

const HARNESS_PLAYER: PlayerIdentity = {
  id: 'e2e-harness-player',
  name: 'E2E Harness Player',
  position: 'QB',
  team: 'CIN',
  sport: 'NFL',
  sleeperId: null,
  status: 'active',
}

/**
 * E2E-only harness for the player card Game Log tab. Renders the real
 * `GameLogTab` against a synthetic player; the test mocks
 * `/api/player-card-analytics` via Playwright `page.route()`.
 *
 * Gated by NODE_ENV !== 'production' in the parent server page.
 */
export default function E2EPlayerCardGameLogClient() {
  return (
    <div className="min-h-screen bg-[#040915] p-6 text-white">
      <h1 className="mb-4 text-lg font-semibold">E2E player-card game-log harness</h1>
      <div className="mx-auto max-w-2xl">
        <GameLogTab player={HARNESS_PLAYER} />
      </div>
    </div>
  )
}
