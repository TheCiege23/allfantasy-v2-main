'use client'

import { useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import LeagueChatSurface from '@/components/chat/LeagueChatSurface'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveRedraftIdentity } from '@/lib/league-media/redraftIdentity'
import { FIXTURE_LEAGUE_ID, FIXTURE_VIEWER_ID, fixtureMatchup, fixtureMessages } from './redraftChatFixture'
// LeagueShell loads /core's palette itself (the workspace does not), so the harness must too.
import '@/components/core-app/af-core.css'

const TABS = [
  { id: 'native_home', label: 'League home' }, { id: 'roster', label: 'My Team' }, { id: 'matchups', label: 'Matchups' },
  { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' }, { id: 'standings', label: 'Standings' },
  { id: 'league_chat', label: 'League Chat' }, { id: 'settings', label: '⚙ Settings' },
]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * HARNESS ONLY. Answers every `/api/*` request from fixtures so this page never reaches a route that
 * reads the database: the chat GET returns the fixture transcript (and the viewer id, which puts the
 * viewer's rows on the right), a POST appends to it so the real composer can be exercised, and
 * anything else gets an empty 200. Installed once, before the first render's effects run.
 */
function installFixtureNetwork(sport: string, withChimmyShare = false) {
  const w = window as unknown as { __rdChatFixture?: string; __rdRealFetch?: typeof fetch }
  const fixtureKey = `${sport}:${withChimmyShare ? 'share' : ''}`
  if (w.__rdChatFixture === fixtureKey) return
  w.__rdChatFixture = fixtureKey
  const real = w.__rdRealFetch ?? window.fetch.bind(window)
  w.__rdRealFetch = real
  const messages = fixtureMessages(sport)
  /*
   * ?share=1 — a private @chimmy question and answer (only the viewer sees them), marked shareable as the
   * chat route marks a general answer, and a fixture for the "Share with league" POST (2026-11-16).
   */
  if (withChimmyShare) {
    const at = new Date(Date.now() - 60_000).toISOString()
    messages.push(
      { id: 'fx-chimmy-q', authorId: FIXTURE_VIEWER_ID, authorName: 'Fourth & Long', authorAvatarUrl: null, createdAt: at, messageType: 'text', source: null, parentMessageId: null, text: '@chimmy who should I start at flex, Puka Nacua or Drake London?', metadata: null },
      { id: 'fx-chimmy-a', authorId: '', authorName: 'Chimmy', authorAvatarUrl: null, createdAt: at, messageType: 'system', source: null, parentMessageId: null, text: 'Start Puka Nacua. He has seen 9+ targets in four straight weeks; London faces a top-three pass defense.', metadata: { isSystem: true, chimmyPrivateReply: true, chimmyShareable: true, questionMessageId: 'fx-chimmy-q' } },
    )
  }
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.pathname === `/api/app/leagues/${FIXTURE_LEAGUE_ID}/chat`) {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { message?: string; type?: string; metadata?: Record<string, unknown> }
        const row = {
          id: `fx-sent-${messages.length}`, authorId: FIXTURE_VIEWER_ID, authorName: 'Fourth & Long', authorAvatarUrl: null,
          createdAt: new Date().toISOString(), messageType: body.type ?? 'text', source: null, parentMessageId: null,
          text: body.message ?? '', metadata: body.metadata ?? null,
        }
        messages.push(row)
        return json({ message: row })
      }
      const channel = url.searchParams.get('leagueChannel')
      const rows = channel && channel !== 'general'
        ? messages.filter(m => (channel === 'trades' && /trade/.test(String(m.messageType))) || (channel === 'waivers' && /waiver/.test(String(m.messageType))))
        : messages
      return json({ viewerUserId: FIXTURE_VIEWER_ID, presence: [], includeDraft: false, draft: null, messages: rows })
    }
    if (url.pathname === '/api/league/chat/chimmy-share' && method === 'POST') {
      const reply = messages.find((m) => m.id === 'fx-chimmy-a')
      if (!reply) return json({ error: 'That answer could not be found.' }, 404)
      reply.metadata = { ...(reply.metadata ?? {}), sharedMessageId: 'fx-chimmy-shared' }
      messages.push({ id: 'fx-chimmy-shared', authorId: '', authorName: 'Chimmy', authorAvatarUrl: null, createdAt: new Date().toISOString(), messageType: 'system', source: null, parentMessageId: null, text: `Fourth & Long asked Chimmy: "who should I start at flex, Puka Nacua or Drake London?"\n\n${reply.text}`, metadata: { isSystem: true, chimmy: true, sharedChimmyAnswer: { askedByUserId: FIXTURE_VIEWER_ID, askedByName: 'Fourth & Long', sourceMessageId: 'fx-chimmy-a' } } })
      return json({ ok: true, alreadyShared: false, sharedMessageId: 'fx-chimmy-shared', message: null })
    }
    if (url.pathname.endsWith('/typing')) return json({ typing: [] })
    if (url.pathname.endsWith('/pinned')) return json({ pinned: [] })
    if (url.pathname === '/api/auth/session') return json({ user: { id: FIXTURE_VIEWER_ID, name: 'Fourth & Long' }, expires: '2099-01-01T00:00:00.000Z' })
    return json({})
  }
}

type Props = { sport: string; withScore: boolean; withChimmyShare?: boolean }

export default function RedraftChatHarnessClient({ sport, withScore, withChimmyShare = false }: Props) {
  if (typeof window !== 'undefined') installFixtureNetwork(sport.toUpperCase(), withChimmyShare)
  const [activeTab, setActiveTab] = useState('league_chat')
  const league: UserLeague = {
    id: FIXTURE_LEAGUE_ID,
    name: 'Sunday Night Redraft',
    platform: 'allfantasy',
    sport: normalizeToSupportedSport(sport),
    format: 'redraft',
    scoring: 'Half PPR',
    teamCount: 12,
    season: 2026,
    lifecycleState: 'in_season',
    currentWeek: 9,
    leagueType: 'redraft',
    isCommissioner: true,
  }
  return (
    <NativeLeagueWorkspace
      native
      league={league}
      leagues={[league]}
      tabs={TABS}
      activeTab={activeTab}
      isCommissioner
      onSelectTab={setActiveTab}
      onOpenSettings={() => setActiveTab('settings')}
      seasonFacts={{ totalWeeks: 17, playoffStartWeek: 15, draftComplete: true }}
      leftPanel={null}
      rightPanel={null}
    >
      <div className="flex min-h-0 flex-1 flex-col" data-testid="g32-league-chat-tab">
        <LeagueChatSurface
          leagueId={FIXTURE_LEAGUE_ID}
          leagueName={league.name ?? 'League'}
          platform={league.platform}
          isCommissioner
          teamCount={12}
          importedLeagueCount={0}
          redraftSport={resolveRedraftIdentity(league)?.sport ?? null}
          matchup={withScore ? fixtureMatchup(sport) : null}
        />
      </div>
    </NativeLeagueWorkspace>
  )
}
