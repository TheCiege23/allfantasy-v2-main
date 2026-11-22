/**
 * Dynasty My Team roster markers and the Trades "Your draft capital" panel.
 *
 * Markers: a row is marked only from stored rows whose id AND name both match the lineup's player, the
 * rows must agree, and the tone follows the outlook's own aging rule. Panel: it lists your own roster
 * picks by draft year, a tap adds the SAME asset the asset picker would build, and a pick already on
 * your side reads "In deal" — including an imported pick, whose id is null in the deal.
 */
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ageTone, buildDynastyRosterMarkers, type MarkerRow } from '@/lib/core-app/dynastyRosterMarkers'
import { agingThreshold } from '@/lib/core-app/dynastyAging'
import type { RosterPick } from '@/components/core-app/screens/useLeagueRosters'

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import { DynastyAgeKey, DynastyMarkersScope, DynastyRowMarkers } from '@/components/core-app/screens/DynastyRosterMarkers'
import { DynastyPickCapitalPanel, pickDealKey } from '@/components/core-app/screens/DynastyPickCapitalPanel'
import { rosterPickAsset } from '@/components/core-app/screens/TradeAssetPicker'

const row = (over: Partial<MarkerRow>): MarkerRow => ({ sleeperId: '1', name: 'Jalen Example', position: 'WR', age: 25, yearsExp: 3, ...over })

describe('buildDynastyRosterMarkers', () => {
  it('marks a player from rows whose id and name both match, toned by the aging rule', () => {
    const out = buildDynastyRosterMarkers(
      [{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }, { sleeperId: '2', name: 'Old Back', position: 'RB' }, { sleeperId: '3', name: 'Young Gun', position: 'QB' }],
      [row({}), row({ sleeperId: '2', name: 'Old Back', position: 'RB', age: 28 }), row({ sleeperId: '3', name: 'Young Gun', position: 'QB', age: 22, yearsExp: 0 })],
      'NFL',
    )
    expect(out['1']).toEqual({ age: 25, tone: 'prime', agingFrom: 29, rookie: false })
    expect(out['2']).toMatchObject({ age: 28, tone: 'aging', agingFrom: 27 })
    expect(out['3']).toMatchObject({ age: 22, tone: 'rising', rookie: true })
  })

  it('a row under the same id but another name is a different player and is ignored', () => {
    const out = buildDynastyRosterMarkers([{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }], [row({ name: 'Somebody Else', age: 34 })], 'NFL')
    expect(out['1']).toBeUndefined()
  })

  it('normalises name spelling (suffixes, punctuation) before comparing', () => {
    const out = buildDynastyRosterMarkers([{ sleeperId: '9', name: 'Marvin Harrison Jr.', position: 'WR' }], [row({ sleeperId: '9', name: 'Marvin Harrison Jr', age: 24 })], 'NFL')
    expect(out['9']?.age).toBe(24)
  })

  it('rows that disagree by more than a year, or on experience, say nothing', () => {
    const out = buildDynastyRosterMarkers(
      [{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }],
      [row({ age: 24, yearsExp: 0 }), row({ age: 27, yearsExp: 1 })],
      'NFL',
    )
    expect(out['1']).toBeUndefined()
    // A one-year spread is a stale birthday, and the higher value wins.
    expect(buildDynastyRosterMarkers([{ sleeperId: '1', name: 'Jalen Example', position: 'WR' }], [row({ age: 24 }), row({ age: 25 })], 'NFL')['1']?.age).toBe(25)
  })

  it('ageTone and agingThreshold: 24 and under rising, at/after the position line aging', () => {
    expect(ageTone(24, 29)).toBe('rising')
    expect(ageTone(25, 29)).toBe('prime')
    expect(ageTone(29, 29)).toBe('aging')
    expect(ageTone(30, undefined)).toBe('prime')
    expect(agingThreshold('NFL', 'RB')).toBe(27)
  })
})

