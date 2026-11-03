/**
 * Two rules-popup corrections (2026-10-29).
 *
 * 1. The rookie lottery's TIEBREAK is described, now that a tie has one meaning everywhere the engine
 *    reads it (lib/draft-lottery/standingsForLottery.ts `applyTiebreak`): the team that scored less is
 *    the worse finish. One line in the Dynasty section, and a "What changed" line when only it moves.
 *
 * 2. 🛑 THE DRAFT SECTION SAID "WEIGHTED LOTTERY" WHEN NO LOTTERY RUNS. It read `draft_order_mode`
 *    alone, but every engine path that seats a draw requires a dynasty league whose
 *    `rookiePickOrderMethod` is `weighted_lottery` (resolveWeightedLotterySlotOrderForLeague,
 *    ensureRookieDraftLottery), past its founding season. Anywhere else buildSlotOrderForLeague seats
 *    the commissioner's saved order, else the seat order — the `manual` sentence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { dynastyRulesFromConfig, rookieDraftLotteryRule, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import type { RookieDraftLotteryRule, RuleSnapshot } from '@/lib/league-rules-explainer/types'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG, type WeightedLotteryConfig } from '@/lib/draft-lottery/types'

const m = vi.hoisted(() => {
  const state = {
    league: {} as Record<string, unknown>,
    ls: null as Record<string, unknown> | null,
    session: null as Record<string, unknown> | null,
    eligible: true,
  }
  return {
    state,
    eligibility: vi.fn(async () => ({ eligible: state.eligible, reason: 'x', currentSeason: 2027, isStartupLeague: !state.eligible })),
    prisma: {
      league: { findUnique: vi.fn(async () => structuredClone(state.league)) },
      leagueSettings: { findUnique: vi.fn(async () => (state.ls ? structuredClone(state.ls) : null)) },
      draftSession: { findFirst: vi.fn(async () => (state.session ? structuredClone(state.session) : null)) },
    },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', async (orig) => ({
  ...(await orig<typeof import('@/lib/draft-lottery/dynastyYearGuard')>()),
  checkDynastyLotteryEligibility: m.eligibility,
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ draft_type: 'snake', rounds: 15, timer_seconds: 90, third_round_reversal: false, autopick_behavior: 'queue-first' })),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    timerMode: 'per_pick', slowDraftPauseWindow: null, allowPicksDuringOvernightPause: false, autoPickEnabled: true,
    orphanTeamAiManagerEnabled: false, orphanDrafterMode: 'cpu',
  })),
}))

import { loadDraftRules } from '@/lib/league-rules-explainer/loadDraftRules'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\.|\{\{|\}\}|[{}"[\]]|undefined|null|NaN|\[object|_pf|points_for|seeded_random|lower_/)
    if (lang === 'es') expect(l.toLowerCase(), l).not.toContain('waiver')
  }
}

/* ------------------------------------------------------------------ 1. the tiebreak line */

const cfg = (over: Partial<WeightedLotteryConfig> = {}): WeightedLotteryConfig => ({ ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true, ...over })
const dynastyRow: RulesLeagueRow = {
  platform: 'allfantasy', sport: 'NFL', leagueType: 'dynasty', isDynasty: true, leagueSize: 12, scoring: 'ppr',
  playoffTeams: 6, playoffStartWeek: 15, waiverType: 'faab', waiverBudget: 100, settings: { scoring_mode: 'points' },
}
const snapshot = (lottery: RookieDraftLotteryRule | null): RuleSnapshot => ({
  ...ruleSnapshotFromLeague(dynastyRow),
  ...dynastyRulesFromConfig({ rookiePickOrderMethod: 'weighted_lottery', rookieDraftRounds: 4, rookieDraftType: 'linear' }),
  rookieDraftLottery: lottery,
})
const lotteryLines = (s: RuleSnapshot, lang: 'en' | 'es') =>
  explainLeagueRules(s)
    .filter((x) => x.id === 'dynasty')
    .flatMap((x) => x.lines.filter((l) => l.id.startsWith('dynasty-lottery')).map((l) => [l.id, renderRuleText(l.text, t(lang), lang)] as const))

