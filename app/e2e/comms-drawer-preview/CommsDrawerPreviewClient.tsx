'use client'

import { useEffect, useState } from 'react'
import { SessionProvider } from 'next-auth/react'
import { CommsDrawer, type CommsTab } from '@/components/core-app/comms/CommsDrawer'
import '@/components/core-app/af-core.css'

/* SAMPLE DATA — invented leagues, teams and messages for screenshots only. */
const ME = 'u-me'
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const LEAGUES = [
  { id: 'L1', name: "Dynasty Bros '26", platform: 'sleeper', platformLeagueId: null, isCommissioner: true, teamCount: 12 },
  { id: 'L2', name: 'Work League Redraft', platform: 'espn', platformLeagueId: null, teamCount: 10 },
  { id: 'L3', name: 'C2C Devy', platform: 'sleeper', platformLeagueId: null, teamCount: 14 },
]

function respond(url: string): unknown {
  // next-auth re-reads the session on mount; an empty body signs the viewer out and every "You" message drew on the left.
  if (url.includes('/api/auth/session')) {
    return { user: { id: ME, name: 'You' }, expires: new Date(Date.now() + 864e5).toISOString() }
  }
  if (url.includes('/chat/moves')) {
    return {
      moves: [
        {
          id: 'mv1', kind: 'waiver', occurredAt: minsAgo(70), teamName: 'Gridiron Gang', bid: 1,
          adds: [{ id: 'p1', name: 'Samaje Perine', position: 'RB', team: 'CIN' }], drops: [],
        },
      ],
    }
  }
  if (/\/api\/app\/leagues\/[^/]+\/chat/.test(url)) {
    return {
      viewerUserId: ME,
      presence: [
        { userId: 'u2', name: 'Bolt Up', status: 'online', lastSeenAt: minsAgo(1) },
        { userId: 'u3', name: 'Hail Mary U', status: 'online', lastSeenAt: minsAgo(2) },
      ],
      messages: [
        { id: 'm1', authorId: 'u3', authorName: 'Hail Mary U', text: "At least y'all aren't Cowboys fans… we think every year is ours", createdAt: minsAgo(80) },
        { id: 'm2', authorId: 'u2', authorName: 'Bolt Up', text: '@Gridiron Gang can you switch me and @Bengal Brigade? He wants his team back', createdAt: minsAgo(78) },
        { id: 'm3', authorId: ME, authorName: 'You', text: 'commish approves 👍', createdAt: minsAgo(60) },
        { id: 'm4', authorId: 'u4', authorName: 'Texan Two-Step', text: 'Best thing that ever happened to us was Cleveland taking Watson off our hands', createdAt: minsAgo(20) },
        { id: 'm5', authorId: 'u4', authorName: 'Texan Two-Step', text: 'no notes', createdAt: minsAgo(19) },
      ],
    }
  }
  if (url.includes('/api/shared/activity')) {
    return {
      items: [
        { id: 'a1', type: 'injury', userName: 'Jake Ferguson', description: 'Jake Ferguson (TE) → Questionable — on 4 of your rosters', timestamp: minsAgo(31), leagueId: null, leagueName: null, href: '/my-players' },
        { id: 'a2', type: 'trade', userName: 'Bolt Up', description: 'Bolt Up traded George Pickens for a 2026 1st', timestamp: minsAgo(95), leagueId: 'L1', leagueName: "Dynasty Bros '26" },
        { id: 'a3', type: 'waiver', userName: 'Gridiron Gang', description: 'Gridiron Gang claimed Samaje Perine ($1)', timestamp: minsAgo(180), leagueId: 'L1', leagueName: "Dynasty Bros '26" },
        { id: 'a4', type: 'injury', userName: 'Kendrick Bourne', description: 'Kendrick Bourne (WR) → Questionable — on 2 of your rosters', timestamp: minsAgo(200), leagueId: null, leagueName: null, href: '/my-players' },
      ],
    }
  }
  if (/\/api\/shared\/chat\/threads\/[^/]+\/messages/.test(url)) {
    const them = { senderUserId: 'u5', senderName: 'Gridiron Gang' }
    const me = { senderUserId: ME, senderName: 'You' }
    return {
      messages: [
        { id: 'd1', ...them, body: 'You still shopping Pickens?', createdAt: minsAgo(60 * 26) },
        { id: 'd2', ...me, body: 'Depends what you have in mind 👀', createdAt: minsAgo(60 * 26 - 3) },
        { id: 'd3', ...them, body: 'I can do my 2026 1st. Probably a late one but still', createdAt: minsAgo(9) },
        { id: 'd4', ...them, body: 'Would you move Pickens for a 2026 1st?', createdAt: minsAgo(2) },
        { id: 'd5', ...me, body: 'Add a 2nd and we can talk', createdAt: minsAgo(1) },
      ],
    }
  }
  if (url.endsWith('/api/shared/chat/threads') || url.includes('/api/shared/chat/threads?')) {
    const person = (id: string, name: string) => ({ id, name, avatarUrl: null })
    return {
      threads: [
        { id: 't1', threadType: 'dm', title: 'Gridiron Gang', lastMessageAt: minsAgo(2), unreadCount: 2, memberCount: 2, context: { lastMessagePreview: 'Would you move Pickens for a 2026 1st?', lastMessageCreatedAt: minsAgo(2), members: [person('u5', 'Gridiron Gang')], otherLastActiveAt: minsAgo(1) } },
        { id: 't2', threadType: 'dm', title: 'Bolt Up', lastMessageAt: minsAgo(18), unreadCount: 0, memberCount: 2, context: { lastMessagePreview: 'lol that waiver bid', lastMessageMine: true, lastMessageSeen: true, lastMessageCreatedAt: minsAgo(18), members: [person('u2', 'Bolt Up')] } },
        { id: 't3', threadType: 'dm', title: 'Hail Mary U', lastMessageAt: minsAgo(60 * 30), unreadCount: 0, memberCount: 2, context: { lastMessagePreview: 'Sup!', lastMessageMine: true, lastMessageCreatedAt: minsAgo(60 * 30), members: [person('u3', 'Hail Mary U')] } },
        { id: 't4', threadType: 'group', title: 'Week 9 · vs Gridiron Gang', lastMessageAt: minsAgo(3), unreadCount: 3, memberCount: 2, context: { lastMessagePreview: 'you sure about benching Kincaid?', lastMessageCreatedAt: minsAgo(3), members: [person('u5', 'Gridiron Gang'), person(ME, 'You')] } },
        { id: 't5', threadType: 'group', title: 'Commish council', lastMessageAt: minsAgo(60 * 50), unreadCount: 0, memberCount: 3, context: { lastMessagePreview: 'vote closes tonight', lastMessageCreatedAt: minsAgo(60 * 50), members: [person('u3', 'Hail Mary U'), person('u4', 'Texan Two-Step'), person(ME, 'You')] } },
        { id: 't6', threadType: 'group', title: "Week 8 · vs Pinto's Bean Store", lastMessageAt: minsAgo(60 * 24 * 6), unreadCount: 0, memberCount: 2, context: { members: [person('u6', "Pinto's Bean Store"), person(ME, 'You')] } },
      ],
    }
  }
  if (url.includes('/api/discord/league')) {
    return { botConfigured: true, isCommissioner: true, missingPermissions: null, inviteUrl: null, channel: null }
  }
  return {}
}

