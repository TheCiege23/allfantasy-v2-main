/**
 * THE LEAGUE RULES SHEET — every rule the commissioner has chosen, in plain words, with what each
 * one means for a manager. One sheet for every sport and format; the sections a league does not
 * have (a keeper block in redraft, chop rules outside a guillotine league) are simply absent.
 *
 * Pure: `./rulesSheetService.ts` reads the league through the existing readers and hands this
 * plain data, so the sheet can never name a value the league's own engines would not use. The
 * strings come from `lib/i18n/translations.ts` (`rules.*`), passed in as `t`, so the same sheet
 * is built in English or Spanish.
 *
 * ⚠ A RULE'S SOURCE IS SHOWN ONLY WHERE A READER CAN TELL. `default` means the league has never
 * chosen the value and the format's default applies (a playoff size the league never stored, the
 * standard tiebreaker order); `league` means it was read from the league's own settings. Most
 * columns cannot tell a chosen value from a schema default, so those lines carry no source rather
 * than a guess.
 */
import type { PickTradeDeadline } from '@/lib/trade-deadline/pickTradeDeadline'
import type { TiebreakerKey } from '@/lib/standings/tiebreakerOrder'
import type { TaxiStealingRule } from '@/lib/taxi/taxiStealing'
import type { GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'
import type { ResolvedRule } from './types'
import { translations } from '@/lib/i18n/translations'

export type RulesT = (key: string, vars?: Record<string, string | number>) => string

/** The sheet's strings in one language, falling back to English, with `{{var}}` filled in. */
export function rulesT(lang: 'en' | 'es'): RulesT {
  const table = translations[lang] ?? translations.en
  return (key, vars) => {
    const raw = table[key] ?? translations.en[key] ?? key
    return vars ? raw.replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(vars[v] ?? '')) : raw
  }
}

export type RuleSource = 'league' | 'default'

export type RuleLine = {
  id: string
  label: string
  value: string
  /** What the rule means for a manager. Null when the value says it all. */
  means: string | null
  source: RuleSource | null
}

export type RuleSectionId = 'format' | 'scoring' | 'roster' | 'waivers' | 'trades' | 'draft' | 'playoffs' | 'keeper' | 'dynasty' | 'guillotine'

export type RuleSection = { id: RuleSectionId; title: string; rules: RuleLine[] }

/** The catalog concepts the sheet names in both languages; any other reads as its catalog label. */
export const RULES_SHEET_CONCEPTS = [
  'redraft',
  'keeper',
  'dynasty',
  'devy',
  'c2c',
  'best_ball',
  'guillotine',
  'survivor_guillotine',
  'survivor',
  'zombie',
  'big_brother',
  'tournament',
  'king_of_the_hill',
  'pirate_vampire',
  'royal',
  'salary_cap',
] as const

export const WAIVER_TYPES = ['faab', 'rolling', 'reverse_standings', 'fcfs', 'standard'] as const
export const TRADE_REVIEW_MODES = ['instant', 'commissioner', 'league_vote'] as const
export const DRAFT_TYPES = ['snake', 'linear', '3rd_reversal', 'auction'] as const
export const DRAFT_ORDER_METHODS = ['manual', 'randomized', 'prev_standings', 'worst_to_first', 'reverse_max_pf', 'custom_import'] as const
export const GUILLOTINE_TIEBREAKS = ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'] as const
export const KEEPER_COSTS = ['round_based', 'inflation', 'auction_value', 'free'] as const
export const GUILLOTINE_RELEASES = ['immediate', 'next_waiver_run', 'custom_time'] as const

