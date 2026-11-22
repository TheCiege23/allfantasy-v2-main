/**
 * Phase 3.2 — rookies and prospects in the NBA / NHL / MLB draft pool, labelled.
 *
 * Three things are pinned here:
 *  1. NBA (and every non-NFL sport) takes its rookie verdict from `SportsPlayer.yearsExp` — the
 *     same column, and the same "0 is a rookie, NULL is unknown" rule, the NFL path already uses
 *     as its `explicit_imported` source. A known experience beats the stats heuristic.
 *  2. College/devy rows reach the pool labelled as prospects, and an NBA devy league draws its
 *     prospects from NCAAB rows, not NCAAF ones.
 *  3. One badge, one resolver, every sport: the card and the board/queue chip agree.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { normalizeDraftPlayer } from '@/lib/draft-sports-models/normalize-draft-player'
import {
  devyPoolSportForDraftSport,
  mergeKnownYearsExp,
  resolveNonNflRookieFields,
} from '@/lib/draft-room/nonNflRookieFields'
import { resolveDraftRoomPlayerLabel } from '@/lib/draft-room/draftRoomPlayerLabel'
import { getDraftRoomDisplayExperienceBadge } from '@/lib/player-data/adapters/draftRoomDisplayFields'
import { DraftPlayerCard } from '@/components/app/draft-room/DraftPlayerCard'

describe('non-NFL rookie verdict from SportsPlayer.yearsExp', () => {
  it('labels an NBA player with yearsExp 0 on his pool row a rookie', () => {
    const fields = resolveNonNflRookieFields({ rowYearsExp: null, poolExperience: 0, rookieHint: null })
    expect(fields).toEqual({ yearsExp: 0, rookieYearsExpSource: 'explicit_imported' })
    const entry = normalizeDraftPlayer({ name: 'Example Rookie', position: 'SG', team: 'SAS', ...fields }, 'NBA')
    expect(entry.isRookie).toBe(true)
    expect(resolveDraftRoomPlayerLabel(entry)).toBe('rookie')
  })

  it('does not label a veteran, and keeps an unknown unknown', () => {
    const vet = resolveNonNflRookieFields({ rowYearsExp: null, poolExperience: 4, rookieHint: null })
    expect(normalizeDraftPlayer({ name: 'Vet', position: 'C', team: 'DEN', ...vet }, 'NBA').isRookie).toBeUndefined()
    const unknown = resolveNonNflRookieFields({ rowYearsExp: null, poolExperience: null, rookieHint: null })
    expect(unknown).toEqual({})
    const entry = normalizeDraftPlayer({ name: 'Unknown', position: 'C', team: 'DEN', ...unknown }, 'NBA')
    expect(entry.yearsExp).toBeNull()
    expect(resolveDraftRoomPlayerLabel(entry)).toBeNull()
  })

  it('lets a known experience overrule the zero-games stats heuristic', () => {
    // An injured veteran with a zero-GP stats row must not be called a rookie when we know better.
    expect(resolveNonNflRookieFields({ rowYearsExp: null, poolExperience: 6, rookieHint: true })).toEqual({
      yearsExp: 6,
      rookieYearsExpSource: 'explicit_imported',
    })
    // With no experience on file the heuristic still applies, exactly as before.
    expect(resolveNonNflRookieFields({ rowYearsExp: null, poolExperience: null, rookieHint: true })).toEqual({
      isRookie: true,
    })
  })

  it('prefers a value already on the row over the pool match', () => {
    expect(resolveNonNflRookieFields({ rowYearsExp: 2, poolExperience: 0, rookieHint: null }).yearsExp).toBe(2)
  })

  it('carries experience across duplicate SportsPlayer rows only when they agree', () => {
    expect(mergeKnownYearsExp([null, 0, undefined, 0])).toBe(0)
    expect(mergeKnownYearsExp([null, undefined])).toBeNull()
    // Two sources disagreeing is not a fact; it is unknown.
    expect(mergeKnownYearsExp([0, 3])).toBeNull()
  })
})

describe('prospects in the pool', () => {
  it('draws NBA devy prospects from NCAAB rows and NFL ones from NCAAF', () => {
    expect(devyPoolSportForDraftSport('NBA')).toBe('NCAAB')
    expect(devyPoolSportForDraftSport('NFL')).toBe('NCAAF')
    // No college prospect layer exists for these sports (contracts record why).
    expect(devyPoolSportForDraftSport('NHL')).toBeNull()
    expect(devyPoolSportForDraftSport('MLB')).toBeNull()
  })

  it('labels an un-graduated college row a prospect even though it is also rookie-eligible', () => {
    const entry = normalizeDraftPlayer(
      { name: 'Example Freshman', position: 'G', team: 'Duke', isDevy: true, school: 'Duke', isRookie: true, poolType: 'college' },
      'NBA',
    )
    expect(resolveDraftRoomPlayerLabel(entry)).toBe('prospect')
  })

  it('a graduated devy player is a rookie, not a prospect', () => {
    expect(resolveDraftRoomPlayerLabel({ isDevy: true, graduatedToNFL: true, isRookie: true, poolType: 'pro' })).toBe('rookie')
  })
})

describe('one badge for every sport', () => {
  for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
    it(`renders the Rookie badge on a ${sport} card from the shared resolver`, () => {
      render(
        <DraftPlayerCard name={`${sport} Rookie`} position="UTIL" team="FA" draftSport={sport} variant="row" isRookie />,
      )
      const badge = screen.getByTestId('draft-player-label-badge')
      expect(badge).toHaveTextContent('Rookie')
      expect(badge).toHaveAttribute('data-label', 'rookie')
    })
  }

  it('renders Prospect for a college row in both card variants', () => {
    for (const variant of ['row', 'card'] as const) {
      const { unmount } = render(
        <DraftPlayerCard name="College Guard" position="G" team="Duke" draftSport="NBA" variant={variant} isDevy isRookie poolType="college" school="Duke" />,
      )
      expect(screen.getByTestId('draft-player-label-badge')).toHaveTextContent('Prospect')
      expect(screen.queryByText('Rookie')).toBeNull()
      unmount()
    }
  })

  it('renders no badge when nothing is known', () => {
    render(<DraftPlayerCard name="Someone" position="C" team="BOS" draftSport="NHL" variant="row" />)
    expect(screen.queryByTestId('draft-player-label-badge')).toBeNull()
  })

  it('the board/queue chip agrees with the card', () => {
    expect(getDraftRoomDisplayExperienceBadge({ yearsExp: 0 })).toBe('Rookie')
    expect(getDraftRoomDisplayExperienceBadge({ yearsExp: 3 })).toBe('3 YOE')
    expect(getDraftRoomDisplayExperienceBadge({ isDevy: true, isRookie: true, poolType: 'college' })).toBe('Prospect')
  })
})
