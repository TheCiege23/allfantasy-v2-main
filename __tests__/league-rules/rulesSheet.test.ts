/** The league rules sheet builder (lib/league-rules/rulesSheet.ts), in both languages. */
import { describe, expect, it } from 'vitest'
import {
  buildRulesSheet,
  DRAFT_ORDER_METHODS,
  DRAFT_TYPES,
  GUILLOTINE_RELEASES,
  GUILLOTINE_TIEBREAKS,
  KEEPER_COSTS,
  RULES_SHEET_CONCEPTS,
  rulesT,
  scoringKind,
  timerSeconds,
  TRADE_REVIEW_MODES,
  WAIVER_TYPES,
  type RulesSheetInput,
} from '@/lib/league-rules/rulesSheet'
import { TIEBREAKER_KEYS, TIEBREAKER_LABELS, type TiebreakerKey } from '@/lib/standings/tiebreakerOrder'
import { DEFAULT_TAXI_STEALING_RULE } from '@/lib/taxi/taxiStealing'

const labels = (lang: 'en' | 'es') => Object.fromEntries(TIEBREAKER_KEYS.map((k) => [k, TIEBREAKER_LABELS[k][lang]])) as Record<TiebreakerKey, string>

const base = (over: Partial<RulesSheetInput> = {}): RulesSheetInput => ({
  native: true,
  platform: null,
  sport: 'NFL',
  teamCount: 12,
  concept: 'redraft',
  conceptLabel: 'Redraft',
  dynastyFamily: false,
  scoring: 'ppr',
  medianGame: false,
  medianInPlayoffs: false,
  starterSlots: ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSize: 16,
  irSlots: 2,
  lineupMode: null,
  waivers: { type: 'faab', faabBudget: 100 },
  trades: {
    allowed: true,
    reviewMode: 'commissioner',
    reviewHours: 48,
    vetoPercent: 50,
    deadlineWeek: 11,
    deadlineAt: null,
    timezone: 'America/New_York',
    pickTrading: false,
    pickDeadline: null,
    pickTerms: null,
  },
  draft: { type: 'snake', rounds: 15, timerPreset: '120s', timerCustomSeconds: null, orderMethod: 'randomized', playerPool: 'all' },
  playoffs: { teams: 6, teamsSource: 'league', byes: 2, startWeek: 15, startSource: 'league', thirdPlace: true, tiebreakers: null, tiebreakerLabels: labels('en') },
  keeper: null,
  taxi: null,
  guillotine: null,
  lang: 'en',
  ...over,
})

const en = rulesT('en')
const es = rulesT('es')
const rule = (sections: ReturnType<typeof buildRulesSheet>, id: string) => sections.flatMap((s) => s.rules).find((r) => r.id === id)
const allText = (sections: ReturnType<typeof buildRulesSheet>) =>
  sections.flatMap((s) => [s.title, ...s.rules.flatMap((r) => [r.label, r.value, r.means ?? ''])]).join('\n')

