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

/**
 * 🛑 THE RESOLVER ABOVE COULD NEVER FIRE FOR A REAL LEAGUE, AND NOTHING SAID SO.
 *
 * Every test in `MFL scoring key resolution` calls `resolveProviderScoringStatKey` with a name
 * passed in by hand. In production nothing passed one: `MflAdapter` parsed `rule.name` and then
 * dropped it building the normalized rule, so the name never reached the stored snapshot and
 * `bridgeProviderScoringRules` had nothing to give the resolver. Every `mfl_stat_<code>` fell
 * through unresolved, in a league whose scoring the product then reported as untranslatable.
 *
 * A unit test of the resolver cannot catch that — it supplies the very input the pipeline was
 * failing to supply. These cases follow the name through the three layers that dropped it.
 */
describe('MFL scoring names survive the import chain', () => {
  it('the adapter keeps the name MFL shipped, and omits it when MFL shipped none', async () => {
    const { MflAdapter } = await import('@/lib/league-import/adapters/mfl/MflAdapter')
    // `MflAdapter` is an object literal implementing ILeagueImportAdapter, not a class.
    const adapter = MflAdapter
    const payload = {
      league: { id: '65432', name: 'Test', season: '2025' },
      teams: [],
      settings: { scoringType: null, rosterPositions: [], raw: {} },
      scoringRules: [
        { code: '21', name: 'Receptions', positions: [], points: 1 },
        { code: '99', name: null, positions: [], points: 3 },
      ],
      schedule: [], standings: [], transactions: [], draftPicks: [],
      playerMap: {}, lineupBreakdownAvailable: false, previousSeasons: [],
    }
    const out = await adapter.normalize(payload as never)
    const rules = out.scoring?.rules ?? []

    expect(rules.find((r) => r.stat_key === 'mfl_stat_21')).toMatchObject({ stat_name: 'Receptions' })
    // No name shipped ⇒ the field is ABSENT, not ''. "MFL sent nothing" must stay distinguishable.
    expect(rules.find((r) => r.stat_key === 'mfl_stat_99')).not.toHaveProperty('stat_name')
  })

  it('🛑 the bridge resolves an MFL rule from the stored name — the end-to-end claim', async () => {
    const { extractScoringSettings } = await import('@/lib/projections/leagueScoring')
    const settings = {
      scoringSettings: {
        rules: { mfl_stat_21: 1 },
        rulesDetail: [{ statKey: 'mfl_stat_21', pointsValue: 1, statName: 'Receptions' }],
      },
    }
    const bridged = extractScoringSettings(settings)
    // Translated to the canonical Sleeper key rather than left as the provider code.
    expect(bridged).toMatchObject({ rec: 1 })
    expect(bridged).not.toHaveProperty('mfl_stat_21')
  })

  it('a rule with no stored name stays UNRESOLVED under its provider key', async () => {
    /*
     * The honesty bar the resolver sets, preserved now that it is reachable: unmatched is
     * reported, never guessed. `coverage.unmatched` is what surfaces it to a user.
     */
    const { extractScoringSettings } = await import('@/lib/projections/leagueScoring')
    const bridged = extractScoringSettings({
      scoringSettings: {
        rules: { mfl_stat_21: 1, mfl_stat_99: 3 },
        rulesDetail: [{ statKey: 'mfl_stat_21', pointsValue: 1, statName: 'Receptions' }],
      },
    })
    expect(bridged).toMatchObject({ rec: 1, mfl_stat_99: 3 })
  })

  it('a POSITION-QUALIFIED MFL rule resolves too', async () => {
    /*
     * ⚠ The position-dependent leagues are exactly the ones that motivated `positions` in the
     * first place — MFL pricing a reception per position. The flat map keys those as
     * `mfl_stat_21@TE`, so a name lookup that only indexed the bare key would leave precisely
     * those leagues untranslated while appearing to work everywhere else.
     */
    const { extractScoringSettings } = await import('@/lib/projections/leagueScoring')
    const bridged = extractScoringSettings({
      scoringSettings: {
        rules: { 'mfl_stat_21@TE': 1.5 },
        rulesDetail: [
          { statKey: 'mfl_stat_21', pointsValue: 1.5, positions: ['TE'], statName: 'Receptions' },
        ],
      },
    })
    expect(bridged).toMatchObject({ rec: 1.5 })
  })
})