describe('DynastyRowMarkers', () => {
  const markers = { a: { age: 30, tone: 'aging' as const, agingFrom: 29, rookie: false }, r: { age: 21, tone: 'rising' as const, agingFrom: 29, rookie: true } }

  it('draws the age chip with its tone and a ROOKIE tab, and the key only when markers exist', () => {
    lang.language = 'en'
    const { container } = render(
      <DynastyMarkersScope markers={markers}>
        <DynastyAgeKey />
        <DynastyRowMarkers sleeperId="a" />
        <DynastyRowMarkers sleeperId="r" />
        <DynastyRowMarkers sleeperId="missing" />
      </DynastyMarkersScope>,
    )
    const rows = container.querySelectorAll('[data-testid=dynasty-row-markers]')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.af-mt-dyn-age')?.getAttribute('data-tone')).toBe('aging')
    expect(rows[0].querySelector('.af-mt-dyn-age')?.getAttribute('aria-label')).toContain('at or past 29')
    expect(rows[1].textContent).toContain('Rookie')
    expect(container.querySelector('[data-testid=dynasty-age-key]')).not.toBeNull()
  })

  it('renders nothing without a scope (every non-dynasty league)', () => {
    const { container } = render(
      <>
        <DynastyAgeKey />
        <DynastyRowMarkers sleeperId="a" />
      </>,
    )
    expect(container.innerHTML).toBe('')
  })

  it('speaks Spanish', () => {
    lang.language = 'es'
    const { container } = render(
      <DynastyMarkersScope markers={markers}>
        <DynastyRowMarkers sleeperId="r" />
      </DynastyMarkersScope>,
    )
    expect(container.textContent).toContain('Novato')
  })
})

const pick = (season: number, round: number, over: Partial<RosterPick> = {}): RosterPick => ({
  pickId: `p-${season}-${round}`,
  season,
  round,
  label: `${season} round ${round}`,
  itemType: 'future_pick',
  value: 100,
  proposable: true,
  fromTeam: null,
  ...over,
})

describe('DynastyPickCapitalPanel', () => {
  const picks = [pick(2028, 2), pick(2027, 1, { fromTeam: 'Rival' }), pick(2027, 1), pick(2027, 3)]

  it('groups by draft year in order, counts first-rounders and marks them gold', () => {
    lang.language = 'en'
    const { container } = render(<DynastyPickCapitalPanel picks={picks} coverage="complete" leagueId={null} book={null} inDeal={new Set()} onAdd={() => {}} />)
    const years = [...container.querySelectorAll('.af-tc-dyn-season')].map((e) => e.textContent)
    expect(years).toEqual(['2027', '2028'])
    expect(container.textContent).toContain('4 picks held')
    expect(container.textContent).toContain('2 first-rounders')
    expect(container.querySelectorAll('.af-tc-dyn-pick[data-round="1"]')).toHaveLength(2)
    expect(container.textContent).toContain('via Rival')
  })

  it('a tap adds exactly the asset the asset picker builds', () => {
    const onAdd = vi.fn()
    const { container } = render(<DynastyPickCapitalPanel picks={[pick(2027, 1)]} coverage="complete" leagueId={null} book={null} inDeal={new Set()} onAdd={onAdd} />)
    fireEvent.click(container.querySelector('.af-tc-dyn-pick')!)
    expect(onAdd).toHaveBeenCalledWith(rosterPickAsset(pick(2027, 1), null, null))
    expect(onAdd.mock.calls[0][0]).toMatchObject({ kind: 'pick', year: 2027, round: 1, pickId: 'p-2027-1', proposable: true })
  })

  it('an imported pick goes in with no id, and still reads "In deal" once added', () => {
    const imported = pick(2027, 1, { proposable: false })
    const asset = rosterPickAsset(imported, null, null)
    expect(asset.pickId).toBeNull()
    const { container } = render(<DynastyPickCapitalPanel picks={[imported]} coverage="complete" leagueId={null} book={null} inDeal={new Set([pickDealKey(asset)])} onAdd={() => {}} />)
    const chip = container.querySelector('.af-tc-dyn-pick') as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    expect(chip.textContent).toContain('In deal')
    expect(container.textContent).toContain('for analysis here')
  })

  it('hides itself with no picks, but explains a traded-only inventory', () => {
    const empty = render(<DynastyPickCapitalPanel picks={[]} coverage="complete" leagueId={null} book={null} inDeal={new Set()} onAdd={() => {}} />)
    expect(empty.container.innerHTML).toBe('')
    const tradedOnly = render(<DynastyPickCapitalPanel picks={[]} coverage="traded_only" leagueId={null} book={null} inDeal={new Set()} onAdd={() => {}} />)
    expect(tradedOnly.container.textContent).toContain('Only picks that changed hands')
  })

  it('speaks Spanish, ordinals included', () => {
    lang.language = 'es'
    const { container } = render(<DynastyPickCapitalPanel picks={[pick(2027, 1)]} coverage="complete" leagueId={null} book={null} inDeal={new Set()} onAdd={() => {}} />)
    expect(container.textContent).toContain('Tu capital de draft')
    expect(container.textContent).toContain('1.ª')
  })
})
