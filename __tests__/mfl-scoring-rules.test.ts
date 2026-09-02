import { describe, expect, it } from 'vitest'

import { parseMflScoringRules } from '@/lib/league-import/mfl/MflLeagueFetchService'
import { resolveProviderScoringStatKey } from '@/lib/scoring-defaults/ScoringKeyAliasResolver'

/**
 * MFL scoring: real rules instead of a guess from the league's name.
 *
 * 🛑 THE DEFECT THIS REPLACES. `detectMflScoringFormat` read
 * `settings.scoringType ?? league.name`, lowercased it, and looked for "ppr" and "half".
 * So a league called "The Half Pint Dynasty" was assigned half-PPR scoring, and — worse,
 * because it is silent and universal — every NFL league that did not describe itself was
 * assigned "standard" outright. Meanwhile `rules: []` was hardcoded, because nothing ever
 * requested `TYPE=rules`.
 *
 * The tests below pin both halves: that real rules are parsed out of a shape we are not
 * allowed to probe for, and that a format we cannot establish comes back NULL rather than
 * as a confident wrong answer.
 */

describe('parseMflScoringRules', () => {
  /*
   * MFL is not one of the providers with a committed contract under `contracts/`, and this
   * repo forbids probing a vendor to discover a response shape. So the parser is written
   * shape-agnostically and these cases pin that tolerance rather than one asserted layout.
   */
  it('reads the common wrapper', () => {
    const rules = parseMflScoringRules({
      rules: {
        rule: [
          { positions: 'QB', points: '0.04', event: 'PY', name: 'Passing Yards' },
          { positions: 'RB,WR,TE', points: '1', event: 'RE', name: 'Receptions' },
        ],
      },
    })
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ code: 'PY', points: 0.04, name: 'Passing Yards' })
    expect(rules[1]).toMatchObject({ code: 'RE', points: 1 })
    expect(rules[1]!.positions).toEqual(['RB', 'WR', 'TE'])
  })

  /* MFL collapses single-element arrays to bare objects. */
  it('tolerates a single rule not wrapped in an array', () => {
    const rules = parseMflScoringRules({
      rules: { rule: { positions: 'QB', points: '4', event: 'PTD', name: 'Passing TD' } },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ code: 'PTD', points: 4 })
  })

  /* ...and wraps text nodes in `$t`. */
  it('tolerates $t text nodes', () => {
    const rules = parseMflScoringRules({
      rules: { rule: [{ positions: { $t: 'WR' }, points: { $t: '0.5' }, event: { $t: 'RE' } }] },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ code: 'RE', points: 0.5 })
  })

  /* One rule can name several events sharing a value — each becomes its own rule. */
  it('fans a multi-event rule out to one rule per event', () => {
    const rules = parseMflScoringRules({
      rules: { rule: [{ positions: '', points: '6', event: ['RTD', 'RETD'] }] },
    })
    expect(rules.map((r) => r.code)).toEqual(['RTD', 'RETD'])
    expect(rules.every((r) => r.points === 6)).toBe(true)
  })

  /*
   * A rule whose points cannot be read is DROPPED, not defaulted to zero. A zero-point rule
   * is a real thing a league can configure, so inventing one would be indistinguishable
   * from a genuine setting.
   */
  it('drops a rule with unreadable points rather than defaulting it', () => {
    const rules = parseMflScoringRules({
      rules: { rule: [{ positions: 'QB', points: 'not-a-number', event: 'PY' }] },
    })
    expect(rules).toEqual([])
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an empty object', {}],
    ['a missing rule list', { rules: {} }],
  ])('returns no rules for %s rather than throwing', (_label, raw) => {
    expect(parseMflScoringRules(raw)).toEqual([])
  })
})

describe('MFL scoring key resolution', () => {
  /*
   * 🛑 CODE-KEYED RESOLUTION IS FORBIDDEN AND THIS PINS IT. There is no MFL account behind
   * this repo, so there is no evidence base for a code table — the ESPN table exists only
   * because 1,277 agreeing player-seasons could be joined. Recalling that "RE" means
   * receptions and writing it down as fact is exactly the failure that silently mis-scores
   * every player in a league. Resolution happens ONLY from a name MFL spelled out.
   */
  it('does not resolve from the code alone, however obvious the code looks', () => {
    expect(resolveProviderScoringStatKey('mfl_stat_RE')).toBeNull()
    expect(resolveProviderScoringStatKey('mfl_stat_PY')).toBeNull()
    expect(resolveProviderScoringStatKey('mfl_stat_RE', { mflStatName: null })).toBeNull()
  })

  it('resolves from a name MFL supplied', () => {
    expect(
      resolveProviderScoringStatKey('mfl_stat_RE', { mflStatName: 'Receptions' }),
    ).toBe('rec')
    expect(
      resolveProviderScoringStatKey('mfl_stat_PY', { mflStatName: 'Passing Yards' }),
    ).toBe('pass_yd')
  })

  it('normalizes punctuation and case the way the Yahoo path does', () => {
    expect(
      resolveProviderScoringStatKey('mfl_stat_REY', { mflStatName: 'RECEIVING  YARDS' }),
    ).toBe('rec_yd')
  })

  it('returns null for a name it cannot justify', () => {
    expect(
      resolveProviderScoringStatKey('mfl_stat_XX', { mflStatName: 'Defensive Snap Bonus' }),
    ).toBeNull()
  })

  /* The other providers must be unaffected by the new branch. */
  it('leaves the ESPN and Yahoo paths alone', () => {
    expect(resolveProviderScoringStatKey('espn_stat_53')).toBe('rec')
    expect(resolveProviderScoringStatKey('yahoo_stat_1')).toBeNull()
    expect(resolveProviderScoringStatKey('rec')).toBeNull()
  })
})