describe('the rookie lottery tiebreak, in the rules popup', () => {
  it.each([
    ['lower_points_for', 'points_for', 'A tie in the standings goes to the team that scored fewer points.', 'Un empate en la clasificación favorece al equipo que anotó menos puntos.'],
    ['lower_max_pf', 'max_pf', 'A tie in the standings goes to the team with the lower max PF.', 'Un empate en la clasificación favorece al equipo con menor max PF.'],
    [
      'seeded_random',
      'random',
      'A tie in the standings goes to the team that scored fewer points, then to a seeded random draw.',
      'Un empate en la clasificación favorece al equipo que anotó menos puntos y, si sigue el empate, lo decide un sorteo con semilla.',
    ],
  ] as const)('%s', (mode, tiebreak, en, es) => {
    const rule = rookieDraftLotteryRule('weighted_lottery', cfg({ tiebreakMode: mode }))!
    expect(rule.tiebreak).toBe(tiebreak)
    for (const [lang, want] of [['en', en], ['es', es]] as const) {
      const lines = lotteryLines(snapshot(rule), lang)
      expectClean(lines.map(([, l]) => l), lang)
      // One sentence, after the other lottery lines.
      expect(lines.map(([id]) => id)).toEqual(['dynasty-lottery-draw', 'dynasty-lottery-odds', 'dynasty-lottery-rest', 'dynasty-lottery-tiebreak'])
      expect(lines[3][1]).toBe(want)
    }
  })

  it('a stored mode the engine does not know is sorted as lower_points_for, so it reads as that', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ tiebreakMode: 'coin_flip' as never }))!.tiebreak).toBe('points_for')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ tiebreakMode: 'constructor' as never }))!.tiebreak).toBe('points_for')
  })

  it('a value stored before the tiebreak existed still reads, with no tiebreak line', () => {
    const { tiebreak: _drop, ...old } = rookieDraftLotteryRule('weighted_lottery', cfg())!
    expect(lotteryLines(snapshot(old), 'en').map(([id]) => id)).toEqual(['dynasty-lottery-draw', 'dynasty-lottery-odds', 'dynasty-lottery-rest'])
  })

  it('an unknown tiebreak in a stored value drops the lottery lines, never shows it raw', () => {
    const bad = { ...rookieDraftLotteryRule('weighted_lottery', cfg())!, tiebreak: 'coin_flip' } as unknown as RookieDraftLotteryRule
    expect(lotteryLines(snapshot(bad), 'en')).toEqual([])
  })
})

describe('a tiebreak change gets its own "What changed" line', () => {
  const line = (before: RookieDraftLotteryRule, after: RookieDraftLotteryRule, lang: 'en' | 'es') => {
    const c = explainRuleChange({ key: 'rookieDraftLottery', before, after })
    return c ? renderChangeLine(c, t(lang), lang) : null
  }
  const rule = (mode: WeightedLotteryConfig['tiebreakMode'], over: Partial<WeightedLotteryConfig> = {}) =>
    rookieDraftLotteryRule('weighted_lottery', cfg({ tiebreakMode: mode, ...over }))!

  it('in English and Spanish, with the new tiebreak as its one sentence', () => {
    const en = line(rule('lower_max_pf'), rule('lower_points_for'), 'en')!
    expect(en).toBe(
      'Rookie draft lottery: The 6 worst non-playoff teams for the first 6 picks, odds by record, the rest by reverse max PF, ties to the lower max PF → The 6 worst non-playoff teams for the first 6 picks, odds by record, the rest by reverse max PF, ties to fewer points — A tie in the standings goes to the team that scored fewer points.',
    )
    const es = line(rule('lower_max_pf'), rule('seeded_random'), 'es')!
    expectClean([es], 'es')
    expect(es).toBe(
      'Lotería del draft de novatos: Los 6 peores equipos fuera de playoffs por las primeras 6 selecciones, probabilidades según el récord, el resto por max PF inverso, empates a favor del menor max PF → Los 6 peores equipos fuera de playoffs por las primeras 6 selecciones, probabilidades según el récord, el resto por max PF inverso, empates a favor de menos puntos y luego un sorteo con semilla — Un empate en la clasificación favorece al equipo que anotó menos puntos y, si sigue el empate, lo decide un sorteo con semilla.',
    )
  })

  it('the diff carries it: a save that moves only the tiebreak is a change', () => {
    const before = { rookieDraftLottery: rule('lower_max_pf') } as Partial<RuleSnapshot>
    const after = { rookieDraftLottery: rule('lower_points_for') } as Partial<RuleSnapshot>
    expect(diffRuleSnapshots(before, after).map((c) => c.key)).toEqual(['rookieDraftLottery'])
  })

  it('the tiebreak and another part at once: the values say it, with no one-part consequence', () => {
    const l = line(rule('lower_max_pf'), rule('lower_points_for', { weightingMode: 'inverse_points_for' }), 'en')!
    expect(l).toContain('ties to fewer points')
    expect(l).not.toContain(' — ')
  })
})

