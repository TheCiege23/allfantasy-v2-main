/**
 * One league's Draft HQ guide (2026-11-13): the headline that says where you stand, and a page ordered
 * by where the draft is — with the "not available" sections left out.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import DraftHq from '@/components/core-app/screens/DraftHq'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import { importedDraftHeadline, leagueDraftHeadline, leagueDraftPhase } from '@/lib/core-app/draftHqLeagueGuide'
import { draftHqLeagueGuideMessages } from '@/lib/core-app/messages/draftHqLeagueGuide'

afterEach(cleanup)

const held = [
  { overall: 4, label: '1.04' },
  { overall: 21, label: '2.09' },
  { overall: 28, label: '3.04' },
]
const base = { status: 'in_progress', yoursOnClock: false, currentPickOverall: 25, totalPicks: 180, held, yourSlot: 4, teamCount: 12, drafted: 2 }

describe('leagueDraftHeadline', () => {
  it('running: the pick on the clock, and your next one with how far away it is', () => {
    expect(leagueDraftHeadline(base)).toEqual({ kind: 'live', pick: 25, total: 180, next: '3.04', away: 3 })
    expect(leagueDraftHeadline({ ...base, currentPickOverall: 30 })).toMatchObject({ kind: 'live', next: null })
  })

  it('your pick, named when the inventory agrees which one it is', () => {
    expect(leagueDraftHeadline({ ...base, yoursOnClock: true, currentPickOverall: 28 })).toEqual({ kind: 'yourPick', label: '3.04' })
    expect(leagueDraftHeadline({ ...base, yoursOnClock: true, currentPickOverall: 27 })).toEqual({ kind: 'yourPick', label: null })
  })

  it('paused, before and done', () => {
    expect(leagueDraftHeadline({ ...base, status: 'paused', yoursOnClock: true })).toEqual({ kind: 'paused', yours: true, next: '3.04' })
    expect(leagueDraftHeadline({ ...base, status: 'pre_draft', currentPickOverall: null })).toEqual({ kind: 'before', slot: 4, teams: 12 })
    expect(leagueDraftHeadline({ ...base, status: 'completed' })).toEqual({ kind: 'done', drafted: 2 })
    expect(leagueDraftHeadline({ ...base, status: null })).toEqual({ kind: 'none' })
  })

  it('reads every status vocabulary the two sources use', () => {
    expect(['in_progress', 'drafting', 'paused', 'complete', 'completed', 'pre_draft'].map(leagueDraftPhase)).toEqual(['live', 'live', 'paused', 'done', 'done', 'before'])
  })

  it('an imported draft: drafting, done, not started, or the raw status', () => {
    expect(importedDraftHeadline({ status: 'drafting', season: 2026 }, 38)).toEqual({ kind: 'drafting', picks: 38 })
    expect(importedDraftHeadline({ status: 'complete', season: 2025 }, 168)).toEqual({ kind: 'done', picks: 168, season: 2025 })
    expect(importedDraftHeadline({ status: 'pre_draft', season: 2026 }, 0)).toEqual({ kind: 'before' })
    expect(importedDraftHeadline({ status: 'post_draft_v2', season: 2026 }, 0)).toEqual({ kind: 'other', status: 'post_draft_v2' })
  })
})

describe('league Draft HQ copy', () => {
  const en = draftHqLeagueGuideMessages.en
  it('says it in plain words', () => {
    expect(en.headLive(25, 180, '3.04', 3)).toBe('Pick 25 of 180 · your next pick is 3.04 (3 picks away)')
    expect(en.headYourPick('3.04')).toBe('You’re on the clock — pick 3.04')
    expect(en.headPaused(true, null)).toBe('Paused — it’s your pick when it resumes')
    expect(en.headBefore(1, 12)).toBe('Not started · you pick 1st of 12')
    expect(en.headDone(15)).toBe('Draft done · you drafted 15 players')
    expect(en.picksSummary(15, ['1.01', '2.12', '3.01', '4.12', '5.01', '6.12', '7.01'])).toBe('15 picks · 1.01, 2.12, 3.01, 4.12, 5.01, 6.12 +9 more')
  })

  it('has Spanish for every key and never says «waiver»', () => {
    const es = draftHqLeagueGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})

const missing = (reason: string) => ({ available: false as const, reason })
function data(status: string, over: Partial<DraftHqData> = {}): DraftHqData {
  return {
    league: { id: 'lg-1', name: 'Sample League', platform: 'allfantasy', format: 'redraft' },
    session: { available: true, data: { status, draftType: 'snake', rounds: 15, teamCount: 12, yourSlot: 4 } },
    pickSlots: { available: true, data: { held: held.map((p, i) => ({ ...p, round: i + 1, pickInRound: 4, acquiredFrom: null })), tradedAway: [], note: null } },
    madePicks: missing('this draft has not run yet'),
    board: missing('choose a completed draft in the archive to review its selections'),
    grades: missing('analysis requires data bound to this individual draft'),
    lottery: missing('a weighted draft lottery only applies to dynasty leagues, and this one is not'),
    queue: missing('you have not queued any players for this draft yet'),
    keepers: missing('this draft has no keepers set up'),
    ...over,
  } as DraftHqData
}
const BOARD = <div data-testid="live-board">board</div>

describe('DraftHq ordered by the draft', () => {
  it('before: the headline is the one h1, the board is folded, and the not-available sections are gone', () => {
    render(<DraftHq data={data('pre_draft')} board={BOARD} />)
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Not started · you pick 4th of 12')
    expect(screen.getByTestId('draft-hq-board-fold').hasAttribute('open')).toBe(false)
    const text = document.body.textContent ?? ''
    for (const gone of ['this draft has not run yet', 'choose a completed draft', 'analysis requires data', 'only applies to dynasty']) {
      expect(text).not.toContain(gone)
    }
    expect(text).toContain('Grades, the full board and your results show here once the draft is done.')
    expect(screen.getByTestId('draft-hq-picks-summary').textContent).toBe('3 picks · 1.04, 2.09, 3.04')
  })

  it('during: the board leads, open, right under the headline', () => {
    render(
      <DraftHq
        data={data('in_progress')}
        board={BOARD}
        live={{ picksMade: 24, totalPicks: 180, currentPickOverall: 25, yoursOnClock: false }}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pick 25 of 180 · your next pick is 3.04 (3 picks away)')
    expect(screen.queryByTestId('draft-hq-board-fold')).toBeNull()
    const order = [...document.querySelectorAll('h1, [data-testid="live-board"], [data-testid="draft-hq-picks-summary"]')].map(
      (e) => e.tagName === 'H1' ? 'h1' : e.getAttribute('data-testid'),
    )
    expect(order).toEqual(['h1', 'live-board', 'draft-hq-picks-summary'])
  })

  it('after: what you drafted leads; picks, queue and the later line are gone', () => {
    render(
      <DraftHq
        data={data('completed', {
          madePicks: { available: true, data: [{ overall: 4, round: 1, label: '1.04', playerName: 'Sample Back', position: 'RB', team: 'DET', imageUrl: null }] },
        })}
        board={BOARD}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draft done · you drafted 1 player')
    const text = document.body.textContent ?? ''
    expect(text).toContain('What you drafted')
    expect(screen.queryByTestId('draft-hq-picks-summary')).toBeNull()
    expect(text).not.toContain('Prepared queue')
    expect(text).not.toContain('once the draft is done')
    expect(screen.getByTestId('draft-hq-board-fold').querySelector('summary')?.textContent).toBe('See the full board')
  })
})
