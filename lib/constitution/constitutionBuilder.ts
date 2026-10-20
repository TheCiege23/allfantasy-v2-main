/**
 * Constitution builder (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 3) — pure rules, no prisma.
 *
 * The constitution is WRITTEN FROM THE LEAGUE'S OWN SETTINGS plus a handful of answers only a
 * commissioner can give (vote threshold, inactivity policy, house rules). A rule the settings
 * already decide is never asked — asking "how many playoff teams?" when the league stores 6 is how
 * a constitution starts disagreeing with the app that enforces it.
 *
 * Amendments: the commissioner proposes, the league votes in a league-chat poll, and a passed
 * amendment either takes effect now or is queued for next season. An amendment can carry ONE
 * setting change from `AMENDABLE` — a short list of league columns that are safe to change by
 * vote and that the settings patch already validates. Anything else is a text-only amendment.
 *
 * ⚠ THE CONSTITUTION TEXT IS A DOCUMENT, NOT THE SOURCE OF TRUTH. The settings are. A setting
 * change applied by amendment rewrites the matching section the next time the builder runs; a
 * hand-edited section is the commissioner's words and is kept as written.
 */

// ── Questions ───────────────────────────────────────────────────────────────

export type ConstitutionAnswers = {
  /** Share of votes cast that passes an amendment. */
  amendmentThreshold: 50 | 60 | 67 | 75
  /** How long an amendment vote stays open. */
  voteDays: 1 | 2 | 3 | 5 | 7
  /** Weeks without setting a lineup before a manager may be replaced. */
  inactivityWeeks: 1 | 2 | 3 | 4
  collusion: 'commissioner_reverses' | 'league_vote'
  /** Free text: house rules, punishments, trophies, anything the settings cannot hold. */
  houseRules: string
}

export const DEFAULT_ANSWERS: ConstitutionAnswers = {
  amendmentThreshold: 67,
  voteDays: 3,
  inactivityWeeks: 2,
  collusion: 'commissioner_reverses',
  houseRules: '',
}

export const HOUSE_RULES_MAX = 4000

