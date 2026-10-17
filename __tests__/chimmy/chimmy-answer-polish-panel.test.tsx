import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * Answer polish on the real Chimmy panel — the one component behind both the /core drawer and the
 * full-page /chimmy/chat — plus the private @chimmy reply in league chat (`ChatMessageList`).
 *
 * ⚠ TWO HALVES, ON PURPOSE. A component test alone would pass with the panel's wiring deleted (the
 * drawer once dropped every field but four at the JSON parse). So these drive the page: POST an
 * answer whose `meta` carries the polish, and read what the reader sees.
 *
 * 🛑 AND ONE CASE WHERE THE PROSE SAYS "HOLD" AND NOTHING ELSE DOES. No chip. The chip is the one
 * part of an answer the model cannot have written, so text must never be able to produce it.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/chimmy/chat',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))

import { ChimmyChatPageClient } from '@/app/chimmy/chat/ChimmyChatPageClient'
import { ChatMessageList, type ChatListMessage } from '@/components/core-app/comms/ChatMessageList'

const LEAGUES = [{ id: 'L1', name: 'Test Guillotine', platform: 'sleeper', platformLeagueId: '99', isCommissioner: false, teamCount: 12 }]
const GROUNDING = { grounded: true, leagueId: 'L1', leagueName: 'Test Guillotine', platform: 'sleeper', season: 2026, lastSyncedAt: null }

const SAVE_CARD = { version: 1, leagueName: 'Test Guillotine', outcome: 'save', elimination: true, remaining: 150, seasonBudget: 200,
  lineupAssumed: false, valuesAsOf: '2026-09-28', bids: [], moreCount: 0, nonUpgrades: 0, pricedCount: 41, waiverLink: null }
const BID_CARD = { version: 1, leagueName: 'Test Guillotine', outcome: 'bid', elimination: true, remaining: 150, seasonBudget: 200,
  lineupAssumed: false, valuesAsOf: '2026-09-28',
  bids: [
    { name: 'Casey Runner', position: 'RB', ceiling: 31, sharePct: 62, displacedName: 'Jordan Slow' },
    { name: 'Riley Deep', position: 'WR', ceiling: 12, sharePct: 38, displacedName: null },
  ],
  moreCount: 0, nonUpgrades: 5, pricedCount: 41,
  waiverLink: { href: 'https://sleeper.com/leagues/99/players', label: 'Open waivers on Sleeper' } }

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let answers: unknown[] = []
/* What `GET /api/chat/chimmy` returns — the stored transcript a new tab hydrates from. */
let historyTurns: unknown[] = []
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  answers = []
  historyTurns = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.startsWith('/api/chat/chimmy?') && method === 'GET') return json({ turns: historyTurns })
    if (url === '/api/chat/chimmy' && method === 'POST') return json(answers.shift() ?? { response: 'No answer queued.' })
    return json({})
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function ask(question: string, answerText: string) {
  const box = screen.getByLabelText('Message') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: question } })
  fireEvent.submit(box.closest('form')!)
  return (await screen.findByText(answerText)).closest('.af-cm-turn') as HTMLElement
}