describe('a redraft league', () => {
  const sheet = buildRulesSheet(base(), en)

  it('has the sections a redraft league has, in reading order, and none it does not', () => {
    expect(sheet.map((s) => s.id)).toEqual(['format', 'scoring', 'roster', 'waivers', 'trades', 'draft', 'playoffs'])
  })

  it('says each rule and what it means', () => {
    expect(rule(sheet, 'format.type')).toMatchObject({ value: 'Redraft', means: en('rules.format.redraft.means') })
    expect(rule(sheet, 'scoring.type')?.value).toBe('PPR')
    expect(rule(sheet, 'roster.starters')).toMatchObject({ value: 'QB, RB1, RB2, WR1, WR2, TE, FLEX, K, DEF', means: 'You fill these 9 slots each week. Empty slots score nothing.' })
    expect(rule(sheet, 'waivers.budget')).toMatchObject({ value: '$100', means: 'Each team has $100 to spend on waiver claims for the whole season.' })
    expect(rule(sheet, 'trades.review')?.means).toBe('The commissioner reviews each accepted trade and can veto it, within 48 hours.')
    expect(rule(sheet, 'trades.deadline')).toMatchObject({ value: 'After week 11', means: 'Trades close once week 11 ends, and pending offers expire.' })
    expect(rule(sheet, 'draft.timer')?.value).toBe('2 minutes')
    expect(rule(sheet, 'playoffs.teams')).toMatchObject({ value: '6 teams', means: 'The top 6 teams make the playoffs, and the top 2 seeds get a first-round bye.', source: 'league' })
    expect(rule(buildRulesSheet(base({ playoffs: { ...base().playoffs!, teams: 5, byes: 1 } }), en), 'playoffs.teams')?.means).toBe('The top 5 teams make the playoffs, and the top seed gets a first-round bye.')
    expect(rule(sheet, 'playoffs.start')?.means).toBe('The regular season ends after week 14; playoff games start in week 15.')
  })

  it('marks the tiebreaker order as the default until the league stores one', () => {
    expect(rule(sheet, 'playoffs.tiebreakers')).toMatchObject({ source: 'default', value: '1. Points for  2. Head-to-head  3. Fewest points against  4. All-play record  5. Coin flip' })
    const chosen = buildRulesSheet(base({ playoffs: { ...base().playoffs!, tiebreakers: ['head_to_head', 'coin_flip'] } }), en)
    expect(rule(chosen, 'playoffs.tiebreakers')).toMatchObject({ source: 'league', value: '1. Head-to-head  2. Coin flip' })
  })

  it('shows pick trading only where picks are a thing, and no draft rounds for an auction', () => {
    expect(rule(sheet, 'trades.picks')).toBeUndefined()
    const auction = buildRulesSheet(base({ draft: { ...base().draft!, type: 'auction' } }), en)
    expect(rule(auction, 'draft.rounds')).toBeUndefined()
    expect(rule(auction, 'draft.order')).toBeUndefined()
  })

  it('says trades are off, and nothing else about trades, when they are', () => {
    const off = buildRulesSheet(base({ trades: { ...base().trades!, allowed: false } }), en)
    expect(off.find((s) => s.id === 'trades')!.rules.map((r) => r.id)).toEqual(['trades.allowed'])
  })

  it('names a close time and a week together, in the league time zone', () => {
    const both = buildRulesSheet(base({ trades: { ...base().trades!, deadlineAt: '2026-11-20T01:00:00.000Z' } }), en)
    expect(rule(both, 'trades.deadline')?.value).toMatch(/^After week 11, or Nov 19, 2026, 8:00 PM EST$/)
  })
})

describe('a dynasty league', () => {
  const dynasty = base({
    concept: 'dynasty',
    dynastyFamily: true,
    trades: { ...base().trades!, pickTrading: true, pickDeadline: { mode: 'open' }, pickTerms: true },
    taxi: { slots: 3, yearsLimit: 2, nonRookies: false, deadlineWeek: 8, stealing: { enabled: true, protectHours: 48, claimsPerSeason: 1 } },
  })
  const sheet = buildRulesSheet(dynasty, en)

  it('adds the pick rules and the dynasty section', () => {
    expect(sheet.map((s) => s.id)).toContain('dynasty')
    expect(rule(sheet, 'trades.pickDeadline')).toMatchObject({ value: 'Open all season' })
    expect(rule(sheet, 'trades.pickTerms')?.value).toBe('On')
    expect(rule(sheet, 'dynasty.taxi')).toMatchObject({ value: '3', means: 'Rookies can be stashed on the taxi squad without using a roster spot, up to this limit. Taxi players cannot start.' })
    expect(rule(sheet, 'dynasty.taxiStealing')?.means).toContain('You have 48 hours to protect a player')
  })

  it('drops the pick deadline and pick terms when picks cannot be traded', () => {
    const noPicks = buildRulesSheet({ ...dynasty, trades: { ...dynasty.trades!, pickTrading: false } }, en)
    expect(rule(noPicks, 'trades.picks')?.value).toBe('Off')
    expect(rule(noPicks, 'trades.pickDeadline')).toBeUndefined()
    expect(rule(noPicks, 'trades.pickTerms')).toBeUndefined()
  })

  it('says there is no taxi squad and asks nothing more about it', () => {
    const none = buildRulesSheet({ ...dynasty, taxi: { ...dynasty.taxi!, slots: 0 } }, en)
    expect(rule(none, 'dynasty.taxi')?.value).toBe('None')
    expect(rule(none, 'dynasty.taxiStealing')).toBeUndefined()
  })
})