if (typeof window !== 'undefined' && !(window as { __afCommsMock?: boolean }).__afCommsMock) {
  ;(window as { __afCommsMock?: boolean }).__afCommsMock = true
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/')) {
      return new Response(JSON.stringify(respond(url)), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return real(input, init)
  }
}

export default function CommsDrawerPreviewClient({ tab, league, mode }: { tab: string; league: string; mode: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    document.documentElement.dataset.mode = mode === 'light' ? 'light' : 'dark'
    setReady(true)
  }, [mode])
  if (!ready) return null
  return (
    <SessionProvider session={{ user: { id: ME, name: 'You' }, expires: new Date(Date.now() + 864e5).toISOString() } as never}>
      <div className="af-core" style={{ minHeight: '100dvh', background: mode === 'light' ? '#f4f6fc' : '#0a0d11' }}>
        <div aria-hidden style={{ padding: 32, color: mode === 'light' ? '#5c6587' : '#3a4350', fontFamily: 'system-ui', fontSize: 14 }}>
          Sample page behind the chat panel
        </div>
        <CommsDrawer
          open
          onClose={() => {}}
          leagues={LEAGUES as never}
          pageLeagueId={league === 'none' ? null : league}
          chimmyTokenCost={10}
          initialTab={tab as CommsTab}
          userId={ME}
          tabCounts={{ league: 4, chimmy: 1, huddle: 3, dms: 2 }}
        />
      </div>
    </SessionProvider>
  )
}
