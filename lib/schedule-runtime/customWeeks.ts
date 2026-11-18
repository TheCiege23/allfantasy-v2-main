/**
 * Custom weeks and schedule randomization — the pure half of the Commissioner Hub's schedule tools
 * (owner's page review #17, Phase C3). The database half is ./scheduleToolsService.ts.
 *
 * CUSTOM WEEKS. A commissioner sets a week's pairings by hand, and that week keeps them through every
 * later regeneration (randomize, rebuild). Before this, every hand edit — a swap, a Rivalry Week — was
 * deleted by the next regeneration, because the generator rewrites every week that has not started.
 *
 * Stored in `League.settings.schedule_custom_weeks`, keyed by season year, so it needs no migration:
 *
 *   { "2026": { "8": [["rosterA", "rosterB"], ["rosterC", null]] } }
 *
 * Each pair is `[home, away]`; `away: null` is the league bye an odd team count needs. A week counts only
 * while its pairs still cover exactly the season's rosters — a roster added or removed since makes the
 * week stale, and a stale week is ignored rather than half-applied.
 *
 * RANDOMIZATION. The generator (canonicalScheduleRuntime.ts) has no randomness: the schedule follows the
 * order of the teams it is given. Randomizing is shuffling that order. `shuffledOrders` draws N orders;
 * every draw is posted to the league chat and the last one becomes the schedule.
 *
 * Pure: no Prisma, no fetch.
 */

export const CUSTOM_WEEKS_SETTINGS_KEY = 'schedule_custom_weeks'
export const MAX_SCHEDULE_RANDOMIZATIONS = 25

export type CustomPair = { home: string; away: string | null }
export type CustomWeeks = Record<number, CustomPair[]>

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** This season's custom weeks, as stored. Malformed entries are dropped. */
export function readCustomWeeks(leagueSettings: unknown, seasonYear: number): CustomWeeks {
  const bySeason = obj(obj(leagueSettings)?.[CUSTOM_WEEKS_SETTINGS_KEY])
  const weeks = obj(bySeason?.[String(seasonYear)])
  const out: CustomWeeks = {}
  if (!weeks) return out
  for (const [k, raw] of Object.entries(weeks)) {
    const week = Number(k)
    if (!Number.isInteger(week) || week < 1 || !Array.isArray(raw)) continue
    const pairs: CustomPair[] = []
    for (const p of raw) {
      if (!Array.isArray(p) || typeof p[0] !== 'string') continue
      pairs.push({ home: p[0], away: typeof p[1] === 'string' ? p[1] : null })
    }
    if (pairs.length) out[week] = pairs
  }
  return out
}

/** `League.settings` with this season's week set (`pairs`) or cleared (`null`). Returns a new object. */
export function withCustomWeek(
  leagueSettings: unknown,
  seasonYear: number,
  week: number,
  pairs: CustomPair[] | null,
): Record<string, unknown> {
  const settings = { ...(obj(leagueSettings) ?? {}) }
  const bySeason = { ...(obj(settings[CUSTOM_WEEKS_SETTINGS_KEY]) ?? {}) }
  const weeks = { ...(obj(bySeason[String(seasonYear)]) ?? {}) }
  if (pairs) weeks[String(week)] = pairs.map((p) => [p.home, p.away])
  else delete weeks[String(week)]
  if (Object.keys(weeks).length) bySeason[String(seasonYear)] = weeks
  else delete bySeason[String(seasonYear)]
  settings[CUSTOM_WEEKS_SETTINGS_KEY] = bySeason
  return settings
}

export type PairsCheck = { ok: true } | { ok: false; code: string; message: string }

/**
 * A week's pairings are valid when every roster plays exactly once, nobody plays itself, and a bye is
 * used only when the team count is odd — and then exactly once.
 */