export type RulesSheetInput = {
  /** AllFantasy runs the league. An imported league's rules are its platform's, and fewer are read. */
  native: boolean
  /** The host platform of an imported league (`sleeper`, `espn`, …). */
  platform: string | null
  sport: string
  teamCount: number
  /** Catalog concept id (`lib/league-rules`), or null when nothing matches. */
  concept: string | null
  conceptLabel: string | null
  dynastyFamily: boolean
  scoring: string | null
  medianGame: boolean | null
  medianInPlayoffs: boolean
  starterSlots: string[]
  rosterSize: number | null
  irSlots: number | null
  lineupMode: 'daily' | 'weekly' | null
  waivers: { type: string; faabBudget: number | null } | null
  trades: {
    allowed: boolean
    reviewMode: string
    reviewHours: number
    vetoPercent: number
    deadlineWeek: number | null
    /** ISO time the commissioner set as a close time, in addition to or instead of the week. */
    deadlineAt: string | null
    timezone: string | null
    pickTrading: boolean
    pickDeadline: PickTradeDeadline | null
    pickTerms: boolean | null
  } | null
  draft: {
    type: string
    rounds: number
    timerPreset: string
    timerCustomSeconds: number | null
    orderMethod: string
    playerPool: string
  } | null
  playoffs: {
    teams: number
    teamsSource: RuleSource
    byes: number
    startWeek: number | null
    startSource: RuleSource | null
    thirdPlace: boolean | null
    tiebreakers: TiebreakerKey[] | null
    tiebreakerLabels: Record<TiebreakerKey, string>
  } | null
  keeper: { count: ResolvedRule<number>; cost: ResolvedRule<string>; maxYears: number | null } | null
  taxi: { slots: number; yearsLimit: number | null; nonRookies: boolean; deadlineWeek: number | null; stealing: TaxiStealingRule } | null
  guillotine: {
    teamsPerChop: number
    startWeek: number
    /** Null: chops run until one team is left. */
    endWeek: number | null
    advanced: GuillotineAdvanced
    tiebreakers: string[]
    release: string
  } | null
  /** Language of the strings, for dates. */
  lang: 'en' | 'es'
}

const DEFAULT_TIEBREAKERS: readonly TiebreakerKey[] = ['points_for', 'head_to_head', 'points_against', 'all_play', 'coin_flip']

function known<T extends string>(list: readonly T[], value: string | null | undefined): T | null {
  const v = String(value ?? '').trim().toLowerCase()
  return (list as readonly string[]).includes(v) ? (v as T) : null
}

/** `ppr`, `half_ppr`, `standard`, `categories`, `points`, or null when the column says something else. */
export function scoringKind(scoring: string | null | undefined): 'ppr' | 'half_ppr' | 'standard' | 'categories' | 'points' | null {
  const s = String(scoring ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!s) return null
  if (s.includes('half')) return 'half_ppr'
  if (s.includes('categor') || s === 'roto' || s.includes('rotisserie')) return 'categories'
  // Before the `ppr` test: `non_ppr` contains it.
  if (s === 'std' || s === 'standard' || s === 'non_ppr' || s === 'no_ppr') return 'standard'
  if (s.includes('ppr') || s === 'full') return 'ppr'
  if (s === 'points' || s === 'h2h_points' || s === 'total_points') return 'points'
  return null
}

/** Pick-timer presets as seconds (`30s`, `120s`, `3h`, `24h`); `custom` reads the custom value. */
export function timerSeconds(preset: string, customSeconds: number | null): number | null {
  if (preset === 'custom') return customSeconds != null && customSeconds > 0 ? customSeconds : null
  const m = /^(\d+)(s|h)$/.exec(preset.trim())
  if (!m) return null
  return Number(m[1]) * (m[2] === 'h' ? 3600 : 1)
}

function duration(t: RulesT, seconds: number): string {
  if (seconds < 60) return t(seconds === 1 ? 'rules.unit.second' : 'rules.unit.seconds', { n: seconds })
  if (seconds < 3600) {
    const n = Math.round(seconds / 60)
    return t(n === 1 ? 'rules.unit.minute' : 'rules.unit.minutes', { n })
  }
  const n = Math.round((seconds / 3600) * 10) / 10
  return t(n === 1 ? 'rules.unit.hour' : 'rules.unit.hours', { n })
}

function teams(t: RulesT, n: number): string {
  return t(n === 1 ? 'rules.unit.team' : 'rules.unit.teams', { n })
}

function formatAt(iso: string, timezone: string | null, lang: 'en' | 'es'): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es' : 'en-US', {
      // Field by field: `dateStyle` with `timeZoneName` throws, and the zone must be named.
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || 'America/New_York',
      timeZoneName: 'short',
    }).format(at)
  } catch {
    return at.toISOString()
  }
}

