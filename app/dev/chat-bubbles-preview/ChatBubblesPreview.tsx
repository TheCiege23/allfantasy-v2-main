'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-comms.css'
import { ChimmyPanel } from '@/components/core-app/comms/ChimmyPanel'
import { PinnedBoard } from '@/components/core-app/comms/PinnedBoard'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'
import { LeagueMoveCard } from '@/components/core-app/comms/LeagueMoveCard'
import { LEAGUE_MOVE_MESSAGE_TYPE, describeMove, mergeMovesIntoMessages, type LeagueMove } from '@/lib/league-chat/leagueMoves'

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

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const CHAT: ChatListMessage[] = [
  { id: 'c1', authorId: 'u2', authorName: 'AboogWithHoodie', body: 'who is taking Bucky off my hands', createdAt: ago(60) },
  { id: 'c2', authorId: 'u3', authorName: 'Savages13', body: 'not me lol', createdAt: ago(59) },
  { id: 'c3', authorId: USER, authorName: 'TheCiege24', body: 'I got you for a 2nd', createdAt: ago(30) },
  { id: 'c4', authorId: 'u2', authorName: 'AboogWithHoodie', body: 'done 🤝', createdAt: ago(2) },
]
const MOVES: LeagueMove[] = [
  { id: 'old', kind: 'waiver', occurredAt: ago(24 * 9), teamName: 'Older than the chat', managerName: null, avatarUrl: null, involvedTeams: [], adds: [{ id: 'x', name: 'Not shown', position: 'RB', team: 'NYJ', imageUrl: null, to: null }], drops: [], bid: 3, picks: [] },
  { id: 'w1', kind: 'waiver', occurredAt: ago(48), teamName: 'Savages13', managerName: 'Savages13', avatarUrl: null, involvedTeams: ['Savages13'], adds: [{ id: '4984', name: 'Jordan Addison', position: 'WR', team: 'MIN', imageUrl: null, to: null }], drops: [{ id: '8150', name: 'Tyrone Tracy Jr.', position: 'RB', team: 'NYG', imageUrl: null, to: null }], bid: 14, picks: [] },
  { id: 'f1', kind: 'roster_move', occurredAt: ago(40), teamName: 'AboogWithHoodie', managerName: 'AboogWithHoodie', avatarUrl: null, involvedTeams: ['AboogWithHoodie'], adds: [{ id: '9758', name: 'Bryce Young', position: 'QB', team: 'CAR', imageUrl: null, to: null }], drops: [{ id: '8137', name: 'Dontayvion Wicks', position: 'WR', team: 'PHI', imageUrl: null, to: null }], bid: null, picks: [] },
  { id: 't1', kind: 'trade', occurredAt: ago(3), teamName: 'Fitty SF', managerName: 'TheCiege24', avatarUrl: null, involvedTeams: ['Fitty SF', 'AboogWithHoodie'], adds: [{ id: '11584', name: 'Bucky Irving', position: 'RB', team: 'TB', imageUrl: null, to: 'Fitty SF' }, { id: '6813', name: 'Javonte Williams', position: 'RB', team: 'DAL', imageUrl: null, to: 'AboogWithHoodie' }], drops: [], bid: null, picks: ['2027 2nd'] },
]
const toListMessage = (move: LeagueMove): ChatListMessage => ({
  id: `move:${move.id}`, authorId: null, authorName: move.teamName ?? 'League', body: describeMove(move), createdAt: move.occurredAt, messageType: LEAGUE_MOVE_MESSAGE_TYPE, metadata: null,
})

function LeagueChatPreview() {
  // The fixtures are times relative to now; drawn after mount so server and browser agree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  const list = mergeMovesIntoMessages(CHAT, MOVES, toListMessage)
  const byId = new Map(MOVES.map((m) => [`move:${m.id}`, m]))
  return (
    <aside className="af-cm" data-mode="docked" aria-label="League chat preview" style={{ right: 'auto', left: 24, position: 'fixed' }}>
      <p style={{ fontSize: 11, opacity: 0.7, margin: '8px 12px 0' }}>League chat — moves between messages (the 9-day-old one is older than the chat, so left out)</p>
      <ChatMessageList
        messages={list}
        viewerId={USER}
        label="Versuz chat"
        reactionsFor={() => []}
        onToggleReaction={() => {}}
        onReply={() => {}}
        renderRich={() => null}
        nameForUserId={() => null}
        renderSystem={(m) => (m.messageType === LEAGUE_MOVE_MESSAGE_TYPE && byId.get(m.id) ? <LeagueMoveCard move={byId.get(m.id)!} /> : null)}
      />
    </aside>
  )
}

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
      <LeagueChatPreview />
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
