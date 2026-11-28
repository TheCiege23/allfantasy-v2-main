/**
 * Last words on the Chop page: the chopped manager's own box, and where the league reads the messages (the chop
 * moment and the Graveyard). The rules are tested in lastWords.test.ts and lastWordsStore.test.ts.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GuillotineLastWords } from '@/components/guillotine/GuillotineLastWords'
import { GuillySurvivalBoard } from '@/components/guillotine/GuillySurvivalBoard'
import { GuillotineChopMoment } from '@/components/guillotine/GuillotineSpecialtyHome'
import { boardFromNativeSummary } from '@/lib/guillotine/survivalBoardModel'
import type { LastWordsState } from '@/lib/guillotine/lastWordsStore'

vi.mock('@/components/scenario-explainer/WhatDoINeed', () => ({ ChopExplainerBlock: () => null }))

const state = (mine: LastWordsState['mine'], entries: LastWordsState['entries'] = []): LastWordsState => ({ entries, mine })

function mountBox(initial: LastWordsState | null, answer?: (body: { action: string; text: string }) => { status: number; body: Record<string, unknown> }) {
  const posts: Array<{ action: string; text: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { action: string; text: string }
    posts.push(body)
    const a = answer?.(body) ?? { status: 200, body: { ok: true, lastWords: state({ week: 5, text: body.text, window: 'open' }, [{ rosterId: 'me', week: 5, text: body.text }]) } }
    return { ok: a.status < 400, json: async () => a.body }
  }))
  const onSaved = vi.fn()
  render(<GuillotineLastWords leagueId="L" state={initial} onSaved={onSaved} />)
  return { posts, onSaved }
}
const type = (text: string) => fireEvent.change(screen.getByTestId('guillotine-last-words-input'), { target: { value: text } })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("the chopped manager's box", () => {
  it('is not drawn for a manager who is still alive, or when the state could not be read', () => {
    mountBox(state(null, [{ rosterId: 'x', week: 4, text: 'bye' }]))
    expect(screen.queryByTestId('guillotine-last-words')).toBeNull()
    cleanup()
    mountBox(null)
    expect(screen.queryByTestId('guillotine-last-words')).toBeNull()
  })

  it('asks for one line, counts it down, and sends it', async () => {
    const { posts, onSaved } = mountBox(state({ week: 5, text: null, window: 'open' }))
    expect(screen.getByTestId('guillotine-last-words').textContent).toContain('You were chopped in week 5')
    expect((screen.getByTestId('guillotine-last-words-save') as HTMLButtonElement).disabled).toBe(true)
    type('I regret nothing.')
    expect(screen.getByTestId('guillotine-last-words-left').textContent).toBe('183 left')
    fireEvent.click(screen.getByTestId('guillotine-last-words-save'))
    await waitFor(() => expect(screen.getByTestId('guillotine-last-words-mine')).toBeTruthy())
    expect(posts).toEqual([{ action: 'last_words', text: 'I regret nothing.' }])
    expect(screen.getByTestId('guillotine-last-words-mine').textContent).toBe('“I regret nothing.”')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('will not send a message over the limit, and says by how much', () => {
    mountBox(state({ week: 5, text: null, window: 'open' }))
    type('a'.repeat(203))
    expect(screen.getByTestId('guillotine-last-words-left').textContent).toBe('3 over')
    expect((screen.getByTestId('guillotine-last-words-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the server's refusal and keeps what was typed", async () => {
    mountBox(state({ week: 5, text: null, window: 'open' }), () => ({ status: 400, body: { error: 'Keep it clean: the whole league reads this.', code: 'not_clean' } }))
    type('something rude')
    fireEvent.click(screen.getByTestId('guillotine-last-words-save'))
    await waitFor(() => expect(screen.getByTestId('guillotine-last-words-error')).toBeTruthy())
    expect(screen.getByTestId('guillotine-last-words-error').textContent).toBe('Keep it clean: the whole league reads this.')
    expect((screen.getByTestId('guillotine-last-words-input') as HTMLTextAreaElement).value).toBe('something rude')
  })

  it('a written message can be changed while the window is open', async () => {
    const { posts } = mountBox(state({ week: 5, text: 'frist draft', window: 'open' }))
    expect(screen.getByTestId('guillotine-last-words-mine').textContent).toBe('“frist draft”')
    fireEvent.click(screen.getByTestId('guillotine-last-words-edit'))
    expect((screen.getByTestId('guillotine-last-words-input') as HTMLTextAreaElement).value).toBe('frist draft')
    // Unchanged text is not worth a request.
    expect((screen.getByTestId('guillotine-last-words-save') as HTMLButtonElement).disabled).toBe(true)
    type('first draft')
    fireEvent.click(screen.getByTestId('guillotine-last-words-save'))
    await waitFor(() => expect(posts).toEqual([{ action: 'last_words', text: 'first draft' }]))
  })

  it('once a later team is chopped it is shown and can no longer be changed', () => {
    mountBox(state({ week: 5, text: 'so long', window: 'closed' }))
    expect(screen.getByTestId('guillotine-last-words-mine').textContent).toBe('“so long”')
    expect(screen.queryByTestId('guillotine-last-words-edit')).toBeNull()
    expect(screen.getByTestId('guillotine-last-words-closed').textContent).toMatch(/can no longer be changed/)
  })

  it('says so when the commissioner removed it, and offers no box', () => {
    mountBox(state({ week: 5, text: null, window: 'removed' }))
    expect(screen.getByTestId('guillotine-last-words-removed').textContent).toBe('The commissioner removed your last words.')
    expect(screen.queryByTestId('guillotine-last-words-input')).toBeNull()
  })
})

describe('where the league reads them', () => {
  const summary = (lastWords: Array<{ rosterId: string; text: string }>) => ({
    weekOrPeriod: 6,
    myRosterId: 'r1',
    dangerTiers: [
      { rosterId: 'r1', displayName: 'Axes', tier: 'safe', pointsFromChopZone: 20 },
      { rosterId: 'r2', displayName: 'Blades', tier: 'chop_zone', pointsFromChopZone: 0 },
    ],
    home: { scores: { r1: 100, r2: 80 }, chopped: [{ rosterId: 'r8', name: 'Cleavers', week: 4, points: 70 }, { rosterId: 'r9', name: 'Daggers', week: 5, points: 60 }] },
    lastWords: { entries: lastWords },
  })

  it('the Graveyard lists each message under its team, newest chop first', () => {
    render(<GuillySurvivalBoard board={boardFromNativeSummary(summary([{ rosterId: 'r8', text: 'robbed' }, { rosterId: 'r9', text: 'gg all' }]))} />)
    const items = [...screen.getByTestId('gsb-last-words').querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual(['Daggers · week 5“gg all”', 'Cleavers · week 4“robbed”'])
  })

  it('draws no list when nobody left a message', () => {
    render(<GuillySurvivalBoard board={boardFromNativeSummary(summary([]))} />)
    expect(screen.getByTestId('gsb-graveyard')).toBeTruthy()
    expect(screen.queryByTestId('gsb-last-words')).toBeNull()
  })

  it('masks a word the chat would mask, in case one was stored before the rule', () => {
    render(<GuillySurvivalBoard board={boardFromNativeSummary(summary([{ rosterId: 'r9', text: 'well shit' }]))} />)
    expect(screen.getByTestId('gsb-last-words-r9').textContent).not.toContain('shit')
  })

  it('only the commissioner gets a Remove button, and it names the team', () => {
    const board = boardFromNativeSummary(summary([{ rosterId: 'r9', text: 'gg all' }]))
    const { unmount } = render(<GuillySurvivalBoard board={board} />)
    expect(screen.queryByTestId('gsb-last-words-remove-r9')).toBeNull()
    unmount()
    const onRemove = vi.fn()
    render(<GuillySurvivalBoard board={board} onRemoveLastWords={onRemove} />)
    fireEvent.click(screen.getByTestId('gsb-last-words-remove-r9'))
    expect(onRemove).toHaveBeenCalledWith('r9')
  })

  it('the chop moment ends on the chopped team’s last words, after the blade drops', () => {
    const lastChop = {
      week: 5,
      bottom: [{ rosterId: 'r3', name: 'Edges', points: 90 }, { rosterId: 'r4', name: 'Forks', points: 85 }, { rosterId: 'r9', name: 'Daggers', points: 60 }],
      choppedRosterIds: ['r9'],
      releases: [],
    }
    render(<GuillotineChopMoment leagueId="L" lastChop={lastChop} aliveCount={10} lastWords={[{ rosterId: 'r9', text: 'gg all' }]} />)
    // Armed: the message is the end of the moment, not a spoiler above it.
    expect(screen.queryByTestId('guillotine-chop-last-words-r9')).toBeNull()
    fireEvent.click(screen.getByTestId('guillotine-drop-blade'))
    expect(screen.getByTestId('guillotine-chop-last-words-r9').textContent).toBe('“gg all” Daggers’s last words')
  })
})
