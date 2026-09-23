import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import Matchup from '@/components/core-app/screens/Matchup'
import { LeagueChatBar } from '@/components/core-app/LeagueChatBar'
import { ChimmyMovesCard } from '@/components/core-app/ChimmyMovesCard'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { composeChimmyMoves } from '@/lib/core-app/chimmyMoves'
import { pickLeagueChatPreview } from '@/lib/core-app/leagueChatPreviewPick'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { MatchupData } from '@/lib/core-app/matchup'
import type { PlatformChatMessage } from '@/types/platform-shared'

afterEach(cleanup)

function captureComms() {
  const seen: unknown[] = []
  const on = (e: Event) => seen.push((e as CustomEvent).detail)
  window.addEventListener(COMMS_OPEN_EVENT, on)
  return { seen, stop: () => window.removeEventListener(COMMS_OPEN_EVENT, on) }
}

// ── Chat preview ────────────────────────────────────────────────────────────
function msg(over: Partial<PlatformChatMessage>): PlatformChatMessage {
  return {
    id: Math.random().toString(36),
    threadId: 't',
    senderUserId: 'u',
    senderName: 'Rob',
    messageType: 'text',
    body: 'hello',
    createdAt: '2026-09-20T12:00:00Z',
    ...over,
  }
}

describe('pickLeagueChatPreview', () => {
  it('takes the newest message, collapsed to one line', () => {
    const p = pickLeagueChatPreview([msg({ body: 'old' }), msg({ senderName: 'Kay', body: 'trade me\n  your WR1' })])
    expect(p).toEqual({ senderName: 'Kay', text: 'trade me your WR1', createdAt: '2026-09-20T12:00:00Z' })
  })
  it('skips pins, whose body is JSON, and names other structured rows by type', () => {
    expect(pickLeagueChatPreview([msg({ body: 'real' }), msg({ messageType: 'pin', body: '{"messageId":"x"}' })])?.text).toBe('real')
    expect(pickLeagueChatPreview([msg({ messageType: 'trade_card', body: '{"a":1}' })])?.text).toBe('shared a trade card')
  })
  it('truncates a long message and is null for an empty chat', () => {
    expect(pickLeagueChatPreview([msg({ body: 'x'.repeat(200) })])!.text.length).toBe(90)
    expect(pickLeagueChatPreview([])).toBeNull()
  })
})

// ── Chat bar ────────────────────────────────────────────────────────────────
describe('LeagueChatBar', () => {
  it('shows the newest line and opens THIS league’s chat, by id', () => {
    const c = captureComms()
    render(<LeagueChatBar leagueId="L9" leagueName="Sunday Sweat" preview={{ senderName: 'Kay', text: 'gg', createdAt: 'x' }} />)
    const bar = screen.getByRole('button', { name: 'Open Sunday Sweat chat' })
    expect(bar.textContent).toContain('Kay:')
    expect(bar.textContent).toContain('gg')
    fireEvent.click(bar)
    expect(c.seen).toEqual([{ tab: 'league', leagueId: 'L9' }])
    c.stop()
  })
  it('opens on a pull up, and invites a first message when the chat is empty', () => {
    const c = captureComms()
    render(<LeagueChatBar leagueId="L9" leagueName={null} preview={null} />)
    const bar = screen.getByRole('button', { name: 'Open league chat' })
    expect(bar.textContent).toContain('say something to the league')
    fireEvent.touchStart(bar, { touches: [{ clientY: 700 }] })
    fireEvent.touchEnd(bar, { changedTouches: [{ clientY: 640 }] })
    expect(c.seen).toHaveLength(1)
    c.stop()
  })
})

// ── Chimmy's moves ──────────────────────────────────────────────────────────
function row(over: Partial<TriageRow> & { name: string; id: string }): TriageRow {
  return {
    player: { sport: 'NFL', externalId: over.id, sleeperId: over.id, name: over.name, position: 'WR', team: 'KC', imageUrl: null },
    status: { label: 'Out', tone: 'bad' },
    description: null,
    reportedAt: null,
    leagues: [{ leagueId: 'L1', leagueName: 'Sunday Sweat', platform: 'sleeper' }],
    kickoff: '2026-09-27T17:00:00Z',
    noGame: false,
    inactive: null,
    bye: false,
    ...over,
  }
}
const NOW = '2026-09-25T12:00:00Z'
const triage = (rows: TriageRow[], startersRead = 9): GameDayTriage => ({ rows, week: { season: 2026, week: 4 }, leaguesRead: 1, startersRead })