/** Build every section that applies to this league, in reading order. Empty sections are dropped. */
export function buildRulesSheet(input: RulesSheetInput, t: RulesT): RuleSection[] {
  const line = (id: string, value: string, means: string | null, source: RuleSource | null = null): RuleLine => ({
    id,
    label: t(`rules.${id}.label`),
    value,
    means,
    source,
  })
  const onOff = (on: boolean) => t(on ? 'rules.value.on' : 'rules.value.off')
  const sections: RuleSection[] = []
  const add = (id: RuleSectionId, rules: Array<RuleLine | null>) => {
    const kept = rules.filter((r): r is RuleLine => r != null)
    if (kept.length) sections.push({ id, title: t(`rules.section.${id}`), rules: kept })
  }

  /* Format */
  const concept = known(RULES_SHEET_CONCEPTS, input.concept)
  add('format', [
    concept
      ? line('format.type', t(`rules.format.${concept}`), t(`rules.format.${concept}.means`))
      : input.conceptLabel
        ? line('format.type', input.conceptLabel, null)
        : null,
    input.teamCount > 0 ? line('format.teams', teams(t, input.teamCount), null) : null,
    input.native
      ? null
      : line(
          'format.platform',
          t('rules.format.platform.value', { platform: platformName(input.platform, t('rules.format.platform.other')) }),
          t('rules.format.platform.means', { platform: platformName(input.platform, t('rules.format.platform.other')) }),
        ),
  ])

  /* Scoring */
  const kind = scoringKind(input.scoring)
  add('scoring', [
    kind ? line('scoring.type', t(`rules.scoring.${kind}`), t(`rules.scoring.${kind}.means`)) : input.scoring ? line('scoring.type', input.scoring, null) : null,
    input.medianGame == null
      ? null
      : line('scoring.median', onOff(input.medianGame), t(input.medianGame ? 'rules.scoring.median.on.means' : 'rules.scoring.median.off.means')),
    input.medianGame ? line('scoring.medianPlayoffs', onOff(input.medianInPlayoffs), t(input.medianInPlayoffs ? 'rules.scoring.medianPlayoffs.on.means' : 'rules.scoring.medianPlayoffs.off.means')) : null,
  ])

  /* Roster and lineups */
  add('roster', [
    input.starterSlots.length
      ? line('roster.starters', input.starterSlots.join(', '), t('rules.roster.starters.means', { n: input.starterSlots.length }))
      : null,
    input.rosterSize != null && input.rosterSize > 0 ? line('roster.size', String(input.rosterSize), t('rules.roster.size.means', { n: input.rosterSize })) : null,
    input.irSlots == null ? null : input.irSlots > 0 ? line('roster.ir', String(input.irSlots), t('rules.roster.ir.means')) : line('roster.ir', t('rules.value.none'), t('rules.roster.ir.none.means')),
    input.lineupMode ? line('roster.lineups', t(`rules.roster.lineups.${input.lineupMode}`), t(`rules.roster.lineups.${input.lineupMode}.means`)) : null,
  ])

  /* Waivers */
  if (input.waivers) {
    const w = known(WAIVER_TYPES, input.waivers.type)
    add('waivers', [
      w ? line('waivers.type', t(`rules.waivers.${w}`), t(`rules.waivers.${w}.means`)) : null,
      w === 'faab' && input.waivers.faabBudget != null
        ? line('waivers.budget', `$${input.waivers.faabBudget}`, t('rules.waivers.budget.means', { n: input.waivers.faabBudget }))
        : null,
    ])
  }

  /* Trades */
  const tr = input.trades
  if (tr) {
    const review = known(TRADE_REVIEW_MODES, tr.reviewMode) ?? 'commissioner'
    const deadlineValue =
      tr.deadlineWeek != null && tr.deadlineAt
        ? t('rules.trades.deadline.both', { week: tr.deadlineWeek, at: formatAt(tr.deadlineAt, tr.timezone, input.lang) })
        : tr.deadlineWeek != null
          ? t('rules.trades.deadline.week', { week: tr.deadlineWeek })
          : tr.deadlineAt
            ? formatAt(tr.deadlineAt, tr.timezone, input.lang)
            : t('rules.value.none')
    const deadlineMeans =
      tr.deadlineWeek != null || tr.deadlineAt
        ? t(tr.deadlineWeek != null ? 'rules.trades.deadline.week.means' : 'rules.trades.deadline.time.means', { week: tr.deadlineWeek ?? 0 })
        : t('rules.trades.deadline.none.means')
    const pd = tr.pickDeadline
    add(
      'trades',
      tr.allowed
        ? [
            line(
              'trades.review',
              t(`rules.trades.review.${review}`, { hours: tr.reviewHours, percent: tr.vetoPercent }),
              t(`rules.trades.review.${review}.means`, { hours: tr.reviewHours, percent: tr.vetoPercent }),
            ),
            line('trades.deadline', deadlineValue, deadlineMeans),
            input.dynastyFamily || input.keeper ? line('trades.picks', onOff(tr.pickTrading), t(tr.pickTrading ? 'rules.trades.picks.on.means' : 'rules.trades.picks.off.means')) : null,
            pd && tr.pickTrading
              ? line(
                  'trades.pickDeadline',
                  t(`rules.trades.pickDeadline.${pd.mode}`, pd.mode === 'week' ? { week: pd.week } : {}),
                  t(`rules.trades.pickDeadline.${pd.mode}.means`, pd.mode === 'week' ? { week: pd.week } : {}),
                )
              : null,
            tr.pickTerms != null && tr.pickTrading ? line('trades.pickTerms', onOff(tr.pickTerms), t(tr.pickTerms ? 'rules.trades.pickTerms.on.means' : 'rules.trades.pickTerms.off.means')) : null,
          ]
        : [line('trades.allowed', onOff(false), t('rules.trades.allowed.off.means'))],
    )
  }

  /* Draft */
  const d = input.draft
  if (d) {
    const type = known(DRAFT_TYPES, d.type)
    const order = known(DRAFT_ORDER_METHODS, d.orderMethod)
    const secs = timerSeconds(d.timerPreset, d.timerCustomSeconds)
    add('draft', [
      type ? line('draft.type', t(`rules.draft.${type}`), t(`rules.draft.${type}.means`)) : null,
      type === 'auction' ? null : line('draft.rounds', String(d.rounds), t('rules.draft.rounds.means', { n: d.rounds })),
      secs != null ? line('draft.timer', duration(t, secs), t('rules.draft.timer.means', { time: duration(t, secs) })) : null,
      order && type !== 'auction' ? line('draft.order', t(`rules.draft.order.${order}`), t(`rules.draft.order.${order}.means`)) : null,
      d.playerPool === 'rookies_only' || d.playerPool === 'veterans_only'
        ? line('draft.pool', t(`rules.draft.pool.${d.playerPool}`), t(`rules.draft.pool.${d.playerPool}.means`))
        : null,
    ])
  }

  /* Playoffs and standings */
  const p = input.playoffs
  if (p) {
    const order = p.tiebreakers ?? DEFAULT_TIEBREAKERS
    add('playoffs', [
      line(
        'playoffs.teams',
        teams(t, p.teams),
        p.byes > 1 ? t('rules.playoffs.teams.byes.means', { n: p.teams, byes: p.byes }) : t(p.byes === 1 ? 'rules.playoffs.teams.bye.means' : 'rules.playoffs.teams.means', { n: p.teams }),
        p.teamsSource,
      ),
      p.startWeek != null ? line('playoffs.start', t('rules.value.week', { week: p.startWeek }), t('rules.playoffs.start.means', { week: p.startWeek, last: Math.max(1, p.startWeek - 1) }), p.startSource) : null,
      p.thirdPlace == null ? null : line('playoffs.thirdPlace', onOff(p.thirdPlace), t(p.thirdPlace ? 'rules.playoffs.thirdPlace.on.means' : 'rules.playoffs.thirdPlace.off.means')),
      input.native
        ? line(
            'playoffs.tiebreakers',
            order.map((k, i) => `${i + 1}. ${p.tiebreakerLabels[k]}`).join('  '),
            t('rules.playoffs.tiebreakers.means'),
            p.tiebreakers ? 'league' : 'default',
          )
        : null,
    ])
  }

  /* Keeper */
  const k = input.keeper
  if (k) {
    const src = (r: ResolvedRule<unknown>): RuleSource | null => (r.provenance === 'league_setting' ? 'league' : r.provenance === 'unknown' ? null : 'default')
    const cost = String(k.cost.value ?? '')
    add('keeper', [
      k.count.value != null ? line('keeper.count', String(k.count.value), t('rules.keeper.count.means', { n: k.count.value }), src(k.count)) : null,
      k.cost.value != null
        ? line(
            'keeper.cost',
            (KEEPER_COSTS as readonly string[]).includes(cost) ? t(`rules.keeper.cost.${cost}`) : cost,
            (KEEPER_COSTS as readonly string[]).includes(cost) ? t(`rules.keeper.cost.${cost}.means`) : null,
            src(k.cost),
          )
        : null,
      k.maxYears != null && k.maxYears > 0 ? line('keeper.maxYears', String(k.maxYears), t('rules.keeper.maxYears.means', { n: k.maxYears })) : null,
    ])
  }

  /* Dynasty */
  if (input.dynastyFamily) {
    const x = input.taxi
    add('dynasty', [
      line('dynasty.carryover', onOff(true), t('rules.dynasty.carryover.means')),
      x ? (x.slots > 0 ? line('dynasty.taxi', String(x.slots), t(x.nonRookies ? 'rules.dynasty.taxi.any.means' : 'rules.dynasty.taxi.rookies.means', { n: x.slots })) : line('dynasty.taxi', t('rules.value.none'), t('rules.dynasty.taxi.none.means'))) : null,
      x && x.slots > 0 && x.yearsLimit != null && x.yearsLimit > 0 ? line('dynasty.taxiYears', String(x.yearsLimit), t('rules.dynasty.taxiYears.means', { n: x.yearsLimit })) : null,
      x && x.slots > 0 && x.deadlineWeek != null && x.deadlineWeek > 0 ? line('dynasty.taxiDeadline', t('rules.value.week', { week: x.deadlineWeek }), t('rules.dynasty.taxiDeadline.means', { week: x.deadlineWeek })) : null,
      x && x.slots > 0
        ? line(
            'dynasty.taxiStealing',
            onOff(x.stealing.enabled),
            x.stealing.enabled
              ? t(x.stealing.claimsPerSeason > 0 ? 'rules.dynasty.taxiStealing.on.means' : 'rules.dynasty.taxiStealing.unlimited.means', { hours: x.stealing.protectHours, n: x.stealing.claimsPerSeason })
              : t('rules.dynasty.taxiStealing.off.means'),
          )
        : null,
    ])
  }

  /* Guillotine */
  const g = input.guillotine
  if (g) {
    const schedule: Array<RuleLine | null> = []
    for (const s of g.advanced.steps) {
      if (s.fromWeek > g.startWeek) schedule.push(line('guillotine.step', t('rules.value.fromWeek', { week: s.fromWeek }), t('rules.guillotine.step.means', { week: s.fromWeek, teams: teams(t, s.chops) })))
    }
    for (const [w, n] of Object.entries(g.advanced.overrides).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      schedule.push(
        line(
          'guillotine.override',
          t('rules.value.week', { week: Number(w) }),
          n === 0 ? t('rules.guillotine.override.none.means', { week: Number(w) }) : t('rules.guillotine.override.means', { week: Number(w), teams: teams(t, n) }),
        ),
      )
    }
    const release = known(GUILLOTINE_RELEASES, g.release)
    const breaks = g.tiebreakers.map((s) => known(GUILLOTINE_TIEBREAKS, s)).filter((s): s is (typeof GUILLOTINE_TIEBREAKS)[number] => s != null)
    add('guillotine', [
      line(
        'guillotine.chops',
        t('rules.guillotine.chops.value', { teams: teams(t, g.teamsPerChop) }),
        t(g.teamsPerChop === 1 ? 'rules.guillotine.chops.means' : 'rules.guillotine.chops.many.means', { n: g.teamsPerChop, week: g.startWeek }),
      ),
      g.endWeek != null ? line('guillotine.end', t('rules.value.week', { week: g.endWeek }), t('rules.guillotine.end.means', { week: g.endWeek })) : null,
      ...schedule,
      g.advanced.immunity === 'top_scorer' ? line('guillotine.immunity', onOff(true), t('rules.guillotine.immunity.means')) : null,
      breaks.length ? line('guillotine.tiebreakers', breaks.map((s, i) => `${i + 1}. ${t(`rules.guillotine.tiebreak.${s}`)}`).join('  '), t('rules.guillotine.tiebreakers.means')) : null,
      release ? line('guillotine.release', t(`rules.guillotine.release.${release}`), t(`rules.guillotine.release.${release}.means`)) : null,
    ])
  }

  return sections
}

const PLATFORM_NAMES: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  fantrax: 'Fantrax',
  cbs: 'CBS',
}

/** The platform's display name; `fallback` names a platform the league does not record. */
export function platformName(platform: string | null, fallback: string): string {
  const p = String(platform ?? '').trim().toLowerCase()
  return PLATFORM_NAMES[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : fallback)
}