describe('the Chimmy panel shows the engine\'s call above the prose', () => {
  it('HOLD then BID for one league: chip, card, and the older answer points at the newer one', async () => {
    render(<ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} leagueId="L1" />)

    answers.push({ response: 'Keep your powder dry this week.', meta: {
      leagueGrounding: GROUNDING, toolsUsed: ['get_faab_bid_plan'],
      verdict: { key: 'hold', source: 'faab_plan', detail: 'Save your FAAB' }, faabPlan: SAVE_CARD, answerKeys: ['get_faab_bid_plan:L1'] } })
    const first = await ask('Should I spend FAAB this week?', 'Keep your powder dry this week.')
    expect(within(first).getByTestId('chimmy-verdict').textContent).toBe('HOLDSave your FAAB')
    expect(within(first).getByTestId('chimmy-faab-card').textContent).toContain('none of the 41 valued unrostered players')
    // Alone in the thread, nothing is newer.
    expect(within(first).queryByTestId('chimmy-newer-answer')).toBeNull()

    answers.push({ response: 'I owe you a correction: bid on Casey Runner.', meta: {
      leagueGrounding: GROUNDING, toolsUsed: ['get_faab_bid_plan'],
      verdict: { key: 'bid', source: 'faab_plan', detail: null }, faabPlan: BID_CARD, answerKeys: ['get_faab_bid_plan:L1'] } })
    const second = await ask('Check again?', 'I owe you a correction: bid on Casey Runner.')

    expect(within(second).getByTestId('chimmy-verdict').textContent).toBe('BID')
    const card = within(second).getByTestId('chimmy-faab-card')
    expect(card.textContent).toContain('$150 left of $200')
    expect(card.textContent).toContain('bid up to $31')
    expect(card.textContent).toContain('benches Jordan Slow')
    expect(card.textContent).toContain('fills an empty starting seat')
    expect(within(card).getByRole('link', { name: /Open waivers on Sleeper/ }).getAttribute('href')).toBe('https://sleeper.com/leagues/99/players')
    expect(within(second).queryByTestId('chimmy-newer-answer')).toBeNull()

    const firstNow = screen.getByText('Keep your powder dry this week.').closest('.af-cm-turn') as HTMLElement
    const tag = within(firstNow).getByTestId('chimmy-newer-answer')
    fireEvent.click(tag)
    const scrolled = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts ?? []
    expect(scrolled).toContain(second)
  })

  it('an answer whose prose says HOLD, with no engine verdict, gets no chip and no card', async () => {
    render(<ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} leagueId="L1" />)
    answers.push({ response: 'HOLD. Save your FAAB; nobody out there helps you.', meta: { leagueGrounding: GROUNDING, toolsUsed: ['get_available_players'] } })
    const turn = await ask('Anyone worth a claim?', 'HOLD. Save your FAAB; nobody out there helps you.')
    expect(within(turn).queryByTestId('chimmy-verdict')).toBeNull()
    expect(within(turn).queryByTestId('chimmy-faab-card')).toBeNull()
  })

  it('a decision-engine answer carries its chip inside meta.decision', async () => {
    render(<ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} leagueId="L1" />)
    answers.push({ response: 'Start Casey Runner.\nWeek 4, 2026.', source: 'chimmy_decision_engine', meta: { leagueGrounding: GROUNDING,
      decision: { version: 1, kind: 'lineup', status: 'ready', verdict: { key: 'start', source: 'lineup_engine', detail: 'Casey Runner' } } } })
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Start Casey Runner or Riley Deep?' } })
    fireEvent.submit(box.closest('form')!)
    await waitFor(() => expect(screen.getByTestId('chimmy-verdict').textContent).toBe('STARTCasey Runner'))
  })

  /*
   * SAFE / OUT (2026-09-28): a guillotine week that is DECIDED, from the settle verdict the matchup
   * tool read. Good news in the good tone, bad news in the bad one — colour AND words.
   */
  it('a decided guillotine week reads SAFE in the good tone, and OUT in the bad one', async () => {
    render(<ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} leagueId="L1" />)
    answers.push({ response: 'You cannot be chopped this week.', meta: { leagueGrounding: GROUNDING, toolsUsed: ['get_my_matchup'],
      verdict: { key: 'safe', source: 'elimination_settle', detail: 'Week decided' } } })
    const safe = within(await ask('Am I safe this week?', 'You cannot be chopped this week.')).getByTestId('chimmy-verdict')
    expect(safe.textContent).toBe('SAFEWeek decided')
    expect(safe.getAttribute('data-tone')).toBe('go')
    expect(safe.getAttribute('title')).toMatch(/finished games/)

    answers.push({ response: 'Every team has finished and yours is lowest.', meta: { leagueGrounding: GROUNDING, toolsUsed: ['get_my_matchup'],
      verdict: { key: 'out', source: 'elimination_settle', detail: 'Week decided' } } })
    const out = within(await ask('What about now?', 'Every team has finished and yours is lowest.')).getByTestId('chimmy-verdict')
    expect(out.textContent).toBe('OUTWeek decided')
    expect(out.getAttribute('data-tone')).toBe('stop')
  })
})