function pick<T extends string | number>(allowed: readonly T[], v: unknown, fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

export function parseAnswers(v: unknown): ConstitutionAnswers {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  return {
    amendmentThreshold: pick([50, 60, 67, 75] as const, Number(r.amendmentThreshold), DEFAULT_ANSWERS.amendmentThreshold),
    voteDays: pick([1, 2, 3, 5, 7] as const, Number(r.voteDays), DEFAULT_ANSWERS.voteDays),
    inactivityWeeks: pick([1, 2, 3, 4] as const, Number(r.inactivityWeeks), DEFAULT_ANSWERS.inactivityWeeks),
    collusion: pick(['commissioner_reverses', 'league_vote'] as const, r.collusion, DEFAULT_ANSWERS.collusion),
    houseRules: typeof r.houseRules === 'string' ? r.houseRules.trim().slice(0, HOUSE_RULES_MAX) : '',
  }
}

// ── Facts read off the league ───────────────────────────────────────────────

export type LeagueFacts = {
  name: string
  sport: string
  season: number
  platform: string
  leagueType: string | null
  isDynasty: boolean
  leagueSize: number | null
  rosterSize: number | null
  scoring: string | null
  waiverType: string | null
  waiverBudget: number | null
  waiverMinBid: number | null
  tradeReviewHours: number | null
  tradeDeadlineWeek: number | null
  draftPickTrading: boolean
  playoffTeams: number | null
  playoffStartWeek: number | null
  medianGame: boolean
  irSlots: number | null
  taxiSlots: number | null
  keeperCount: number | null
  keeperMaxYears: number | null
  keeperRoundPenalty: number | null
  keeperMissedDeadlineRule: string | null
  /** `settings.trade_review_mode`: commissioner | league_vote | none, when the league stores one. */
  tradeReviewMode: string | null
  dues: { amount: number; currency: string } | null
}

export type ConstitutionSection = { id: string; title: string; body: string }

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function isKeeperLeague(f: LeagueFacts): boolean {
  return !f.isDynasty && (f.leagueType ?? '').toLowerCase().includes('keeper') && (n(f.keeperCount) ?? 0) > 0
}

function scoringLine(scoring: string | null): string {
  const s = (scoring ?? '').toLowerCase()
  if (s.includes('half')) return 'Half-PPR scoring (0.5 points per reception).'
  if (s.includes('ppr') && !s.includes('non')) return 'PPR scoring (1 point per reception).'
  if (s.includes('standard') || s.includes('non')) return 'Standard scoring (no points per reception).'
  return 'Scoring follows the league’s scoring settings in AllFantasy.'
}

function keeperCostLine(penalty: number | null): string {
  const p = n(penalty) ?? 0
  if (p === 0) return 'A kept player costs the same round he was drafted in last season.'
  if (p > 0) return `A kept player costs a pick ${plural(p, 'round')} earlier than last season’s.`
  return `A kept player costs a pick ${plural(-p, 'round')} later than last season’s.`
}

/** The constitution, section by section, from settings and answers. Deterministic. */
export function buildConstitution(f: LeagueFacts, a: ConstitutionAnswers): ConstitutionSection[] {
  const s: ConstitutionSection[] = []
  const teams = n(f.leagueSize)
  const format = f.isDynasty ? 'dynasty' : isKeeperLeague(f) ? 'keeper' : (f.leagueType ?? 'redraft')

  s.push({
    id: 'league',
    title: 'Article 1 — The league',
    body: [
      `${f.name} is a ${teams ? `${teams}-team ` : ''}${f.sport} ${format} league, run on AllFantasy${f.platform && f.platform.toLowerCase() !== 'native' && f.platform.toLowerCase() !== 'allfantasy' ? ` and played on ${f.platform}` : ''}.`,
      'This constitution is the league’s agreement. Where it and the league’s settings disagree, the settings decide and this document is corrected.',
    ].join('\n'),
  })

  const roster = [
    n(f.rosterSize) ? `Each team carries ${plural(n(f.rosterSize)!, 'roster spot')}.` : null,
    n(f.irSlots) ? `${plural(n(f.irSlots)!, 'injured reserve slot')}.` : null,
    n(f.taxiSlots) ? `${plural(n(f.taxiSlots)!, 'taxi squad slot')}.` : null,
    scoringLine(f.scoring),
    f.medianGame ? 'Each week every team also plays the league median: beating it counts as a win.' : null,
  ].filter(Boolean)
  s.push({ id: 'rosters', title: 'Article 2 — Rosters and scoring', body: roster.join('\n') })

  const waivers =
    (f.waiverType ?? '').toLowerCase() === 'faab'
      ? `Waivers use FAAB: each team has $${n(f.waiverBudget) ?? 100} for the season${n(f.waiverMinBid) ? `, minimum bid $${n(f.waiverMinBid)}` : ', and $0 bids are allowed'}. Highest bid wins.`
      : (f.waiverType ?? '').toLowerCase() === 'reverse_standings'
        ? 'Waiver priority follows reverse standings: the team with the worst record claims first.'
        : (f.waiverType ?? '').toLowerCase() === 'fcfs'
          ? 'Players are first come, first served: there is no waiver period.'
          : 'Waivers use a rolling priority order: a successful claim moves that team to the back of the line.'
  s.push({ id: 'waivers', title: 'Article 3 — Waivers and free agents', body: (f.waiverType ?? '').toLowerCase() === 'fcfs' ? waivers : `${waivers}\nUnclaimed players become free agents once waivers clear.` })

  const review =
    f.tradeReviewMode === 'league_vote'
      ? 'Accepted trades go to a league vote before they process.'
      : f.tradeReviewMode === 'none'
        ? 'Accepted trades process without review.'
        : `Accepted trades are reviewed by the commissioner${n(f.tradeReviewHours) ? ` within ${plural(n(f.tradeReviewHours)!, 'hour')}` : ''}. A trade is vetoed only for collusion or a clear attempt to damage the league — never because someone thinks it is lopsided.`
  s.push({
    id: 'trades',
    title: 'Article 4 — Trades',
    body: [
      review,
      n(f.tradeDeadlineWeek) ? `The trade deadline is the end of Week ${n(f.tradeDeadlineWeek)}.` : 'There is no trade deadline.',
      f.draftPickTrading ? 'Future draft picks may be traded.' : 'Draft picks may not be traded.',
    ].join('\n'),
  })

  const pt = n(f.playoffTeams)
  s.push({
    id: 'playoffs',
    title: 'Article 5 — Playoffs',
    body: [
      pt ? `${plural(pt, 'team')} make the playoffs${n(f.playoffStartWeek) ? `, starting in Week ${n(f.playoffStartWeek)}` : ''}.` : 'The playoff field follows the league’s playoff settings.',
      'Seeds and the bracket follow the league’s playoff settings in AllFantasy, including any byes.',
    ].join('\n'),
  })

  if (f.isDynasty || isKeeperLeague(f)) {
    s.push({
      id: 'keepers',
      title: f.isDynasty ? 'Article 6 — Dynasty' : 'Article 6 — Keepers',
      body: f.isDynasty
        ? 'Rosters carry over from season to season. Each offseason the league holds a rookie draft; its order follows the league’s rookie draft order settings.'
        : [
            `Each team may keep up to ${plural(n(f.keeperCount)!, 'player')}${n(f.keeperMaxYears) ? `, each for at most ${plural(n(f.keeperMaxYears)!, 'season')}` : ''}.`,
            keeperCostLine(f.keeperRoundPenalty),
            f.keeperMissedDeadlineRule === 'auto_no_keepers'
              ? 'A team that misses the keeper deadline keeps nobody.'
              : 'A team that misses the keeper deadline follows the league’s missed-deadline rule.',
          ].join('\n'),
    })
  }

  if (f.dues) {
    s.push({
      id: 'dues',
      title: 'Article 7 — Dues',
      body: `Dues are ${f.dues.currency === 'USD' ? '$' : ''}${f.dues.amount}${f.dues.currency === 'USD' ? '' : ` ${f.dues.currency}`} per team, paid before the season starts. AllFantasy tracks dues; it does not hold or pay out money.`,
    })
  }

  s.push({
    id: 'conduct',
    title: 'Article 8 — Conduct',
    body: [
      'Every manager sets a legal lineup every week, including after being eliminated. Tanking is not allowed.',
      `A manager who goes ${plural(a.inactivityWeeks, 'week')} without setting a lineup may be replaced by the commissioner.`,
      a.collusion === 'league_vote'
        ? 'Suspected collusion goes to a league vote; a majority reverses the moves involved.'
        : 'The commissioner may reverse any move made through collusion, and say why in league chat.',
      'Disputes go to the commissioner, who rules with a reason. The ruling is final for that season.',
    ].join('\n'),
  })

  s.push({
    id: 'amendments',
    title: 'Article 9 — Changing these rules',
    body: [
      `Any rule can be changed by amendment. The commissioner proposes it, the league votes in league chat for ${plural(a.voteDays, 'day')}, and it passes with ${a.amendmentThreshold}% of the votes cast.`,
      'A passed amendment takes effect next season unless the league votes for it to apply now. Rule changes do not apply to a season already under way unless every manager agrees.',
    ].join('\n'),
  })

  if (a.houseRules) s.push({ id: 'house', title: 'Article 10 — House rules', body: a.houseRules })
  return s
}

export function constitutionText(sections: ConstitutionSection[]): string {
  return sections.map((x) => `${x.title}\n${x.body}`).join('\n\n')
}

/** Validate a commissioner-edited section list. Titles and bodies trimmed; empty sections dropped. */
export const SECTION_TITLE_MAX = 120
export const SECTION_BODY_MAX = 6000
export const SECTIONS_MAX = 30
export function parseSections(v: unknown): ConstitutionSection[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > SECTIONS_MAX) return null
  const out: ConstitutionSection[] = []
  v.forEach((row, i) => {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {}
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, SECTION_TITLE_MAX) : ''
    const body = typeof r.body === 'string' ? r.body.trim().slice(0, SECTION_BODY_MAX) : ''
    if (!title && !body) return
    out.push({ id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : `s${i + 1}`, title: title || `Article ${i + 1}`, body })
  })
  return out.length > 0 ? out : null
}