describe('a keeper league', () => {
  it('marks each keeper rule by where it came from, and leaves out an unknown one', () => {
    const sheet = buildRulesSheet(
      base({
        concept: 'keeper',
        keeper: {
          count: { value: 2, provenance: 'league_setting', basis: 'league settings' },
          cost: { value: 'round_based', provenance: 'schema_default', basis: 'column default' },
          maxYears: 3,
        },
      }),
      en,
    )
    expect(rule(sheet, 'keeper.count')).toMatchObject({ value: '2', source: 'league' })
    expect(rule(sheet, 'keeper.cost')).toMatchObject({ value: 'Draft round', source: 'default' })
    const unknown = buildRulesSheet(base({ concept: 'keeper', keeper: { count: { value: null, provenance: 'unknown', basis: '' }, cost: { value: null, provenance: 'unknown', basis: '' }, maxYears: null } }), en)
    expect(unknown.find((s) => s.id === 'keeper')).toBeUndefined()
  })
})

describe('a guillotine league', () => {
  const g = base({
    concept: 'guillotine',
    guillotine: {
      teamsPerChop: 1,
      startWeek: 1,
      endWeek: 17,
      advanced: { steps: [{ fromWeek: 10, chops: 2 }], overrides: { '12': 0, '5': 3 }, immunity: 'top_scorer' },
      tiebreakers: ['bench_points', 'season_points', 'not_a_rule'],
      release: 'next_waiver_run',
    },
  })

  it('lists the chop, every week that differs in week order, immunity, tiebreakers and the release', () => {
    const sheet = buildRulesSheet(g, en)
    expect(buildRulesSheet({ ...g, guillotine: { ...g.guillotine!, teamsPerChop: 2 } }, en).find((s) => s.id === 'guillotine')!.rules[0]!.means).toBe(
      'From week 1, the 2 lowest-scoring teams each week are chopped.',
    )
    const chops = sheet.find((s) => s.id === 'guillotine')!.rules
    expect(chops.map((r) => r.id)).toEqual(['guillotine.chops', 'guillotine.end', 'guillotine.step', 'guillotine.override', 'guillotine.override', 'guillotine.immunity', 'guillotine.tiebreakers', 'guillotine.release'])
    expect(chops[0]!.means).toBe('From week 1, the lowest-scoring team each week is chopped.')
    expect(chops[2]!.means).toBe('From week 10, the chop is 2 teams a week.')
    expect(chops[3]!.means).toBe('In week 5, the chop is 3 teams.')
    expect(chops[4]!.means).toBe('No team is chopped in week 12.')
    expect(chops[6]!.value).toBe('1. Fewest bench points  2. Fewest season points')
  })

  it('leaves out the last chop when chops run until one team is left', () => {
    const sheet = buildRulesSheet({ ...g, guillotine: { ...g.guillotine!, endWeek: null } }, en)
    expect(rule(sheet, 'guillotine.end')).toBeUndefined()
  })
})

describe('an imported league', () => {
  it('says where the rules live and reads only what an import carries', () => {
    const sheet = buildRulesSheet(
      base({ native: false, platform: 'sleeper', medianGame: null, rosterSize: null, irSlots: null, waivers: null, trades: null, draft: null, playoffs: { ...base().playoffs!, thirdPlace: null } }),
      en,
    )
    expect(sheet.map((s) => s.id)).toEqual(['format', 'scoring', 'roster', 'playoffs'])
    expect(rule(sheet, 'format.platform')).toMatchObject({ value: 'Sleeper', means: 'The commissioner manages this league on Sleeper, so rule changes are made there.' })
    expect(rule(sheet, 'playoffs.tiebreakers')).toBeUndefined()
  })
})

describe('Spanish', () => {
  it('builds the same sheet in Spanish, never saying «waiver»', () => {
    const sheet = buildRulesSheet(base({ lang: 'es', playoffs: { ...base().playoffs!, tiebreakerLabels: labels('es') } }), es)
    expect(sheet.find((s) => s.id === 'waivers')!.title).toBe('Reclamos y agentes libres')
    expect(rule(sheet, 'trades.deadline')?.value).toBe('Después de la semana 11')
    expect(rule(sheet, 'waivers.budget')?.means).toBe('Cada equipo tiene $100 para gastar en reclamos durante toda la temporada.')
    expect(rule(sheet, 'playoffs.tiebreakers')?.value).toContain('1. Puntos a favor')
    expect(allText(sheet).toLowerCase()).not.toContain('waiver')
  })
})

