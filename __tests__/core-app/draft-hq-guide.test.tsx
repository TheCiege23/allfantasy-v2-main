/**
 * The cross-league Draft HQ guide (2026-11-13): the one-sentence headline, the grouping that gives a card
 * only to a draft with a clock, and the copy.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/core/draft-hq' }))

import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import { draftHqHeadline, groupDrafts, draftUrgency } from '@/lib/core-app/draftHqGuide'
import { draftHqGuideMessages } from '@/lib/core-app/messages/draftHqGuide'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'

const row = (over: Partial<DraftHqAllRow> & Pick<DraftHqAllRow, 'leagueId' | 'phase'>): DraftHqAllRow => ({
  leagueName: over.leagueId,
  platform: 'sleeper',
  imageUrl: null,
  rawStatus: over.phase === 'live' ? 'in_progress' : over.phase === 'upcoming' ? 'pre_draft' : 'complete',
  draftType: 'snake',
  rounds: 15,
  teamCount: 12,
  yourSlot: 4,
  picksMade: null,
  pickExpiresAt: null,
  onClockName: null,
  yoursOnClock: false,
  currentRound: null,
  nextOverallPick: null,
  queuedCount: 0,
  modeLabel: null,
  startedAt: null,
  ...over,
})
const data = (rows: DraftHqAllRow[]): DraftHqAllData => ({ rows, counts: { live: 0, upcoming: 0, done: 0, unknown: 0 }, withoutDraft: 3 })

describe('draftHqHeadline', () => {
  it('your pick beats everything; a paused one does not count as your pick', () => {
    expect(draftHqHeadline([row({ leagueId: 'B', phase: 'live' }), row({ leagueId: 'A', phase: 'live', yoursOnClock: true })])).toEqual({ kind: 'yourPick', league: 'A', n: 1 })
    expect(draftHqHeadline([row({ leagueId: 'P', phase: 'live', yoursOnClock: true, rawStatus: 'paused' }), row({ leagueId: 'R', phase: 'live' })])).toEqual({ kind: 'running', league: 'R', n: 1, known: true, pausedYours: 'P' })
  })

  it('paused only, then not started, then finished, then nothing', () => {
    expect(draftHqHeadline([row({ leagueId: 'P', phase: 'live', yoursOnClock: true, rawStatus: 'paused' }), row({ leagueId: 'U', phase: 'upcoming' })])).toEqual({ kind: 'paused', league: 'P', n: 1, yours: true })
    expect(draftHqHeadline([row({ leagueId: 'U', phase: 'upcoming' }), row({ leagueId: 'U2', phase: 'upcoming' }), row({ leagueId: 'D', phase: 'done' })])).toEqual({ kind: 'upcoming', n: 2 })
    expect(draftHqHeadline([row({ leagueId: 'D', phase: 'done' })])).toEqual({ kind: 'allDone' })
    expect(draftHqHeadline([])).toEqual({ kind: 'none' })
  })
})

describe('groupDrafts', () => {
  it('cards for drafts with a clock, rows for the rest, most urgent first and capped', () => {
    const rows = [
      row({ leagueId: 'done', phase: 'done' }),
      row({ leagueId: 'up', phase: 'upcoming' }),
      row({ leagueId: 'paused', phase: 'live', rawStatus: 'paused', yoursOnClock: true }),
      row({ leagueId: 'run', phase: 'live' }),
      row({ leagueId: 'mine', phase: 'live', yoursOnClock: true }),
      row({ leagueId: 'odd', phase: 'unknown', rawStatus: 'post_draft_v2' }),
    ]
    const { groups, shown } = groupDrafts(rows, 10)
    expect(shown).toBe(6)
    expect(groups.yourPick.map((r) => r.leagueId)).toEqual(['mine'])
    expect(groups.drafting.map((r) => r.leagueId)).toEqual(['run', 'paused'])
    expect(groups.comingUp.map((r) => r.leagueId)).toEqual(['up', 'odd'])
    expect(groups.finished.map((r) => r.leagueId)).toEqual(['done'])
    expect(groupDrafts(rows, 2).groups.drafting.map((r) => r.leagueId)).toEqual(['run'])
    expect(draftUrgency(rows[2]!)).toBeGreaterThan(draftUrgency(rows[3]!))
  })
})

describe('DraftHqBoard with the guide', () => {
  it('leads with the headline as the page h1 and says the queue note once', () => {
    const rows = [
      row({ leagueId: 'Mine', phase: 'live', yoursOnClock: true }),
      row({ leagueId: 'Other', phase: 'live', onClockName: 'Riley' }),
      row({ leagueId: 'Soon', phase: 'upcoming' }),
      row({ leagueId: 'Later', phase: 'upcoming' }),
    ]
    const { container } = render(<DraftHqBoard data={data(rows)} allHref="/core/draft-hq?all=1" totalLeagues={9} />)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).toBe('You’re on the clock in Mine')
    const text = container.textContent ?? ''
    expect(text.match(/No queue built in AllFantasy/g)).toHaveLength(1)
    expect(text).toContain('Riley is on the clock.')
  })

  it('gives a not-started draft a one-line row with no empty stat boxes', () => {
    const { container } = render(<DraftHqBoard data={data([row({ leagueId: 'Soon', phase: 'upcoming', yourSlot: null })])} allHref="#" totalLeagues={4} />)
    expect(container.querySelectorAll('.af-bd-card')).toHaveLength(0)
    expect(container.querySelectorAll('.af-dh-row')).toHaveLength(1)
    expect(container.querySelector('.af-dh-row')?.textContent).toContain('15 rounds')
    expect(container.textContent ?? '').not.toMatch(/On the clock|Picks made/)
  })

  it('never draws a stat box that would only say "—"', () => {
    const { container } = render(<DraftHqBoard data={data([row({ leagueId: 'Run', phase: 'live', yourSlot: null })])} allHref="#" totalLeagues={4} />)
    const values = [...container.querySelectorAll('.af-bd-v')].map((v) => v.textContent)
    expect(values).not.toContain('—')
  })

  it('renders Spanish when asked', () => {
    const { container } = render(<DraftHqBoard data={data([row({ leagueId: 'Soon', phase: 'upcoming' })])} allHref="#" totalLeagues={4} language="es" />)
    expect(container.querySelector('h1')?.textContent).toBe('Ningún draft en curso · 1 por empezar')
    expect(container.textContent ?? '').toContain('Por empezar')
  })
})

describe('draft HQ guide copy', () => {
  const en = draftHqGuideMessages.en
  it('says the headline in plain words', () => {
    expect(en.headRunning('Club', 1)).toBe('Club is drafting — it’s not your pick yet')
    expect(en.headRunning('Club', 3)).toBe('3 drafts are running — none is waiting on you')
    expect(en.headPaused('Hoops', 1, true)).toBe('Hoops is paused — you pick next')
    // One count on the line (2026-11-13); the leagues with no draft sit behind the footer's "?".
    expect(en.foot(10, 35)).toBe('Showing the 10 most urgent of 35 drafts.')
    expect(en.footWithout(47)).toBe('47 leagues have no draft we can read.')
    expect(en.foot(3, 3)).toBe('3 drafts in all.')
  })

  it('has Spanish for every key and never says «waiver»', () => {
    const es = draftHqGuideMessages.es!
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = JSON.stringify(Object.values(es).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(text.toLowerCase()).not.toMatch(/waiver/)
  })
})