/*
 * Tool-loop answers are now written to chat history with their polish (2026-09-28), and the history
 * read hands it back. A NEW tab has no sessionStorage, so what renders here came from the server.
 */
describe('a new tab rebuilds the polish from the stored transcript', () => {
  it('the chip, the bid card and "Newer answer below" all come back', async () => {
    historyTurns = [
      { id: 'hist-0', role: 'you', text: 'Should I spend FAAB this week?', leagueId: 'L1' },
      { id: 'hist-1', role: 'chimmy', text: 'Keep your powder dry this week.', leagueId: 'L1', grounding: GROUNDING,
        verdict: { key: 'hold', source: 'faab_plan', detail: 'Save your FAAB' }, faabPlan: SAVE_CARD, answerKeys: ['get_faab_bid_plan:L1'] },
      { id: 'hist-2', role: 'you', text: 'Check again?', leagueId: 'L1' },
      { id: 'hist-3', role: 'chimmy', text: 'You are safe, and bid on Casey Runner.', leagueId: 'L1', grounding: GROUNDING,
        verdict: { key: 'safe', source: 'elimination_settle', detail: 'Week decided' }, faabPlan: BID_CARD, answerKeys: ['get_faab_bid_plan:L1'] },
    ]
    render(<ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} leagueId="L1" />)

    const older = (await screen.findByText('Keep your powder dry this week.')).closest('.af-cm-turn') as HTMLElement
    const newer = screen.getByText('You are safe, and bid on Casey Runner.').closest('.af-cm-turn') as HTMLElement
    expect(within(older).getByTestId('chimmy-verdict').textContent).toBe('HOLDSave your FAAB')
    expect(within(older).getByTestId('chimmy-faab-card')).toBeTruthy()
    expect(within(older).getByTestId('chimmy-newer-answer')).toBeTruthy()
    expect(within(newer).getByTestId('chimmy-verdict').textContent).toBe('SAFEWeek decided')
    expect(within(newer).getByTestId('chimmy-faab-card').textContent).toContain('bid up to $31')
    expect(within(newer).queryByTestId('chimmy-newer-answer')).toBeNull()
  })
})

describe('a private @chimmy reply in league chat', () => {
  const T = new Date(Date.UTC(2026, 8, 28, 14, 0)).toISOString()
  const row = (over: Partial<ChatListMessage>): ChatListMessage => ({
    id: 'm1', authorId: 'owner', authorName: 'Chimmy', avatarUrl: null, body: 'Start Casey Runner.', createdAt: T,
    parentMessageId: null, messageType: 'system', metadata: null, ...over,
  })
  const list = (messages: ChatListMessage[]) => render(
    <ChatMessageList messages={messages} viewerId="me" label="League chat" reactionsFor={() => []}
      onToggleReaction={vi.fn()} onReply={vi.fn()} renderRich={() => null} nameForUserId={() => null} />,
  )

  it('shows the verdict the decision engine stored on the message', () => {
    list([row({ metadata: { chimmyPrivateReply: true, decision: { status: 'ready', verdict: { key: 'start', source: 'lineup_engine', detail: 'Casey Runner' } } } })])
    expect(screen.getByTestId('chimmy-verdict').textContent).toBe('STARTCasey Runner')
  })

  it('shows nothing for a member\'s message carrying the same metadata — only Chimmy-marked rows', () => {
    list([row({ authorId: 'sam', authorName: 'Sam', metadata: { decision: { status: 'ready', verdict: { key: 'start', source: 'lineup_engine', detail: 'X' } } } })])
    expect(screen.queryByTestId('chimmy-verdict')).toBeNull()
  })
})