describe('every string the sheet can say exists in both languages', () => {
  const variants: RulesSheetInput[] = []
  for (const concept of RULES_SHEET_CONCEPTS) variants.push(base({ concept }))
  for (const type of WAIVER_TYPES) variants.push(base({ waivers: { type, faabBudget: 50 } }))
  for (const reviewMode of TRADE_REVIEW_MODES) variants.push(base({ trades: { ...base().trades!, reviewMode } }))
  for (const type of DRAFT_TYPES) for (const orderMethod of DRAFT_ORDER_METHODS) variants.push(base({ draft: { ...base().draft!, type, orderMethod } }))
  for (const playerPool of ['rookies_only', 'veterans_only']) variants.push(base({ draft: { ...base().draft!, playerPool } }))
  for (const scoring of ['half_ppr', 'standard', 'h2h_categories', 'points', 'Custom points']) variants.push(base({ scoring }))
  for (const cost of KEEPER_COSTS)
    variants.push(base({ keeper: { count: { value: 1, provenance: 'league_setting', basis: '' }, cost: { value: cost, provenance: 'league_setting', basis: '' }, maxYears: 2 } }))
  for (const release of GUILLOTINE_RELEASES)
    variants.push(base({ guillotine: { teamsPerChop: 2, startWeek: 2, endWeek: 14, advanced: { steps: [{ fromWeek: 6, chops: 1 }], overrides: { '8': 0, '9': 2 }, immunity: 'top_scorer' }, tiebreakers: [...GUILLOTINE_TIEBREAKS], release } }))
  for (const mode of [{ mode: 'same' as const }, { mode: 'open' as const }, { mode: 'week' as const, week: 9 }])
    variants.push(base({ dynastyFamily: true, trades: { ...base().trades!, pickTrading: true, pickDeadline: mode, pickTerms: false, deadlineWeek: null, deadlineAt: '2026-11-01T17:00:00Z' } }))
  for (const stealing of [DEFAULT_TAXI_STEALING_RULE, { enabled: true, protectHours: 24, claimsPerSeason: 0 }, { enabled: true, protectHours: 72, claimsPerSeason: 3 }])
    variants.push(base({ dynastyFamily: true, taxi: { slots: 2, yearsLimit: 3, nonRookies: true, deadlineWeek: 6, stealing } }))
  variants.push(base({ medianGame: true, medianInPlayoffs: true, lineupMode: 'daily', irSlots: 0, playoffs: { ...base().playoffs!, byes: 0, thirdPlace: false } }))
  variants.push(base({ medianGame: true, lineupMode: 'weekly', trades: { ...base().trades!, deadlineWeek: null } }))
  variants.push(base({ native: false, platform: null }))
  variants.push(base({ draft: { ...base().draft!, timerPreset: '30s' } }), base({ draft: { ...base().draft!, timerPreset: '24h' } }), base({ draft: { ...base().draft!, timerPreset: 'custom', timerCustomSeconds: 60 } }))

  it.each(['en', 'es'] as const)('%s: no key is ever shown raw, and no {{var}} is left unfilled', (lang) => {
    const t = rulesT(lang)
    for (const v of variants) {
      const text = allText(buildRulesSheet({ ...v, lang }, t))
      expect(text).not.toMatch(/rules\.[a-zA-Z]/)
      expect(text).not.toContain('{{')
      if (lang === 'es') expect(text.toLowerCase()).not.toContain('waiver')
    }
  })
})

describe('helpers', () => {
  it('reads scoring the way leagues store it', () => {
    expect(['ppr', 'PPR', 'full'].map(scoringKind)).toEqual(['ppr', 'ppr', 'ppr'])
    expect(['half_ppr', 'Half PPR', 'half-ppr'].map(scoringKind)).toEqual(['half_ppr', 'half_ppr', 'half_ppr'])
    expect(['std', 'standard', 'non-ppr'].map(scoringKind)).toEqual(['standard', 'standard', 'standard'])
    expect(['h2h_categories', 'roto'].map(scoringKind)).toEqual(['categories', 'categories'])
    expect([null, '', 'custom'].map(scoringKind)).toEqual([null, null, null])
    expect(['points', 'h2h_points'].map(scoringKind)).toEqual(['points', 'points'])
  })

  it('turns pick-timer presets into seconds', () => {
    expect(timerSeconds('30s', null)).toBe(30)
    expect(timerSeconds('3h', null)).toBe(10800)
    expect(timerSeconds('custom', 45)).toBe(45)
    expect(timerSeconds('custom', null)).toBeNull()
    expect(timerSeconds('soon', null)).toBeNull()
  })
})
