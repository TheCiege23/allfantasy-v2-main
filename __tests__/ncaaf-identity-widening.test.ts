// @vitest-environment node
/**
 * What widening the NCAAF registry from `SportsPlayer` would insert.
 *
 * 🛑 THE ONE RULE EVERYTHING ELSE SERVES: two people who share a name and play
 * for different schools must stay two rows. Of 7,248 colliding candidate names
 * on production, 4,925 (67.9%) are different people — `Ryan Davis` is 8 rows
 * across 7 schools. A name-keyed insert fuses them into one identity, and that
 * failure is silent: it surfaces months later as another player's projection on
 * somebody's roster, never as an error.
 */

import { describe, expect, it } from 'vitest'

import { looksLikeAPerson, planWidening } from '@/lib/devy/ingestNcaafIdentitiesFromSportsPlayer'

const sp = (name: string, team: string | null, position: string | null = 'WR') => ({
  name,
  team,
  position,
})

describe('planWidening', () => {
  /**
   * 🛑 THE CENTRAL CASE. Same name, seven schools, seven people.
   */
  it('keeps players who share a name at different schools as separate rows', () => {
    const { plan } = planWidening(
      [
        sp('Ryan Davis', 'Auburn'),
        sp('Ryan Davis', 'Ohio State'),
        sp('Ryan Davis', 'Temple'),
      ],
      new Set(),
    )
    expect(plan).toHaveLength(3)
    expect(new Set(plan.map((p) => p.team))).toEqual(new Set(['Auburn', 'Ohio State', 'Temple']))
    /* One person, one canonical name — the rows differ by school, not by name. */
    expect(new Set(plan.map((p) => p.normalizedName))).toEqual(new Set(['ryan davis']))
  })

  it('collapses duplicate cache rows for one player at one school into one row', () => {
    const { plan } = planWidening(
      [sp('Ryan Davis', 'Auburn'), sp('Ryan Davis', 'Auburn'), sp('Ryan Davis', 'Auburn')],
      new Set(),
    )
    expect(plan).toHaveLength(1)
  })

  /**
   * 🛑 EXISTING NAMES ARE CHECKED ON THE NAME, NOT THE PAIR. Inserting the other
   * six Ryan Davises beside a row we already hold would manufacture ambiguity
   * where one confident row stands today — the resolver would go from a clean
   * name match to a refusal for a player it currently resolves.
   */
  it('skips a name the registry already holds, including its other schools', () => {
    const { plan } = planWidening(
      [sp('Ryan Davis', 'Auburn'), sp('Ryan Davis', 'Temple'), sp('Jane Roe', 'Baylor')],
      new Set(['ryan davis']),
    )
    expect(plan.map((p) => p.normalizedName)).toEqual(['jane roe'])
  })

  /**
   * ⚠ THE NORMALIZER IS THE SHARED ONE, AND THIS IS WHAT A SQL COPY GOT WRONG.
   * Comparing a SQL reimplementation against `normalizePlayerName` on 500 real
   * rows found 36 disagreements: suffixes and apostrophes. Every one would have
   * written a key the resolver never computes — a row that exists, counts as
   * success, and is unreachable by the lookup it was inserted for.
   */
  it('normalizes with the shared rule: suffix stripped, apostrophe kept', () => {
    const { plan } = planWidening([sp('Danny Lockhart Jr.', 'Utah'), sp("Patrick O'Brien", 'Colorado State')], new Set())
    const names = plan.map((p) => p.normalizedName).sort()
    expect(names).toEqual(['danny lockhart', "patrick o'brien"])
  })

  /**
   * ⚠ AND THE SUFFIX RULE MUST MAKE THE SKIP WORK TOO. If the registry holds
   * "danny lockhart", a SportsPlayer row reading "Danny Lockhart Jr." is the
   * same person and must not be inserted again.
   */
  it('matches an existing name through a generational suffix', () => {
    const { plan } = planWidening([sp('Danny Lockhart Jr.', 'Utah')], new Set(['danny lockhart']))
    expect(plan).toHaveLength(0)
  })

  /**
   * 🛑 NO TEAM MEANS NO SAFE ROW. Without a school there is nothing to keep two
   * people of one name apart, which is the entire premise of the key.
   */
  it('drops a candidate with no team rather than inserting an unkeyed row', () => {
    const { plan } = planWidening([sp('Jane Roe', null), sp('Jane Roe', '  ')], new Set())
    expect(plan).toHaveLength(0)
  })

  it('refuses non-people and counts them separately from the plan', () => {
    const { plan, refused } = planWidening(
      [sp('Hasan Defense', 'Utah'), sp('Ja’Kobe6 Cameron', 'Baylor'), sp('Jane Roe', 'Baylor')],
      new Set(),
    )
    expect(plan.map((p) => p.canonicalName)).toEqual(['Jane Roe'])
    expect(refused).toBe(2)
  })

  it('carries position through, and tolerates its absence', () => {
    const { plan } = planWidening([sp('Jane Roe', 'Baylor', 'QB'), sp('John Doe', 'Baylor', null)], new Set())
    expect(plan.find((p) => p.normalizedName === 'jane roe')?.position).toBe('QB')
    expect(plan.find((p) => p.normalizedName === 'john doe')?.position).toBeNull()
  })

  it('is empty for an empty source rather than throwing', () => {
    expect(planWidening([], new Set()).plan).toEqual([])
  })
})

describe('looksLikeAPerson', () => {
  it.each([
    ['Hasan Defense', 'hasan defense'],
    ['Team Offense', 'team offense'],
    ['Ja’Kobe6 Cameron', 'jakobe cameron'],
  ])('refuses %s', (name, norm) => {
    expect(looksLikeAPerson(name, norm)).toBe(false)
  })

  it('refuses a single token and a very short name', () => {
    expect(looksLikeAPerson('Army', 'army')).toBe(false)
    expect(looksLikeAPerson('Al B', 'al b')).toBe(false)
  })

  it.each([
    ['Ryan Davis', 'ryan davis'],
    ["Patrick O'Brien", "patrick o'brien"],
    ['Danny Lockhart', 'danny lockhart'],
  ])('accepts %s', (name, norm) => {
    expect(looksLikeAPerson(name, norm)).toBe(true)
  })
})
