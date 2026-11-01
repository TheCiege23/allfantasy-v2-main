/**
 * The weighted lottery's own settings (how many teams, how many picks, whose odds are better, how the
 * rest pick) in the rules popup and on the "What changed" card. The lottery orders the dynasty ROOKIE
 * draft (ensureRookieDraftLottery / resolveWeightedLotterySlotOrderForLeague both require
 * `rookiePickOrderMethod === 'weighted_lottery'`), so the lines sit in the Dynasty section.
 *
 * The PUT /draft-lottery/config route runs against the real loaders over a stateful in-memory league,
 * so the before/after come from the write itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { dynastyRulesFromConfig, rookieDraftLotteryRule, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import type { RookieDraftLotteryRule, RuleSnapshot } from '@/lib/league-rules-explainer/types'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG, type WeightedLotteryConfig } from '@/lib/draft-lottery/types'

type Db = { league: Record<string, unknown>; dynasty: Record<string, unknown> | null; session: Record<string, unknown> | null }

const m = vi.hoisted(() => {
  const state: { db: Db; failReads: boolean } = { db: { league: {}, dynasty: null, session: null }, failReads: false }
  return {
    state,
    publish: vi.fn(async (_input: unknown) => undefined),
    eligibility: vi.fn(async () => ({ eligible: true, reason: 'ok', currentSeason: 2026, isStartupLeague: false })),
    prisma: {
      league: {
        findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) => {
          // The loaders select the dynasty config or the draft columns; the storage reads settings only.
          if (state.failReads && args?.select && ('dynastyConfig' in args.select || 'leagueType' in args.select)) throw new Error('db down')
          const league = structuredClone(state.db.league)
          return args?.select && 'dynastyConfig' in args.select ? { ...league, dynastyConfig: structuredClone(state.db.dynasty) } : league
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.db.league = { ...state.db.league, ...structuredClone(data) }
          return {}
        }),
      },
      leagueSettings: { findUnique: vi.fn(async () => null) },
      draftSession: {
        findFirst: vi.fn(async () => {
          if (state.failReads) throw new Error('db down')
          return state.db.session ? structuredClone(state.db.session) : null
        }),
      },
    },
  }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({
  checkDynastyLotteryEligibility: m.eligibility,
}))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: m.publish }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({ draft_type: 'linear', rounds: 4, timer_seconds: 90, third_round_reversal: false, autopick_behavior: 'queue-first' })),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: vi.fn(async () => ({
    timerMode: 'per_pick', slowDraftPauseWindow: null, allowPicksDuringOvernightPause: false, autoPickEnabled: true,
    orphanTeamAiManagerEnabled: false, orphanDrafterMode: 'cpu',
  })),
}))

import { PUT } from '@/app/api/leagues/[leagueId]/draft-lottery/config/route'

/* ------------------------------------------------------------------ helpers */

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\.|\{\{|\}\}|[{}"[\]]|undefined|null|NaN|\[object|non_playoff|max_pf|reverse_|custom|inverse/)
    if (lang === 'es') expect(l.toLowerCase(), l).not.toContain('waiver')
  }
}

const cfg = (over: Partial<WeightedLotteryConfig> = {}): WeightedLotteryConfig => ({ ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true, ...over })
const rule = (over: Partial<RookieDraftLotteryRule> = {}): RookieDraftLotteryRule => ({ teams: 6, picks: 6, pool: 'non_playoff', odds: 'record', rest: 'reverse_max_pf', tiebreak: 'max_pf', ...over })

const dynastyRow: RulesLeagueRow = {
  platform: 'allfantasy', sport: 'NFL', leagueType: 'dynasty', isDynasty: true, leagueSize: 12, scoring: 'ppr',
  playoffTeams: 6, playoffStartWeek: 15, waiverType: 'faab', waiverBudget: 100, settings: { scoring_mode: 'points' },
}
const dynasty = (order: string, lottery: unknown): RuleSnapshot => ({
  ...ruleSnapshotFromLeague(dynastyRow),
  ...dynastyRulesFromConfig({ rookiePickOrderMethod: order, rookieDraftRounds: 4, rookieDraftType: 'linear' }),
  rookieDraftLottery: lottery as RookieDraftLotteryRule | null,
})
const dynastyLines = (s: RuleSnapshot, lang: 'en' | 'es' = 'en') =>
  explainLeagueRules(s).filter((x) => x.id === 'dynasty').flatMap((x) => x.lines.map((l) => renderRuleText(l.text, t(lang), lang)))
