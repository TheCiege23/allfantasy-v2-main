/**
 * Draft HQ, simplified (2026-11-24). On a phone the all-leagues page measured ~2,790px.
 *  - the intro under the headline is one short line;
 *  - "Last picks" on a running draft is a closed fold with its count;
 *  - your own pick card drops the "It's your pick right now" line (the tag and "On the clock: You" say it);
 *  - a not-started or finished row drops its "Not started" / "Complete" tag (the section heading says it),
 *    while a status we could not place keeps its tag.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/core/draft-hq' }))

import DraftHqBoard from '@/components/core-app/boards/DraftHqBoard'
import type { DraftHqAllData, DraftHqAllRow } from '@/lib/core-app/draftHqAll'
import type { LiveDraftPicks } from '@/lib/core-app/warRoomBoard'

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
const data = (rows: DraftHqAllRow[]): DraftHqAllData => ({ rows, counts: { live: 0, upcoming: 0, done: 0, unknown: 0 }, withoutDraft: 0 })
const pick = (overall: number, name: string) => ({
  overall, round: 1, pickInRound: overall, rosterId: String(overall), managerName: `Manager ${overall}`, isYours: false,
  playerName: name, position: 'WR', imageUrl: null, team: null, sleeperId: null,
})
const PICKS = {
  byLeague: { Mine: [pick(1, 'Player A'), pick(2, 'Player B')], Other: [pick(3, 'Player C')] },
  queueByLeague: { Mine: [{ playerName: 'Target Q', position: 'RB' }] },
} as unknown as LiveDraftPicks

function board(rows: DraftHqAllRow[]) {
  return render(<DraftHqBoard data={data(rows)} allHref="/core/draft-hq?all=1" totalLeagues={5} picks={PICKS} />).container
}

describe('Draft HQ, plain', () => {
  it('the headline is the head: no intro line once there are drafts (2026-11-24)', () => {
    const c = board([row({ leagueId: 'Soon', phase: 'upcoming' })])
    expect(c.querySelector('.af-bd-head')?.textContent).not.toContain('Every draft you’re in, the one that needs you first.')
    expect(c.querySelector('.af-bd-head .af-bd-blurb')).toBeNull()
  })

  it('your own pick card says it once: YOUR PICK on the tag, no "On the clock · You" tile (2026-11-24)', () => {
    const c = board([row({ leagueId: 'Mine', phase: 'live', yoursOnClock: true, queuedCount: 1 }), row({ leagueId: 'Other', phase: 'live', onClockName: 'Riley' })])
    const cards = [...c.querySelectorAll('.af-bd-sec')]
    const mine = cards.find((el) => el.textContent?.includes('Mine'))!
    expect(mine.textContent).not.toMatch(/On the clock/)
    const other = cards.find((el) => el.textContent?.includes('Other'))!
    expect(other.textContent).toMatch(/On the clock/)
    expect(other.textContent).toContain('Riley')
  })

  it('folds each running draft’s last picks, with the count on the closed row; the queue stays open', () => {
    const c = board([row({ leagueId: 'Mine', phase: 'live', yoursOnClock: true, queuedCount: 1 }), row({ leagueId: 'Other', phase: 'live', onClockName: 'Riley' })])
    const folds = [...c.querySelectorAll('details[data-testid="draft-last-picks"]')] as HTMLDetailsElement[]
    expect(folds).toHaveLength(2)
    expect(folds.every((d) => !d.open)).toBe(true)
    expect(folds[0]!.querySelector('summary')?.textContent).toBe('Last picks · 2')
    expect(folds[0]!.textContent).toContain('Player A')
    expect(c.textContent).toContain('Target Q')
  })

  it('your own pick card has no line repeating that it is your pick', () => {
    const c = board([row({ leagueId: 'Mine', phase: 'live', yoursOnClock: true })])
    expect(c.querySelector('.af-bd-card .af-bd-reason')).toBeNull()
  })

  it('a not-started or finished row has no tag; a status we could not place keeps one', () => {
    const c = board([
      row({ leagueId: 'Soon', phase: 'upcoming' }),
      row({ leagueId: 'Done', phase: 'done' }),
      row({ leagueId: 'Odd', phase: 'unknown', rawStatus: 'post_draft_v2' }),
    ])
    const tags = [...c.querySelectorAll('.af-dh-row .af-bd-tag')].map((t) => t.textContent)
    expect(tags).toEqual(['POST_DRAFT_V2'])
    expect(c.querySelectorAll('.af-dh-row .af-dh-row-btn')).toHaveLength(3)
  })
})