// ── Amendments ──────────────────────────────────────────────────────────────

type Amendable = {
  label: string
  kind: 'int' | 'bool' | 'enum'
  min?: number
  max?: number
  options?: readonly string[]
}

/**
 * Settings an amendment may change. League columns the settings patch already accepts and
 * validates, chosen because a league vote on them is common and their effect is contained.
 * Structural ones (league size, roster size, scoring, league type) are left out on purpose: a vote
 * cannot settle what changing them does to rosters and history.
 */
export const AMENDABLE: Record<string, Amendable> = {
  tradeDeadlineWeek: { label: 'Trade deadline week', kind: 'int', min: 1, max: 18 },
  tradeReviewHours: { label: 'Trade review window (hours)', kind: 'int', min: 0, max: 168 },
  draftPickTrading: { label: 'Draft pick trading', kind: 'bool' },
  playoffTeams: { label: 'Playoff teams', kind: 'int', min: 2, max: 16 },
  playoffStartWeek: { label: 'Playoffs start week', kind: 'int', min: 10, max: 18 },
  medianGame: { label: 'Median game', kind: 'bool' },
  waiverBudget: { label: 'FAAB budget', kind: 'int', min: 0, max: 10000 },
  waiverMinBid: { label: 'FAAB minimum bid', kind: 'int', min: 0, max: 100 },
  irSlots: { label: 'IR slots', kind: 'int', min: 0, max: 10 },
  taxiSlots: { label: 'Taxi slots', kind: 'int', min: 0, max: 10 },
  keeperCount: { label: 'Keepers per team', kind: 'int', min: 0, max: 15 },
  keeperMaxYears: { label: 'Years a player can be kept', kind: 'int', min: 1, max: 10 },
}