/* ------------------------------------------------------------------ 2. the Draft section's order line */

const draftOrderLine = (s: Partial<RuleSnapshot>, lang: 'en' | 'es') => {
  const full = { ...ruleSnapshotFromLeague({ ...dynastyRow, leagueType: 'redraft', isDynasty: false }), ...s } as RuleSnapshot
  const line = explainLeagueRules(full).find((x) => x.id === 'draft')?.lines.find((l) => l.id === 'draft-order')
  return line ? renderRuleText(line.text, t(lang), lang) : null
}

const baseLeague = (over: Record<string, unknown>) => ({
  id: 'L', platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', isDynasty: false, leagueVariant: null,
  survivorMode: false, guillotineMode: false, settings: { draft_order_mode: 'weighted_lottery' }, dynastyConfig: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.state.eligible = true
  m.state.ls = null
  m.state.session = {
    status: 'pre_draft', draftType: 'snake', rounds: 15, timerSeconds: 90, thirdRoundReversal: false,
    auctionBudgetPerTeam: null, cpuAutoPick: true, draftModeLabel: null,
  }
})

describe('the Draft section says how the order is really seated', () => {
  it('reads a keeper league limit from the current draft, including zero', async () => {
    m.state.league = baseLeague({ leagueType: 'keeper' })
    m.state.session = { ...m.state.session, keeperConfig: { maxKeepers: 3 } }
    expect((await loadDraftRules('L')).keeperCount).toBe(3)
    m.state.session = { ...m.state.session, keeperConfig: { maxKeepers: 0 } }
    expect((await loadDraftRules('L')).keeperCount).toBe(0)
    m.state.session = { ...m.state.session, keeperConfig: {} }
    expect((await loadDraftRules('L')).keeperCount).toBeUndefined()
  })
  it('(a) redraft, draft_order_mode weighted_lottery: no lottery runs — the commissioner’s order', async () => {
    m.state.league = baseLeague({})
    const r = await loadDraftRules('L')
    expect(r.draftOrderMethod).toBe('manual')
    expect(draftOrderLine(r, 'en')).toBe('The commissioner sets the draft order, by hand or with a random draw.')
    expect(draftOrderLine(r, 'es')).toBe('El comisionado fija el orden del draft, a mano o con un sorteo.')
    // Never asked: not a dynasty league.
    expect(m.eligibility).not.toHaveBeenCalled()
  })

  it('(a) draft_order_mode randomize with no saved method: nothing shuffles — the commissioner’s order', async () => {
    m.state.league = baseLeague({ settings: { draft_order_mode: 'randomize' } })
    const r = await loadDraftRules('L')
    expect(r.draftOrderMethod).toBe('manual')
    expect(draftOrderLine(r, 'en')).toBe('The commissioner sets the draft order, by hand or with a random draw.')
  })

  it('(a) pressing Randomize records draftOrderMethod randomized, and that one reads as a random draw', async () => {
    m.state.league = baseLeague({ settings: { draft_order_mode: 'randomize' } })
    m.state.ls = { draftOrderMethod: 'randomized' }
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('random')
  })

  it('(a) and the saved order method still wins over the mode, as before', async () => {
    m.state.league = baseLeague({})
    m.state.ls = { draftOrderMethod: 'randomized' }
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('random')
  })

  it('(b) dynasty whose rookie order is the lottery, past its founding season: the lottery', async () => {
    m.state.league = baseLeague({ leagueType: 'dynasty', isDynasty: true, dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } })
    const r = await loadDraftRules('L')
    expect(r.draftOrderMethod).toBe('weighted_lottery')
    expect(draftOrderLine(r, 'en')).toBe('The draft order is set by a weighted lottery.')
    expect(draftOrderLine(r, 'es')).toBe('El orden del draft lo decide una lotería ponderada.')
    expect(m.eligibility).toHaveBeenCalledWith('L')
  })

  it('(b) the devy variants count as dynasty, as the engine reads them', async () => {
    m.state.league = baseLeague({ leagueVariant: 'devy_dynasty', dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } })
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('weighted_lottery')
  })

  it('(b) in its founding season the engine refuses the lottery, so this does too', async () => {
    m.state.eligible = false
    m.state.league = baseLeague({ leagueType: 'dynasty', isDynasty: true, dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } })
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('manual')
  })

  it('(c) dynasty whose rookie order is something else: no lottery, whatever draft_order_mode says', async () => {
    for (const dynastyConfig of [{ rookiePickOrderMethod: 'max_pf' }, { rookiePickOrderMethod: 'reverse_standings' }, null]) {
      m.state.league = baseLeague({ leagueType: 'dynasty', isDynasty: true, dynastyConfig })
      const r = await loadDraftRules('L')
      expect(r.draftOrderMethod, JSON.stringify(dynastyConfig)).toBe('manual')
      expect(draftOrderLine(r, 'en')).toBe('The commissioner sets the draft order, by hand or with a random draw.')
    }
  })

  it('(c) and draft_order_mode is not needed for the lottery: the engine never reads it', async () => {
    m.state.league = baseLeague({ leagueType: 'dynasty', isDynasty: true, settings: { draft_order_mode: 'randomize' }, dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } })
    expect((await loadDraftRules('L')).draftOrderMethod).toBe('weighted_lottery')
  })
})

