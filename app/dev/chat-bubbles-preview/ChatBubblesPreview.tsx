'use client'

import { useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-comms.css'
import { ChimmyPanel } from '@/components/core-app/comms/ChimmyPanel'
import { PinnedBoard } from '@/components/core-app/comms/PinnedBoard'

/*
 * The Chimmy tab and the pinned board with fixed turns, for reviewing the chat's look without a
 * signed-in account or a database. ChimmyPanel reads saved turns from sessionStorage, so the
 * fixtures are written there before it mounts; its history fetch fails without a session and the
 * stored turns stand.
 */
const USER = 'preview-user'
const LEAGUE = { id: 'versuz', name: 'Versuz on Sleeper!', platform: 'sleeper', platformLeagueId: '1313549607426334720' }
const SYNCED = new Date(Date.now() - 62 * 60_000).toISOString()

const TURNS = [
  { id: 't1', role: 'you', text: 'find me 3 win now trades using my draft picks and a lesser player in versuz' },
  {
    id: 't2',
    role: 'chimmy',
    text: [
      'Win-now trade ideas for Fitty SF:',
      'OTFBackpack: give Tyjae Spears, 2027 2nd, receive Mike Evans. Market values 3100.0 vs 3150.0; fairness band: balanced. This season: 1200.0 given vs 3900.0 received.',
      'maxkranz: give Rashid Shaheed, 2027 3rd, receive Jakobi Meyers. Market values 2210.0 vs 2300.0; fairness band: balanced. This season: 1500.0 given vs 2900.0 received.',
      'Draft picks: pick values are round averages (exact draft slots unknown), and each package assumes you still own that pick yourself — check before sending.',
    ].join('\n'),
    mode: 'deep_analysis',
    cost: null,
    plan: { kind: 'plan', included: true, planName: 'AF Supreme', used: 4, limit: 100, resetsAt: new Date(Date.now() + 8 * 3600_000).toISOString() },
    grounding: { grounded: true, leagueId: LEAGUE.id, leagueName: LEAGUE.name, lastSyncedAt: SYNCED },
    answerId: 'a1',
    followUps: ['Grade the OTFBackpack offer with a 3rd instead of a 2nd'],
  },
  { id: 't3', role: 'you', text: 'explain PPR scoring in two short sentences' },
  {
    id: 't4',
    role: 'chimmy',
    text: 'PPR gives every catch a point on top of yards and touchdowns — 1 in full PPR, 0.5 in half. That lifts high-target receivers and pass-catching backs over players who only run.',
    mode: 'fast',
    cost: 0,
    answerId: 'a2',
  },
]

const PINS = [
  { pinId: 'p1', messageId: 'm1', snippet: 'Trade deadline is Week 11. Dues are due before the playoffs.', pinnedBy: 'TheCiege24', pinnedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  { pinId: 'p2', messageId: 'm2', snippet: 'Keeper declarations open the Monday after the championship.', pinnedBy: 'TheCiege24', pinnedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
]

function seedTurns() {
  try {
    sessionStorage.setItem(`af:comms:conversations:${USER}`, JSON.stringify({ [LEAGUE.id]: { turns: TURNS, draft: '' } }))
  } catch {
    /* Private mode: the panel opens empty, which is still a preview. */
  }
  return true
}

export default function ChatBubblesPreview() {
  // Seeded during the first render, before ChimmyPanel's effects read storage.
  useState(seedTurns)
  const [scope, setScope] = useState<string | null>(LEAGUE.id)
  return (
    <div className="af-core" style={{ minHeight: '100vh', padding: 24 }}>
      <aside className="af-cm" data-mode="docked" aria-label="Communications preview">
        <div style={{ flex: 'none', padding: '8px 12px 0' }}>
          <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 6px' }}>League tab — member view, then commissioner view</p>
          <PinnedBoard pins={PINS} onJump={() => {}} />
          <PinnedBoard pins={PINS} onJump={() => {}} onUnpin={() => {}} />
        </div>
        <ChimmyPanel
          leagues={[LEAGUE]}
          scopeId={scope}
          onScope={setScope}
          tokenCost={10}
          publicMode={false}
          homeSignals={null}
          pageSurface={null}
          userId={USER}
        />
      </aside>
    </div>
  )
}