export type SettingChange = { key: string; value: number | boolean | string }

export function parseSettingChange(v: unknown): SettingChange | null | 'invalid' {
  if (v == null) return null
  const r = typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  if (!r || typeof r.key !== 'string') return 'invalid'
  const spec = AMENDABLE[r.key]
  if (!spec) return 'invalid'
  if (spec.kind === 'bool') return typeof r.value === 'boolean' ? { key: r.key, value: r.value } : 'invalid'
  if (spec.kind === 'enum') return spec.options!.includes(String(r.value)) ? { key: r.key, value: String(r.value) } : 'invalid'
  const num = Number(r.value)
  if (!Number.isInteger(num) || num < (spec.min ?? -Infinity) || num > (spec.max ?? Infinity)) return 'invalid'
  return { key: r.key, value: num }
}

export function describeChange(c: SettingChange): string {
  const spec = AMENDABLE[c.key]
  const value = typeof c.value === 'boolean' ? (c.value ? 'on' : 'off') : String(c.value)
  return `${spec?.label ?? c.key} → ${value}`
}

export type AmendmentStatus = 'voting' | 'passed' | 'failed' | 'applied' | 'apply_failed' | 'withdrawn'

export type Amendment = {
  id: string
  title: string
  text: string
  change: SettingChange | null
  effective: 'now' | 'next_season'
  threshold: number
  pollMessageId: string | null
  closesAt: string
  status: AmendmentStatus
  yes: number | null
  no: number | null
  proposedBy: string
  proposedAt: string
  resolvedAt: string | null
  appliedAt: string | null
  applyError: string | null
}

export const AMENDMENT_TITLE_MAX = 120
export const AMENDMENT_TEXT_MAX = 2000
export const OPEN_AMENDMENTS_MAX = 5
export const STORED_AMENDMENTS_MAX = 100
export const YES = 'yes'
export const NO = 'no'

export function readAmendments(v: unknown): Amendment[] {
  if (!Array.isArray(v)) return []
  return v.filter((a): a is Amendment => !!a && typeof a === 'object' && typeof (a as Amendment).id === 'string' && typeof (a as Amendment).status === 'string')
}

/**
 * Passed by votes CAST, in whole fractions so the labels mean what people read them as: 50% is a
 * strict majority (a tie fails), 60% is three in five, 67% is two thirds (2 of 3 passes, which a
 * literal 67% would refuse), 75% is three in four. No votes at all fails.
 */
export function tally(yes: number, no: number, threshold: number): 'passed' | 'failed' {
  const cast = yes + no
  if (cast === 0) return 'failed'
  const pass =
    threshold === 50 ? yes > no : threshold === 60 ? yes * 5 >= cast * 3 : threshold === 67 ? yes * 3 >= cast * 2 : threshold === 75 ? yes * 4 >= cast * 3 : yes * 100 >= threshold * cast
  return pass ? 'passed' : 'failed'
}

/** Close a vote once its poll is closed. Returns the amendment unchanged while voting continues. */
export function resolveAmendment(a: Amendment, poll: { yes: number; no: number; closed: boolean }, now: Date): Amendment {
  if (a.status !== 'voting' || !poll.closed) return a
  return { ...a, status: tally(poll.yes, poll.no, a.threshold), yes: poll.yes, no: poll.no, resolvedAt: now.toISOString() }
}

/** Amendments ready to apply at a given moment: passed ones, filtered by when they take effect. */
export function readyToApply(amendments: Amendment[], moment: 'now' | 'season_rollover'): Amendment[] {
  return amendments.filter(
    (a) => a.status === 'passed' && a.change != null && (moment === 'season_rollover' || a.effective === 'now'),
  )
}

export function pruneAmendments(list: Amendment[]): Amendment[] {
  if (list.length <= STORED_AMENDMENTS_MAX) return list
  const live = list.filter((a) => a.status === 'voting' || a.status === 'passed')
  const done = list.filter((a) => !live.includes(a)).sort((x, y) => (y.resolvedAt ?? y.proposedAt).localeCompare(x.resolvedAt ?? x.proposedAt))
  return [...live, ...done.slice(0, Math.max(0, STORED_AMENDMENTS_MAX - live.length))]
}

/** League-chat poll text for an amendment vote. */
export function amendmentPollQuestion(a: Pick<Amendment, 'title' | 'change' | 'effective' | 'threshold'>): string {
  const what = a.change ? ` (${describeChange(a.change)})` : ''
  const when = a.effective === 'now' ? 'takes effect now' : 'takes effect next season'
  return `📜 Amendment: ${a.title}${what} — ${when}. Passes with ${a.threshold}% yes.`.slice(0, 280)
}
