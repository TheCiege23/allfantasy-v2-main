/**
 * Jury chamber UI: the Q&A + closing speeches panel and the commissioner's finale controls.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JuryQaPanelView } from '@/components/survivor/late/JuryQaPanel'
import { SurvivorFinaleControls } from '@/components/survivor/SurvivorFinaleControls'
import type { JuryQaView } from '@/lib/survivor/survivorJuryQaService'
import { EMPTY_FINALE_WINDOWS, SURVIVOR_FINALE_DEFAULTS } from '@/lib/survivor/survivorFinaleSettings'

function view(over: Partial<JuryQaView> = {}, viewer: Partial<JuryQaView['viewer']> = {}): JuryQaView {
  return {
    canRead: true,
    settings: { juryQuestionsEnabled: true, closingSpeechesEnabled: true },
    windows: { ...EMPTY_FINALE_WINDOWS, questionState: 'open', answerState: 'open', speechState: 'open', votingHeldForSpeeches: false },
    finaleOpen: true,
    voteComplete: false,
    finalists: [{ rosterId: 'f1', name: 'Ann' }, { rosterId: 'f2', name: 'Bo' }],
    questions: [{ id: 'j1:f1', jurorRosterId: 'j1', finalistRosterId: 'f1', question: 'Why you?', askedAt: '2026-12-20T18:00:00.000Z', answer: 'Because.', answeredAt: '2026-12-20T19:00:00.000Z', seenAt: null, jurorName: 'Cy', finalistName: 'Ann' }],
    speeches: [],
    viewer: { rosterId: 'j1', isJuror: true, isFinalist: false, isHost: false, todo: { questionsToAsk: ['f2'], questionsToAnswer: [], answersToRead: ['j1:f1'], speechMissing: false }, ...viewer },
    ...over,
  }
}

describe('JuryQaPanelView', () => {
  it('a juror asks the finalist they have not asked, and marks an answer seen', () => {
    const onAsk = vi.fn()
    const onSeen = vi.fn()
    render(<JuryQaPanelView qa={view()} handlers={{ onAsk, onSeen }} />)
    expect(screen.queryByTestId('jury-ask-f1')).toBeNull() // already asked Ann
    fireEvent.change(screen.getByTestId('jury-ask-f2'), { target: { value: 'What is your best move?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onAsk).toHaveBeenCalledWith('f2', 'What is your best move?')
    fireEvent.click(screen.getByRole('button', { name: 'Mark as seen' }))
    expect(onSeen).toHaveBeenCalledWith('f1')
  })

  it('a finalist answers and writes a closing speech; no ask box for them', () => {
    const onAnswer = vi.fn()
    const onSpeech = vi.fn()
    render(<JuryQaPanelView qa={view({ questions: [{ ...view().questions[0]!, answer: null, answeredAt: null }] }, { rosterId: 'f1', isJuror: false, isFinalist: true })} handlers={{ onAnswer, onSpeech }} />)
    expect(screen.queryByTestId('jury-ask-f2')).toBeNull()
    fireEvent.change(screen.getByTestId('jury-answer-j1'), { target: { value: 'I scored.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(onAnswer).toHaveBeenCalledWith('j1', 'I scored.')
    fireEvent.change(screen.getByTestId('closing-speech-input'), { target: { value: 'Vote for me.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post closing speech' }))
    expect(onSpeech).toHaveBeenCalledWith('Vote for me.')
  })

  it('someone outside the finale sees neither questions nor speeches before the champion is crowned', () => {
    render(<JuryQaPanelView qa={view({ canRead: false, questions: [], speeches: [] }, { rosterId: 'x', isJuror: false })} />)
    expect(screen.getAllByText(/for the jury and the finalists/)).toHaveLength(2)
    expect(screen.queryByText('Why you?')).toBeNull()
  })

  it('shows who voted for whom only when the ballots are handed to it', () => {
    const { rerender } = render(<JuryQaPanelView qa={view()} ballots={null} />)
    expect(screen.queryByTestId('ballot-reveal')).toBeNull()
    rerender(<JuryQaPanelView qa={view()} ballots={[{ councilId: 'c1', week: 3, councilNumber: 1, phase: 'merge', eliminatedName: 'Cy', ballots: [{ voterName: 'Ann', targetName: 'Cy', counted: true, late: false }] }]} />)
    expect(screen.getByText('Ann voted for Cy')).toBeTruthy()
    expect(screen.getByText('Cy was voted out')).toBeTruthy()
  })
})

describe('SurvivorFinaleControls', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return { ok: true, status: 200, json: async () => ({ settings: SURVIVOR_FINALE_DEFAULTS, windows: EMPTY_FINALE_WINDOWS, juryVoteDeadline: null, councilOpen: false }) }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('saves only the rules that changed', async () => {
    render(<SurvivorFinaleControls leagueId="L1" />)
    await waitFor(() => screen.getByTestId('survivor-finale-controls'))
    fireEvent.click(screen.getByTestId('finale-rule-endOfSeasonBallotReveal'))
    fireEvent.change(screen.getByTestId('finale-rule-votesDue'), { target: { value: '3' } })
    fireEvent.click(screen.getByTestId('finale-save-rules'))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ leagueId: 'L1', action: 'finale_settings', settings: { endOfSeasonBallotReveal: true, votesDueHoursBeforeCeremony: 3 } })
  })

  it('locks sealed immunity and the due time while a council is open', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ settings: SURVIVOR_FINALE_DEFAULTS, windows: EMPTY_FINALE_WINDOWS, juryVoteDeadline: null, councilOpen: true }) }))
    render(<SurvivorFinaleControls leagueId="L1" />)
    await waitFor(() => screen.getByTestId('survivor-finale-controls'))
    expect((screen.getByTestId('finale-rule-sealedImmunity') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('finale-rule-votesDue') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('finale-rule-reunionChatEnabled') as HTMLButtonElement).disabled).toBe(false)
  })
})