const lotteryLineIds = (s: RuleSnapshot) => explainLeagueRules(s).flatMap((x) => x.lines.map((l) => l.id)).filter((id) => id.includes('lottery'))

/* ------------------------------------------------------------------ the rule, as the engine draws */

describe('rookieDraftLotteryRule maps the config to what the draw does', () => {
  it('the default config', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg())).toEqual(rule())
  })

  it('each eligibility mode: only non_playoff draws from the teams that missed the playoffs', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ eligibilityMode: 'non_playoff' }))!.pool).toBe('non_playoff')
    for (const mode of ['bottom_n', 'all_teams', 'custom'] as const) {
      expect(rookieDraftLotteryRule('weighted_lottery', cfg({ eligibilityMode: mode, bottomN: 3 }))!.pool, mode).toBe('worst')
    }
  })

  it('each weighting mode, with custom weights read as the equal weights the engine gives them', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ weightingMode: 'inverse_standings' }))!.odds).toBe('record')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ weightingMode: 'inverse_points_for' }))!.odds).toBe('points_for')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ weightingMode: 'inverse_max_pf' }))!.odds).toBe('max_pf')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ weightingMode: 'custom_weights' }))!.odds).toBe('equal')
  })

  it('each fallback order, with manual read as the reverse standings the engine seats', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ fallbackOrder: 'reverse_standings' }))!.rest).toBe('reverse_standings')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ fallbackOrder: 'reverse_max_pf' }))!.rest).toBe('reverse_max_pf')
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ fallbackOrder: 'manual' }))!.rest).toBe('reverse_standings')
  })

  it('picks never exceed the teams in the draw', () => {
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ lotteryTeamCount: 4, lotteryPickCount: 6 }))).toMatchObject({ teams: 4, picks: 4 })
  })

  it('null unless the rookie draft is ordered by the lottery, and for any value it has no reading for', () => {
    for (const order of ['max_pf', 'reverse_standings', 'commissioner', null]) expect(rookieDraftLotteryRule(order, cfg())).toBeNull()
    expect(rookieDraftLotteryRule('weighted_lottery', null)).toBeNull()
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ weightingMode: 'coin_flip' as never }))).toBeNull()
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ eligibilityMode: 'constructor' as never }))).toBeNull()
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ fallbackOrder: 'toString' as never }))).toBeNull()
    expect(rookieDraftLotteryRule('weighted_lottery', cfg({ lotteryPickCount: 0 }))).toBeNull()
  })

  it('carries no audit seed', () => {
    expect(JSON.stringify(rookieDraftLotteryRule('weighted_lottery', cfg({ randomSeed: 'SEED-1', auditSeed: 'SEED-2' })))).not.toContain('SEED')
  })
})

/* ------------------------------------------------------------------ the popup */

