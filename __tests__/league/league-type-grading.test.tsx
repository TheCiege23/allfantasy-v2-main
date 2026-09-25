// @vitest-environment jsdom
/**
 * The league type beside every trade grade, and how we know it (Guap, 2026-09-25: the manager must
 * be told how much their league type matters). The label must name the SAME type the chart was
 * priced on — `valueBook.leagueVariantFor` — so these mirror its order.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  LEAGUE_TYPE_DECIDES_GRADES,
  leagueTypeBasis,
  leagueTypeSourceText,
} from '@/lib/league/leagueTypeGrading'
import { valueBookFor } from '@/lib/core-app/valueBook'
import { LeagueTypeGradeNote } from '@/components/league/LeagueTypeGradeNote'

const keeperFact = { conceptRules: { extensions: { keeperProvenance: { source: 'provider', isKeeper: true } } } }

describe('leagueTypeBasis', () => {
  it('a person’s confirmation is "confirmed" and outranks everything', () => {
    expect(
      leagueTypeBasis({
        settings: { ...keeperFact, leagueTypeConfirmation: { type: 'zombie' } },
        leagueType: 'redraft',
        platform: 'sleeper',
      }),
    ).toEqual({ type: 'zombie', label: 'Zombie', source: 'confirmed', platform: 'Sleeper' })
  })

  it('🛑 a Sleeper keeper league stored `redraft` is labelled KEEPER, from the platform', () => {
    expect(leagueTypeBasis({ settings: keeperFact, leagueType: 'redraft', platform: 'sleeper' })).toMatchObject({
      type: 'keeper',
      source: 'platform',
    })
  })

  it('a Sleeper dynasty league is dynasty from the platform', () => {
    expect(leagueTypeBasis({ settings: { isDynasty: true }, leagueType: 'dynasty', platform: 'sleeper' })).toMatchObject({
      type: 'dynasty',
      source: 'platform',
    })
  })

  it('the redraft default and a name match are both "assumed"', () => {
    expect(leagueTypeBasis({ settings: {}, leagueType: 'redraft', platform: 'sleeper' })).toMatchObject({
      type: 'redraft',
      source: 'assumed',
    })
    expect(leagueTypeBasis({ settings: {}, leagueType: 'guillotine', platform: 'sleeper' })).toMatchObject({
      label: 'Guillotine',
      source: 'assumed',
    })
    expect(leagueTypeBasis({ settings: null, leagueType: null })).toMatchObject({
      type: 'redraft',
      label: 'Redraft',
      source: 'assumed',
      platform: null,
    })
  })

  it('names the SAME type the chart is priced on', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [keeperFact, 'redraft'],
      [{ isDynasty: true }, 'dynasty'],
      [{}, 'redraft'],
      [{ ...keeperFact, leagueTypeConfirmation: { type: 'redraft' } }, 'redraft'],
    ]
    for (const [settings, column] of cases) {
      const basis = leagueTypeBasis({ settings, leagueType: column })
      // Keeper and dynasty price on the dynasty chart; redraft on redraft.
      expect(valueBookFor(settings, column).format).toBe(basis.type === 'redraft' ? 'REDRAFT' : 'DYNASTY')
    }
  })

  it('a league created on AllFantasy names no platform', () => {
    expect(leagueTypeBasis({ settings: {}, leagueType: 'dynasty', platform: 'native' }).platform).toBeNull()
  })

  it('says where the answer came from', () => {
    expect(leagueTypeSourceText({ type: 'keeper', label: 'Keeper', source: 'platform', platform: 'Sleeper' })).toBe(
      'from Sleeper, not confirmed',
    )
    expect(leagueTypeSourceText({ type: 'redraft', label: 'Redraft', source: 'assumed', platform: 'Sleeper' })).toBe(
      'our guess, not confirmed',
    )
    expect(leagueTypeSourceText({ type: 'dynasty', label: 'Dynasty', source: 'confirmed', platform: null })).toBe(
      'confirmed',
    )
  })
})

describe('LeagueTypeGradeNote', () => {
  it('🛑 an unconfirmed type says it decides the grades, and links to where it is set', () => {
    render(
      <LeagueTypeGradeNote
        basis={{ type: 'keeper', label: 'Keeper', source: 'platform', platform: 'Sleeper' }}
        confirmHref="#league-type"
      />,
    )
    const note = screen.getByTestId('league-type-grade-note')
    expect(note).toHaveTextContent('League type: Keeper · from Sleeper, not confirmed')
    expect(note).toHaveTextContent(LEAGUE_TYPE_DECIDES_GRADES)
    expect(screen.getByRole('link', { name: 'Confirm your league type' })).toHaveAttribute('href', '#league-type')
    expect(note).toHaveAttribute('data-confirmed', 'false')
  })

  it('a confirmed type is stated plainly, with no ask', () => {
    render(
      <LeagueTypeGradeNote
        basis={{ type: 'dynasty', label: 'Dynasty', source: 'confirmed', platform: null }}
        confirmHref="#league-type"
      />,
    )
    expect(screen.getByTestId('league-type-grade-note')).toHaveTextContent('League type: Dynasty · confirmed')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders nothing without a basis', () => {
    const { container } = render(<LeagueTypeGradeNote basis={null} confirmHref="#league-type" />)
    expect(container).toBeEmptyDOMElement()
  })
})