describe('the "What changed" card for a draft_order_mode change', () => {
  const change = async (from: Record<string, unknown>, to: Record<string, unknown>) => {
    m.state.league = baseLeague(from)
    const before = await loadDraftRules('L')
    m.state.league = baseLeague(to)
    const after = await loadDraftRules('L')
    return diffRuleSnapshots(before, after)
  }

  it('🛑 redraft manual → weighted_lottery: nothing the engine seats moves, so no false "→ weighted lottery" line', async () => {
    expect(await change({ settings: { draft_order_mode: 'manual' } }, { settings: { draft_order_mode: 'weighted_lottery' } })).toEqual([])
  })

  it('🛑 redraft manual → randomize: nothing is shuffled, so no false "→ Random draw" line', async () => {
    expect(await change({ settings: { draft_order_mode: 'manual' } }, { settings: { draft_order_mode: 'randomize' } })).toEqual([])
  })

  it('dynasty: switching the rookie order onto the lottery is what moves the Draft section, and its line is true', async () => {
    const c = await change(
      { leagueType: 'dynasty', isDynasty: true, dynastyConfig: { rookiePickOrderMethod: 'max_pf' } },
      { leagueType: 'dynasty', isDynasty: true, dynastyConfig: { rookiePickOrderMethod: 'weighted_lottery' } },
    )
    expect(c).toEqual([{ key: 'draftOrderMethod', before: 'manual', after: 'weighted_lottery' }])
    const line = explainRuleChange(c[0])!
    expect(renderChangeLine(line, t('en'), 'en')).toBe(
      'Draft order: Set by the commissioner → Weighted lottery — The draft order is set by a weighted lottery.',
    )
  })
})