describe('the Dynasty section explains the lottery, only while it orders the rookie draft', () => {
  it('in English: the owner’s example reads as one sentence each', () => {
    const lines = dynastyLines(dynasty('weighted_lottery', rule()))
    expectClean(lines, 'en')
    expect(lines).toEqual(
      expect.arrayContaining([
        'The rookie draft order is set by a weighted lottery.',
        'The 6 worst teams that missed the playoffs draw for the first 6 picks.',
        'In the draw, worse records get better odds.',
        'Every other team picks after them: teams that missed the playoffs from the lowest max PF up, then the playoff teams, worst finish first.',
      ]),
    )
    const i = lines.indexOf('The rookie draft order is set by a weighted lottery.')
    expect(lines[i + 1]).toBe('The 6 worst teams that missed the playoffs draw for the first 6 picks.')
  })

  it.each([
    [rule({ pool: 'worst', teams: 8, picks: 3 }), 'The 8 worst teams in the standings draw for the first 3 picks.', 'Los 8 peores equipos de la clasificación sortean las primeras 3 selecciones.'],
    [rule({ teams: 1, picks: 1 }), 'Only the worst team that missed the playoffs is in the draw, for the first pick.', 'Solo el peor equipo que no llegó a los playoffs entra en el sorteo, por la primera selección.'],
    [rule({ odds: 'points_for' }), 'In the draw, teams that scored fewer points get better odds.', 'En el sorteo, los equipos que anotaron menos puntos tienen más probabilidades.'],
    [rule({ odds: 'max_pf' }), 'In the draw, teams with a lower max PF get better odds.', 'En el sorteo, los equipos con menor max PF tienen más probabilidades.'],
    [rule({ odds: 'equal' }), 'Every team in the draw has the same odds.', 'Todos los equipos del sorteo tienen las mismas probabilidades.'],
    [rule({ rest: 'reverse_standings' }), 'Every other team picks after them in reverse order of the standings.', 'Los demás equipos eligen después, en orden inverso a la clasificación.'],
  ])('%j', (r, en, es) => {
    const enLines = dynastyLines(dynasty('weighted_lottery', r))
    const esLines = dynastyLines(dynasty('weighted_lottery', r), 'es')
    expectClean(enLines, 'en')
    expectClean(esLines, 'es')
    expect(enLines).toContain(en)
    expect(esLines).toContain(es)
  })

  it('the default config in Spanish, with no English left over', () => {
    const lines = dynastyLines(dynasty('weighted_lottery', rule()), 'es')
    expectClean(lines, 'es')
    expect(lines).toEqual(
      expect.arrayContaining([
        'El orden del draft de novatos lo decide una lotería ponderada.',
        'Los 6 peores equipos que no llegaron a los playoffs sortean las primeras 6 selecciones.',
        'En el sorteo, los peores récords tienen más probabilidades.',
      ]),
    )
  })

  it('no lottery lines when the rookie order is not the lottery, even with a stored lottery value', () => {
    expect(lotteryLineIds(dynasty('max_pf', rule()))).toEqual([])
    expect(lotteryLineIds(dynasty('weighted_lottery', rule()))).toEqual(['dynasty-lottery-draw', 'dynasty-lottery-odds', 'dynasty-lottery-rest', 'dynasty-lottery-tiebreak'])
  })

  it('an unknown or malformed value drops the lottery lines, never shows them raw', () => {
    for (const bad of [rule({ odds: 'coin_flip' as never }), rule({ pool: 'custom' as never }), rule({ picks: 7, teams: 6 }), { teams: '6' }, 'x', null]) {
      const s = dynasty('weighted_lottery', bad)
      expect(lotteryLineIds(s), JSON.stringify(bad)).toEqual([])
      expectClean(dynastyLines(s), 'en')
    }
  })

  it('the main Draft section never carries the lottery lines', () => {
    const s = { ...dynasty('weighted_lottery', rule()), draftStatus: 'scheduled' as const, draftType: 'linear', draftRounds: 4, draftOrderMethod: 'weighted_lottery' }
    const draft = explainLeagueRules(s).find((x) => x.id === 'draft')!
    expect(draft.lines.map((l) => l.id).filter((id) => id.includes('lottery'))).toEqual([])
  })
})

/* ------------------------------------------------------------------ the change line */

