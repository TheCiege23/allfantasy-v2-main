import { describe, expect, it } from 'vitest'

import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { Dash34Data, Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * Empty starting slots.
 *
 * Sleeper writes "0" into a starting slot it holds no player for. It is a
 * sentinel, not an id, and `filter(Boolean)` keeps it — so every unfilled slot
 * was being carried as a rostered player, and the product told users it had
 * "no lineup reader for imported leagues yet" while the answer sat in the
 * array it already parsed.
 *
 * An empty slot outranks an injured starter: a player ruled out MIGHT be
 * active by Sunday; a slot with nobody in it is a zero that has already
 * happened.
 */

function league(over: Partial<Dash34League> = {}): Dash34League {
  return {
    id: 'l1',
    name: 'Bla bla bla',
    platform: 'sleeper',
    priority: 'urgent',
    emptyStarters: 0,
    hurtStarters: 0,
    ...over,
  } as unknown as Dash34League
}

const dash = (leagues: Dash34League[]): Dash34Data =>
  ({ allLeagues: leagues, leagues }) as unknown as Dash34Data

describe('empty starting slots in the issues queue', () => {
  it('raises its own row, naming the count', () => {
    const out = mergeDash34Issues([], dash([league({ emptyStarters: 2 })]))
    const row = out.find((i) => i.id === 'l1:empty-slot')
    expect(row).toBeTruthy()
    expect(row!.title).toContain('2 empty starting slots')
    expect(row!.title).toContain('Bla bla bla')
    expect(row!.action?.label).toBe('Fill the slot')
  })

  it('singularises one slot', () => {
    const out = mergeDash34Issues([], dash([league({ emptyStarters: 1 })]))
    expect(out.find((i) => i.id === 'l1:empty-slot')!.title).toContain('1 empty starting slot —')
  })

  it('does NOT also claim a starter cannot play when none is flagged', () => {
    /*
     * Both conditions mark a league 'urgent'. Without the hurtStarters check
     * a league whose only problem is an unfilled slot would be reported as
     * having a player who cannot play — a different, untrue thing.
     */
    const out = mergeDash34Issues([], dash([league({ emptyStarters: 1, hurtStarters: 0 })]))
    expect(out.some((i) => i.id === 'l1:starter-out')).toBe(false)
    expect(out.some((i) => i.id === 'l1:empty-slot')).toBe(true)
  })

  it('raises BOTH rows when a league has an empty slot and a flagged starter', () => {
    const out = mergeDash34Issues([], dash([league({ emptyStarters: 1, hurtStarters: 2 })]))
    expect(out.some((i) => i.id === 'l1:empty-slot')).toBe(true)
    expect(out.some((i) => i.id === 'l1:starter-out')).toBe(true)
  })

  it('raises nothing for a league with a full lineup and no flags', () => {
    const out = mergeDash34Issues(
      [],
      dash([league({ priority: null, emptyStarters: 0, hurtStarters: 0 })]),
    )
    expect(out).toEqual([])
  })

  it('does not restate a row the detector queue already carries', () => {
    const existing: CoreIssue[] = [
      {
        id: 'l1:empty-slot',
        severity: 'bad',
        glyph: '□',
        title: 'already here',
        meta: '',
        leagueId: 'l1',
        leagueName: 'Bla bla bla',
        platform: 'sleeper',
        deadline: null,
        action: null,
      },
    ]
    const out = mergeDash34Issues(existing, dash([league({ emptyStarters: 3 })]))
    expect(out.filter((i) => i.id === 'l1:empty-slot')).toHaveLength(1)
    expect(out.find((i) => i.id === 'l1:empty-slot')!.title).toBe('already here')
  })

  it('passes the queue through untouched when dash34 could not be read', () => {
    const existing: CoreIssue[] = [
      {
        id: 'x',
        severity: 'warn',
        glyph: '!',
        title: 't',
        meta: '',
        leagueId: null,
        leagueName: null,
        platform: null,
        deadline: null,
        action: null,
      },
    ]
    expect(mergeDash34Issues(existing, null)).toEqual(existing)
  })
})