export function checkCustomPairs(pairs: readonly CustomPair[], rosterIds: readonly string[]): PairsCheck {
  const known = new Set(rosterIds)
  const seen = new Set<string>()
  let byes = 0
  for (const p of pairs) {
    for (const id of [p.home, p.away]) {
      if (id == null) continue
      if (!known.has(id)) return { ok: false, code: 'UNKNOWN_TEAM', message: 'A team in these matchups is not in this league.' }
      if (seen.has(id)) return { ok: false, code: 'TEAM_TWICE', message: 'A team is in two matchups. Each team plays once a week.' }
      seen.add(id)
    }
    if (p.away == null) byes += 1
    if (p.home === p.away) return { ok: false, code: 'SELF_MATCHUP', message: 'A team cannot play itself.' }
  }
  if (seen.size !== known.size) return { ok: false, code: 'TEAM_MISSING', message: 'Every team needs a matchup this week.' }
  const odd = known.size % 2 === 1
  if (byes > (odd ? 1 : 0)) {
    return { ok: false, code: 'TOO_MANY_BYES', message: odd ? 'Only one team can have the bye.' : 'With an even number of teams, every team needs an opponent.' }
  }
  return { ok: true }
}

type GeneratedMatchup = { week: number; homeRosterId: string; awayRosterId: string | null }

/**
 * The generated schedule with each still-valid custom week (at or after `fromWeek`, inside the regular
 * season) put in place of what the generator drew for it. A stale week is skipped and reported.
 */
export function applyCustomWeeks<M extends GeneratedMatchup>(
  matchups: readonly M[],
  custom: CustomWeeks,
  input: { fromWeek: number; regularSeasonWeeks: number; rosterIds: readonly string[] },
): { matchups: Array<M | GeneratedMatchup>; applied: number[]; stale: number[] } {
  const applied: number[] = []
  const stale: number[] = []
  const replace = new Map<number, CustomPair[]>()
  for (const [k, pairs] of Object.entries(custom)) {
    const week = Number(k)
    if (week < input.fromWeek || week > input.regularSeasonWeeks) continue
    if (checkCustomPairs(pairs, input.rosterIds).ok) {
      replace.set(week, pairs)
      applied.push(week)
    } else stale.push(week)
  }
  const out: Array<M | GeneratedMatchup> = matchups.filter((m) => !replace.has(m.week))
  for (const [week, pairs] of replace) {
    for (const p of pairs) out.push({ week, homeRosterId: p.home, awayRosterId: p.away })
  }
  out.sort((a, b) => a.week - b.week)
  return { matchups: out, applied: applied.sort((a, b) => a - b), stale: stale.sort((a, b) => a - b) }
}

/** `times` independent shuffles of `ids` (Fisher–Yates). `random` is injectable for tests. */
export function shuffledOrders(ids: readonly string[], times: number, random: () => number = Math.random): string[][] {
  const n = Math.max(1, Math.min(MAX_SCHEDULE_RANDOMIZATIONS, Math.floor(times)))
  const out: string[][] = []
  for (let t = 0; t < n; t++) {
    const order = [...ids]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    out.push(order)
  }
  return out
}

/** Items in the order of `order` (ids it does not name keep their place at the end). */
export function inOrder<T>(items: readonly T[], idOf: (item: T) => string, order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (rank.get(idOf(a)) ?? order.length) - (rank.get(idOf(b)) ?? order.length))
}

/**
 * The chat post for one draw: which draw it is, and the first week it changes. The last draw says it is
 * the schedule. Names are the teams' display names.
 */
export function randomizeChatMessage(input: {
  draw: number
  times: number
  week: number
  pairs: ReadonlyArray<{ home: string; away: string | null }>
  chosenBy?: string | null
}): string {
  const lines = input.pairs.map((p) => (p.away ? `${p.home} vs ${p.away}` : `${p.home}: bye`))
  const last = input.draw === input.times
  const head = last
    ? `🎲 Schedule randomization ${input.draw} of ${input.times}: this is the schedule.`
    : `🎲 Schedule randomization ${input.draw} of ${input.times}`
  const by = input.draw === 1 && input.chosenBy ? ` (${input.times} chosen by ${input.chosenBy})` : ''
  return `${head}${by}\nWeek ${input.week}:\n${lines.join('\n')}`
}