describe('a lottery change gets a "What changed" line', () => {
  const line = (before: unknown, after: unknown, lang: 'en' | 'es' = 'en') => {
    const c = explainRuleChange({ key: 'rookieDraftLottery', before, after })
    return c ? renderChangeLine(c, t(lang), lang) : null
  }

  it('the number of lottery picks, in English and Spanish, with the new rule as the consequence', () => {
    expect(line(rule(), rule({ picks: 4 }))).toBe(
      'Rookie draft lottery: The 6 worst non-playoff teams for the first 6 picks, odds by record, the rest by reverse max PF, ties to the lower max PF → The 6 worst non-playoff teams for the first 4 picks, odds by record, the rest by reverse max PF, ties to the lower max PF — The 6 worst teams that missed the playoffs draw for the first 4 picks.',
    )
    const es = line(rule(), rule({ picks: 4 }), 'es')!
    expectClean([es], 'es')
    expect(es).toBe(
      'Lotería del draft de novatos: Los 6 peores equipos fuera de playoffs por las primeras 6 selecciones, probabilidades según el récord, el resto por max PF inverso, empates a favor del menor max PF → Los 6 peores equipos fuera de playoffs por las primeras 4 selecciones, probabilidades según el récord, el resto por max PF inverso, empates a favor del menor max PF — Los 6 peores equipos que no llegaron a los playoffs sortean las primeras 4 selecciones.',
    )
  })

  it('the odds alone', () => {
    expect(line(rule(), rule({ odds: 'max_pf' }))).toMatch(/odds by record.*→.*odds by max PF.* — In the draw, teams with a lower max PF get better odds\.$/)
  })

  it('the rest alone', () => {
    expect(line(rule(), rule({ rest: 'reverse_standings' }))).toMatch(/ — Every other team picks after them in reverse order of the standings\.$/)
  })

  it('several parts at once: the values say it, with no consequence that names only one', () => {
    const l = line(rule(), rule({ odds: 'equal', rest: 'reverse_standings' }))!
    expect(l).toContain('equal odds')
    expect(l).not.toContain(' — ')
  })

  it('switching the lottery on or off is the rookie order line’s, not this one', () => {
    expect(line(null, rule())).toBeNull()
    expect(line(rule(), null)).toBeNull()
  })

  it('an unknown value is dropped, never raw', () => {
    expect(line(rule(), { ...rule(), odds: 'coin_flip' })).toBeNull()
  })
})

/* ------------------------------------------------------------------ PUT /draft-lottery/config */