describe('composeChimmyMoves', () => {
  it('turns flagged starters in THIS league into moves with a real target and an unsent question', () => {
    const out = composeChimmyMoves({
      triage: triage([
        row({ id: '101', name: 'Out Guy' }),
        row({ id: '102', name: 'Q Guy', status: { label: 'Questionable', tone: 'warn' } }),
        row({ id: '103', name: 'Other League', leagues: [{ leagueId: 'L2', leagueName: 'X', platform: 'sleeper' }] }),
      ]),
      leagueId: 'L1',
      leagueName: 'Sunday Sweat',
      nowIso: NOW,
    })
    expect(out.moves.map((m) => m.title)).toEqual(['Bench Out Guy', 'Check Q Guy'])
    expect(out.moves[0].href).toBe('/core/my-team?league=L1#lineup-player-101')
    expect(out.moves[0].tone).toBe('bad')
    expect(out.moves[0].ask).toContain('Who should I start instead in Sunday Sweat')
    expect(out.moves[1].tone).toBe('warn')
  })
  it('never offers a move for a starter whose game has kicked off', () => {
    const out = composeChimmyMoves({
      triage: triage([row({ id: '1', name: 'Locked', kickoff: '2026-09-25T11:00:00Z' })]),
      leagueId: 'L1',
      leagueName: 'S',
      nowIso: NOW,
    })
    expect(out.moves).toEqual([])
  })
  it('names a bye as a bye and caps the card at three', () => {
    const rows = [row({ id: 'b', name: 'Bye Guy', status: null, noGame: true, bye: true, kickoff: null })]
    for (let i = 0; i < 5; i++) rows.push(row({ id: `x${i}`, name: `P${i}` }))
    const out = composeChimmyMoves({ triage: triage(rows), leagueId: 'L1', leagueName: 'S', nowIso: NOW })
    expect(out.moves).toHaveLength(3)
    expect(out.moves[0].detail).toMatch(/^On bye/)
  })
})

describe('ChimmyMovesCard', () => {
  it('pairs each move with its fix link and an Ask Chimmy tap that prefills, never sends', () => {
    const c = captureComms()
    const data = composeChimmyMoves({ triage: triage([row({ id: '101', name: 'Out Guy' })]), leagueId: 'L1', leagueName: 'Sunday Sweat', nowIso: NOW })
    render(<ChimmyMovesCard data={data} leagueName="Sunday Sweat" />)
    expect(screen.getByRole('link', { name: 'Fix lineup' }).getAttribute('href')).toBe('/core/my-team?league=L1#lineup-player-101')
    fireEvent.click(screen.getByRole('button', { name: 'Ask Chimmy about Out Guy' }))
    expect(c.seen).toEqual([{ tab: 'chimmy', prefill: data.moves[0].ask }])
    c.stop()
  })
  it('only claims a clear lineup when it read one', () => {
    const clear = composeChimmyMoves({ triage: triage([], 9), leagueId: 'L1', leagueName: 'S', nowIso: NOW })
    const unread = composeChimmyMoves({ triage: triage([], 0), leagueId: 'L1', leagueName: 'S', nowIso: NOW })
    const { rerender } = render(<ChimmyMovesCard data={clear} leagueName="S" />)
    expect(screen.getByText('No injured or idle starters in S.')).toBeTruthy()
    rerender(<ChimmyMovesCard data={unread} leagueName="S" />)
    expect(screen.queryByText(/No injured/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Start/sit check' })).toBeTruthy()
  })
})

// ── Matchup week state ──────────────────────────────────────────────────────
function matchup(over: Partial<MatchupData> = {}): MatchupData {
  return {
    league: { id: 'l1', name: 'League', platform: 'sleeper', logoUrl: null, sourceLink: null, lineupLink: null },
    week: { available: true, data: { week: 4, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: { teamName: 'A', ownerName: 'a', record: '0-0', isYou: true, avatarUrl: null },
        opponent: { teamName: 'B', ownerName: 'b', record: '0-0', isYou: false, avatarUrl: null },
      },
    },
    sides: { available: false, reason: 'unplayed' },
    lineups: { available: false, reason: 'no lineups' },
    identityNote: null,
    playerScoring: { available: false, reason: 'none' },
    winProbability: { available: false, reason: 'none' },
    projectedFinal: { available: false, reason: 'none' },
    yetToPlay: { available: false, reason: 'none' },
    ...over,
  } as MatchupData
}

describe('Matchup week state', () => {
  it('reads Upcoming before kickoff, never "Not scored"', () => {
    const { container } = render(<Matchup data={matchup()} />)
    const chip = container.querySelector('.af-mu-week-state')!
    expect(chip.textContent).toBe('Upcoming')
    expect(chip.getAttribute('data-state')).toBe('upcoming')
    expect(container.textContent).not.toMatch(/not scored/i)
  })
  it('reads Live once points are on the board, and Final at the end', () => {
    const sides = {
      available: true,
      data: {
        you: { teamName: 'A', ownerName: 'a', record: null, points: 12, isYou: true },
        opponent: { teamName: 'B', ownerName: 'b', record: null, points: 3, isYou: false },
      },
    } as unknown as MatchupData['sides']
    const { container, rerender } = render(<Matchup data={matchup({ sides })} />)
    expect(container.querySelector('.af-mu-week-state')!.textContent).toBe('Live')
    rerender(<Matchup data={matchup({ sides, week: { available: true, data: { week: 4, season: 2026, isFinal: true } } })} />)
    expect(container.querySelector('.af-mu-week-state')!.textContent).toBe('Final')
  })
  it('puts provider hand-offs in their own row, and renders no row for a native league', () => {
    const lineupLink = { href: 'https://sleeper.com/leagues/1/team', platformLabel: 'Sleeper' } as MatchupData['league']['lineupLink']
    const { container, rerender } = render(<Matchup data={matchup({ league: { ...matchup().league, lineupLink } })} />)
    const row = container.querySelector('.af-mu-handoff')!
    expect(row.querySelector('a')!.textContent).toContain('Set lineup in Sleeper')
    expect(container.querySelector('.af-mu-week .af-mu-source')).toBeNull()
    rerender(<Matchup data={matchup()} />)
    expect(container.querySelector('.af-mu-handoff')).toBeNull()
  })
})
