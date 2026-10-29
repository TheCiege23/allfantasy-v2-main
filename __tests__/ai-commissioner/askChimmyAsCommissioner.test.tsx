/**
 * Ask Chimmy as commissioner (lib/ai-commissioner/commissionerDesk.ts): the commissioner's desk —
 * open tasks, this week's checklist, the league office — reaches the answer; the links under it come
 * only from that desk; a cached answer never outlives the desk; and the Hub card shows them in
 * English and Spanish.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({
  insights: vi.fn(),
  ai: vi.fn(),
  cacheRead: vi.fn(),
  cacheWrite: vi.fn(),
  cacheKey: vi.fn(),
  fetch: vi.fn(),
}))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: vi.fn() }))
vi.mock('@/lib/league-chat/chimmyCommissionerNotices', () => ({ commissionerAlertsText: vi.fn() }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: m.ai }))
vi.mock('@/lib/ai-result-cache', () => ({ buildAiCacheKey: m.cacheKey, readAiResultCache: m.cacheRead, writeAiResultCache: m.cacheWrite }))
vi.mock('@/lib/ai-commissioner/LeagueInsightGenerator', () => ({ generateLeagueInsights: m.insights }))
vi.mock('@/lib/tokens/paidToolClient', () => ({ paidToolFetch: m.fetch, approvePaidToolQuote: () => true }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children}</a>
  ),
}))

import {
  buildDeskTasks,
  deskActions,
  deskAnswer,
  deskFingerprint,
  relevantDeskTasks,
  type CommissionerDesk,
  type DeskTask,
} from '@/lib/ai-commissioner/commissionerDesk'
import { answerAICommissionerQuestion } from '@/lib/ai-commissioner/AICommissionerService'
import { CommissionerChimmy } from '@/components/core-app/commissioner/CommissionerChimmy'

const task = (title: string, description: string, href: string, priority: 'critical' | 'elevated' | 'standard' | 'advisory' = 'standard'): DeskTask => ({
  title,
  description,
  action: { label: title, href, priority },
})
const TRADE = task('A trade is waiting on your review', 'Aces and Bees: the review window ends Tuesday.', '/core/trades?league=L')
const CORRECTION = task('A stat correction changes a week 7 result', 'The league office corrected stats after week 7.', '/settings/score-adjustments', 'elevated')
const INACTIVE = task('An inactive team has nobody setting its lineup', 'Cats looks inactive.', '/core/commissioner?league=L#ch-inactive-managers')
const DESK: CommissionerDesk = { office: 'Trade between Aces and Bees: Under commissioner review.', tasks: [TRADE, CORRECTION, INACTIVE] }

describe('which tasks a question is about', () => {
  it('a question about trades gets the trade task, and only its screen', () => {
    const r = relevantDeskTasks('Is anything waiting on me in trades?', DESK.tasks)
    expect(r[0]).toBe(TRADE)
    expect(deskActions(relevantDeskTasks('Should I veto the trade?', DESK.tasks))).toEqual([TRADE.action])
  })

  it('"what needs my attention" gets every task, most urgent first', () => {
    expect(relevantDeskTasks('What needs my attention this week?', DESK.tasks).map((t) => t.title)).toEqual([CORRECTION.title, TRADE.title, INACTIVE.title])
  })

  it('in Spanish too', () => {
    expect(relevantDeskTasks('¿Qué equipos parecen inactivos?', DESK.tasks)[0]).toBe(INACTIVE)
    expect(relevantDeskTasks('¿Qué necesita mi atención esta semana?', DESK.tasks)).toHaveLength(3)
  })

  it('a question about none of them gets no task and no link', () => {
    expect(relevantDeskTasks('Who has the best kicker?', DESK.tasks)).toEqual([])
  })

  it('tasks first, then this week’s to-dos the tasks do not repeat; never the same screen twice', () => {
    const built = buildDeskTasks(
      [{ title: 'T', description: 'd', priority: 'elevated', relatedLinks: [{ label: 'Trades', href: '/x' }] }],
      [
        { status: 'todo', title: { en: 'Trades waiting' }, detail: { en: '1 trade' }, href: '/x' },
        { status: 'todo', title: { en: 'Lineups' }, detail: { en: '2 empty slots' }, href: '/y' },
        { status: 'done', title: { en: 'Scores final' }, detail: { en: 'ok' }, href: '/z' },
      ],
    )
    expect(built.map((t) => t.title)).toEqual(['T', 'Lineups'])
    expect(deskActions([TRADE, { ...TRADE, title: 'again' }])).toHaveLength(1)
    expect(deskAnswer([TRADE])).toBe('On your desk:\n- A trade is waiting on your review: Aces and Bees: the review window ends Tuesday.')
    expect(deskAnswer([])).toBeNull()
  })
})

describe('the answer', () => {
  const INSIGHTS = {
    sport: 'NFL', season: 2026, weeklyRecapPost: { body: 'Week 7 recap.' }, matchupSummaries: [], waiverHighlights: [],
    draftCommentary: [], controversialTrades: [], suggestedRuleAdjustments: [],
  }
  beforeEach(() => {
    vi.clearAllMocks()
    m.insights.mockResolvedValue(INSIGHTS)
    m.cacheKey.mockImplementation((_f: string, inputs: unknown) => ({ resultKey: JSON.stringify(inputs), inputHash: 'h' }))
    m.cacheRead.mockResolvedValue(null)
    m.cacheWrite.mockResolvedValue(undefined)
  })

  it('the model is given the desk, told not to write links, and the links come back beside it', async () => {
    m.ai.mockResolvedValue({ ok: true, text: 'Review the Aces–Bees trade before Tuesday.' })
    const r = await answerAICommissionerQuestion({ leagueId: 'L', question: 'Anything on trades?', desk: DESK })
    expect(r.answer).toBe('Review the Aces–Bees trade before Tuesday.')
    expect(r.actions).toEqual([TRADE.action])
    const call = m.ai.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toMatch(/never write a link or URL yourself/)
    expect(call.messages[0].content).toMatch(/never say an action has been taken/)
    const payload = JSON.parse(call.messages[1].content)
    expect(payload.commissionerDesk.office).toBe(DESK.office)
    expect(payload.commissionerDesk.openTasks).toHaveLength(3)
    expect(payload.commissionerDesk.mostRelevant).toEqual([TRADE.title])
  })

  it('without the model, the template answers from the desk instead of the recap', async () => {
    m.ai.mockResolvedValue(null)
    const r = await answerAICommissionerQuestion({ leagueId: 'L', question: 'What needs my attention?', desk: DESK })
    expect(r.source).toBe('template')
    expect(r.answer).toMatch(/^On your desk:\n- A stat correction changes a week 7 result/)
    // A question the desk has nothing on keeps the old answer.
    const recap = await answerAICommissionerQuestion({ leagueId: 'L', question: 'weekly recap please', desk: DESK })
    expect(recap.answer).toMatch(/^Week 7 recap\./)
    expect(recap.actions).toEqual([])
  })

  it('a cached answer is keyed on the desk, so it is not served once the desk changes', async () => {
    m.ai.mockResolvedValue({ ok: true, text: 'x' })
    await answerAICommissionerQuestion({ leagueId: 'L', question: 'q', desk: DESK })
    await answerAICommissionerQuestion({ leagueId: 'L', question: 'q', desk: { ...DESK, tasks: [INACTIVE] } })
    const [a, b] = m.cacheKey.mock.calls.map((c) => (c[1] as { desk: string }).desk)
    expect(a).toBe(deskFingerprint(DESK))
    expect(a).not.toBe(b)
  })

  it('no desk: as before', async () => {
    m.ai.mockResolvedValue(null)
    const r = await answerAICommissionerQuestion({ leagueId: 'L', question: 'trades?' })
    expect(r.answer).toBe('No controversial trades are currently flagged for this league context.')
    expect(r.actions).toEqual([])
  })
})

describe('the Hub card', () => {
  afterEach(() => {
    cleanup()
    lang.language = 'en'
  })

  it('a starter fills the question; the answer shows the screens to act on', async () => {
    m.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ answer: 'Review the trade.', source: 'ai', actions: [{ label: 'Trades', href: '/core/trades?league=L' }] }),
    })
    render(<CommissionerChimmy leagueId="L" />)
    fireEvent.click(screen.getByText('Is anything waiting on me in trades?'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Is anything waiting on me in trades?')
    fireEvent.click(screen.getByText('Ask Chimmy'))
    const nav = await screen.findByTestId('commissioner-chimmy-actions')
    expect(nav.querySelector('a')!.getAttribute('href')).toBe('/core/trades?league=L')
    expect(JSON.parse((m.fetch.mock.calls[0][1] as { body: string }).body).question).toBe('Is anything waiting on me in trades?')
  })

  it('no links when the answer has none', async () => {
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ answer: 'Nothing pending.', source: 'template' }) })
    render(<CommissionerChimmy leagueId="L" />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    fireEvent.click(screen.getByText('Ask Chimmy'))
    await screen.findByText('Nothing pending.', { exact: false })
    expect(screen.queryByTestId('commissioner-chimmy-actions')).toBeNull()
  })

  it('in Spanish', async () => {
    lang.language = 'es'
    render(<CommissionerChimmy leagueId="L" />)
    expect(screen.getByText('¿Qué necesita mi atención esta semana?')).toBeTruthy()
    expect(screen.getByText(/comisionado adjunto/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('group', { name: 'Preguntas sugeridas' })).toBeTruthy())
  })
})