const put = (body: unknown) =>
  PUT(createMockNextRequest('http://x/api/leagues/L/draft-lottery/config', { method: 'PUT', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })

function published(): { meta: Record<string, unknown>; skipNotifications?: boolean; eventType?: string } | null {
  const call = m.publish.mock.calls[0]
  return call ? (call[0] as { meta: Record<string, unknown>; skipNotifications?: boolean; eventType?: string }) : null
}
const changes = () => (published()?.meta.ruleChanges ?? null) as Array<{ key: string; before: unknown; after: unknown }> | null

beforeEach(() => {
  vi.clearAllMocks()
  m.eligibility.mockResolvedValue({ eligible: true, reason: 'ok', currentSeason: 2026, isStartupLeague: false })
  m.state.failReads = false
  m.state.db = {
    league: {
      id: 'L', platform: 'allfantasy', sport: 'NFL', leagueType: 'dynasty', isDynasty: true, leagueVariant: null,
      survivorMode: false, guillotineMode: false, bestBallMode: false,
      settings: { draft_order_mode: 'weighted_lottery', draft_lottery_config: { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true } },
    },
    dynasty: { rookiePickOrderMethod: 'weighted_lottery' },
    // The rookie phase: the current draft is a rookie draft, so the Draft section is hidden.
    session: {
      status: 'pre_draft', draftType: 'linear', rounds: 4, timerSeconds: 90, thirdRoundReversal: false,
      auctionBudgetPerTeam: null, cpuAutoPick: true, draftModeLabel: 'rookie',
    },
  }
})

describe('PUT /draft-lottery/config → settings_changed.meta.ruleChanges', () => {
  it('allows startup commissioners to save future lottery parameters without changing startup draft mode', async () => {
    m.eligibility.mockResolvedValue({ eligible: false, reason: 'startup', currentSeason: 2026, isStartupLeague: true })
    m.state.db.league.settings = { draft_order_mode: 'manual' }
    expect((await put({ lotteryConfig: { lotteryTeamCount: 4 } })).status).toBe(200)
    expect((m.state.db.league.settings as any).draft_order_mode).toBe('manual')
    expect((m.state.db.league.settings as any).draft_lottery_config.lotteryTeamCount).toBe(4)
    expect((await put({ draftOrderMode: 'weighted_lottery' })).status).toBe(403)
  })

  it('an odds change in the rookie phase publishes the lottery rule, silently, and nothing from the hidden Draft section', async () => {
    const res = await put({ lotteryConfig: { weightingMode: 'inverse_max_pf' } })
    expect(res.status).toBe(200)
    const ev = published()!
    expect(ev.eventType).toBe('settings_changed')
    expect(ev.skipNotifications).toBe(true)
    expect(changes()).toEqual([{ key: 'rookieDraftLottery', before: rule(), after: rule({ odds: 'max_pf' }) }])
    expect(JSON.stringify(ev.meta)).not.toMatch(/Seed|seed/)
    // The save itself landed.
    expect((m.state.db.league.settings as { draft_lottery_config: { weightingMode: string } }).draft_lottery_config.weightingMode).toBe('inverse_max_pf')
  })

  it('the number of lottery picks', async () => {
    await put({ lotteryConfig: { lotteryPickCount: 4 } })
    expect(changes()).toEqual([{ key: 'rookieDraftLottery', before: rule(), after: rule({ picks: 4 }) }])
  })

  it('a save that changes nothing the draw reads publishes nothing (no-op, a seed, bottomN, custom → all teams)', async () => {
    await put({ lotteryConfig: { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, enabled: true } })
    await put({ lotteryConfig: { randomSeed: 'abc', auditSeed: 'abc', allowCommissionerOverride: false } })
    await put({ lotteryConfig: { bottomN: 3 } })
    expect(m.publish).not.toHaveBeenCalled()
    await put({ lotteryConfig: { eligibilityMode: 'all_teams' } })
    expect(m.publish).toHaveBeenCalledTimes(1)
    vi.clearAllMocks()
    await put({ lotteryConfig: { eligibilityMode: 'custom' } })
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a completed draft does not hide it: the config governs the NEXT draw', async () => {
    m.state.db.session = { ...m.state.db.session!, status: 'completed', draftModeLabel: null }
    await put({ draftOrderMode: 'manual', lotteryConfig: { lotteryTeamCount: 8, lotteryPickCount: 8 } })
    // The completed main draft's order publishes nothing; the lottery for the next draw does.
    expect(changes()).toEqual([{ key: 'rookieDraftLottery', before: rule(), after: rule({ teams: 8, picks: 8 }) }])
  })

  it('a mode change on a main draft still to come: the lottery still seats the order, so no false "→ set by the commissioner" line', async () => {
    // draft_order_mode is not what seats the draw — rookiePickOrderMethod is (resolveWeightedLotterySlotOrderForLeague).
    m.state.db.session = { ...m.state.db.session!, draftModeLabel: null }
    await put({ draftOrderMode: 'manual' })
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('switching the rookie order off the lottery is what the Draft section reports — one event, no duplicate', async () => {
    m.state.db.session = { ...m.state.db.session!, draftModeLabel: null }
    m.state.db.dynasty = { rookiePickOrderMethod: 'max_pf' }
    // With no lottery behind it, draft_order_mode → manual moves nothing the engine seats.
    await put({ draftOrderMode: 'manual' })
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a rookie draft ordered some other way: lottery settings change nothing, so no card', async () => {
    m.state.db.dynasty = { rookiePickOrderMethod: 'max_pf' }
    await put({ lotteryConfig: { lotteryPickCount: 4 } })
    expect(m.publish).not.toHaveBeenCalled()
  })

  it('a failed read never fails the save, and publishes nothing', async () => {
    m.state.failReads = true
    const res = await put({ lotteryConfig: { lotteryPickCount: 4 } })
    expect(res.status).toBe(200)
    expect(m.publish).not.toHaveBeenCalled()
    expect((m.state.db.league.settings as { draft_lottery_config: { lotteryPickCount: number } }).draft_lottery_config.lotteryPickCount).toBe(4)
  })

  it('a publisher that throws never fails the save', async () => {
    m.publish.mockRejectedValueOnce(new Error('events down'))
    expect((await put({ lotteryConfig: { lotteryPickCount: 4 } })).status).toBe(200)
  })
})
