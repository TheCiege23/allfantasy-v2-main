import { AWARD_SPECS, TIER_LABEL, type AwardTier, type CareerAward } from './careerAwards'
import { isUnfiltered, type ActiveLeague, type CareerData } from './careerModel'
import type { LeagueCareerData } from './leagueCareer'

/**
 * Career's forward-looking half — what is still in play, and which milestones are close.
 *
 * ⚠ NOTHING HERE IS ADDED TO A TOTAL. Career totals, prestige and the legacy score are built
 * from FINISHED seasons only (`careerModel.ts`); a live league is "the open slot", never the
 * career. Stakes are therefore phrased as conditionals ("win X and it is ring #4") and
 * milestones name the finished-season number they are measured from. A screen that printed
 * "ring #4" as a fact while the season is running would be claiming a title nobody has won.
 *
 * ⚠ PURE AND SYNCHRONOUS. Everything comes from the career read the screen already made —
 * no second query, no provider call. That is what lets the same card render on the desktop
 * frame, the phone overview and inside one league without three loaders.
 */

export type StakeTone = 'title' | 'streak' | 'first'

/** One live league and what winning it would mean for the career. */
export type LegacyStake = {
  key: string
  leagueName: string
  platform: string
  /** Record so far, from the source; null before any games. */
  record: string | null
  title: string
  detail: string
  tone: StakeTone
  /** An unsent Chimmy question about this league's stakes. */
  ask: string
}

export type MilestoneKind = 'award' | 'wins' | 'titles' | 'level' | 'league-wins' | 'league-seasons'

/** A milestone that is close, measured from finished seasons (or games already played, in one league). */
export type Milestone = {
  key: string
  kind: MilestoneKind
  title: string
  /** The number it is measured from, in words — never a restated threshold alone. */
  detail: string
  /** How many units are left. Always ≥ 1. */
  remaining: number
  /** 0–100, how far along the current step. */
  progressPct: number
  ask: string
}

export type LegacyStakesData = {
  stakes: LegacyStake[]
  milestones: Milestone[]
  /** The season the stakes are for; null when nothing is live. */
  season: number | null
}

/** Round numbers worth marking. Past the end, every 250. */
const WIN_MARKS = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000]

/** A milestone is "within reach" inside this many units, or this share of the step. */
const NEAR_UNITS = 2
const NEAR_SHARE = 0.34
const MAX_STAKES = 4
const MAX_MILESTONES = 4

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd'] as const

export function ordinal(n: number): string {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (ORDINAL_SUFFIX.at(n % 10) ?? 'th')
  return `${n}${suffix}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/** The next round number strictly above `value`, and the one before it (the step's floor). */
export function nextMark(value: number, marks: readonly number[] = WIN_MARKS): { mark: number; floor: number } {
  let floor = 0
  for (const m of marks) {
    if (m > value) return { mark: m, floor }
    floor = m
  }
  const last = marks.at(-1) ?? 0
  const step = 250
  const mark = last + Math.floor((value - last) / step + 1) * step
  return { mark, floor: mark - step }
}

function isNear(remaining: number, stepSize: number): boolean {
  return remaining >= 1 && (remaining <= NEAR_UNITS || remaining / Math.max(stepSize, 1) <= NEAR_SHARE)
}

function pct(done: number, of: number): number {
  if (of <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((done / of) * 100)))
}

const sameLeague = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const TIERS: AwardTier[] = ['bronze', 'silver', 'gold', 'platinum']

/** The tier a metric reaches on one award's thresholds, or null below bronze. */
function tierAt(key: string, metric: number): AwardTier | null {
  const spec = AWARD_SPECS.find((s) => s.key === key)
  if (!spec) return null
  let tier: AwardTier | null = null
  spec.thresholds.forEach((t, i) => {
    if (metric >= t) tier = TIERS.at(i) ?? tier
  })
  return tier
}

/** The threshold an award's tier sits at, from the same spec the award was scored on. */
function tierThreshold(key: string, tier: AwardTier): number | null {
  const spec = AWARD_SPECS.find((s) => s.key === key)
  return spec?.thresholds.at(TIERS.indexOf(tier)) ?? null
}

/**
 * The live leagues the stakes are about: the newest season with anything live in it.
 *
 * ⚠ NOT EVERY ROW IN `activeLeagues`. That list also holds rows whose status could not be
 * classified, and an old season stuck in "unknown" is not a league anyone is playing. Only
 * the newest live season is "this season".
 */
function liveThisSeason(active: ActiveLeague[]): { season: number | null; leagues: ActiveLeague[] } {
  if (active.length === 0) return { season: null, leagues: [] }
  const season = Math.max(...active.map((a) => a.season))
  const seen = new Set<string>()
  const leagues = active.filter((a) => {
    if (a.season !== season) return false
    const k = `${a.platform}|${a.leagueName.toLowerCase()}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { season, leagues }
}

export function computeLegacyStakes(data: CareerData): LegacyStake[] {
  const { season, leagues } = liveThisSeason(data.activeLeagues)
  if (season == null) return []

  const ringNumber = data.championships + 1
  const ringBefore = tierAt('ring-collector', data.championships)
  const ringAfter = tierAt('ring-collector', ringNumber)
  const ringUnlock =
    ringAfter && ringAfter !== ringBefore
      ? ringBefore
        ? ` and takes Ring Collector to ${TIER_LABEL[ringAfter]}`
        : ' and earns Ring Collector'
      : ''

  return leagues.slice(0, MAX_STAKES).map((a) => {
    const titlesHere = data.titles.filter((t) => sameLeague(t.leagueName, a.leagueName))
    const defending = titlesHere.some((t) => t.season === season - 1)
    const record = a.record ? ` You are ${a.record} so far.` : ''

    let tone: StakeTone = 'title'
    let detail: string
    if (data.championships === 0) {
      tone = 'first'
      detail = `It would be your first career title${ringUnlock}.${record}`
    } else if (defending) {
      tone = 'streak'
      detail = `You won it in ${season - 1}. A repeat is ring #${ringNumber}${ringUnlock}.${record}`
    } else if (titlesHere.length > 0) {
      detail = `Ring #${ringNumber} of your career, your ${ordinal(titlesHere.length + 1)} in this league${ringUnlock}.${record}`
    } else {
      detail = `Ring #${ringNumber} of your career and your first in this league${ringUnlock}.${record}`
    }

    return {
      key: `${a.platform}|${a.season}|${a.leagueName.toLowerCase()}`,
      leagueName: a.leagueName,
      platform: a.platform,
      record: a.record,
      title: defending ? `Defend ${a.leagueName}` : `Win ${a.leagueName}`,
      detail,
      tone,
      ask: a.record
        ? `I'm ${a.record} in ${a.leagueName} this season. What do I need to do to win the title?`
        : `What would it take for me to win ${a.leagueName} this season?`,
    }
  })
}

export function computeMilestones(data: CareerData, awards: CareerAward[]): Milestone[] {
  const out: Milestone[] = []

  // Awards that already have a tier know exactly how far the next one is.
  for (const a of awards) {
    if (!a.next) continue
    // The step is current tier's threshold → next tier's, so "near" scales with the award.
    const floor = tierThreshold(a.key, a.tier) ?? 0
    const step = a.next.threshold - floor
    if (!isNear(a.next.remaining, step)) continue
    out.push({
      key: `award:${a.key}`,
      kind: 'award',
      title: `${a.name} ${TIER_LABEL[a.next.tier]}`,
      detail: `${a.evidence}. ${plural(a.next.remaining, a.unitOne, a.unit)} to go.`,
      remaining: a.next.remaining,
      progressPct: pct(a.metric - floor, step),
      ask: `How can I get ${a.name} to ${TIER_LABEL[a.next.tier]}? I need ${plural(a.next.remaining, a.unitOne, a.unit)} more.`,
    })
  }

  if (data.games > 0) {
    const { mark, floor } = nextMark(data.wins)
    const remaining = mark - data.wins
    if (isNear(remaining, mark - floor)) {
      out.push({
        key: `wins:${mark}`,
        kind: 'wins',
        title: `${mark.toLocaleString('en-US')} career wins`,
        detail: `${plural(data.wins, 'win')} in finished seasons. ${plural(remaining, 'more win')} gets there.`,
        remaining,
        progressPct: pct(data.wins - floor, mark - floor),
        ask: `I'm ${remaining} wins from ${mark} career wins. Which of my leagues gives me the best shot at getting there this season?`,
      })
    }
  }

  if (data.xp && data.xp.toNext != null && data.xp.toNext > 0 && data.nextLevelName && (data.xp.progressPct ?? 0) >= 75) {
    out.push({
      key: 'level:next',
      kind: 'level',
      title: `Reach ${data.nextLevelName}`,
      detail: `${data.xp.toNext.toLocaleString('en-US')} XP to the next level${data.level != null ? ` from level ${data.level}` : ''}.`,
      remaining: data.xp.toNext,
      progressPct: Math.round(data.xp.progressPct ?? 0),
      ask: `What's the fastest way for me to earn XP and reach ${data.nextLevelName} on AllFantasy?`,
    })
  }

  return out.sort((a, b) => b.progressPct - a.progressPct || a.remaining - b.remaining).slice(0, MAX_MILESTONES)
}

/**
 * ⚠ WHOLE CAREER ONLY. Under a filter `data.championships` and `data.wins` count the
 * filtered slice, so "ring #4 of your career" would be ring #4 of your ESPN career, printed
 * as if it were all of it. A filtered board gets no stakes card rather than a mislabelled one.
 */
export function buildLegacyStakes(data: CareerData, awards: CareerAward[]): LegacyStakesData {
  if (!isUnfiltered(data.filter)) return { stakes: [], milestones: [], season: null }
  return {
    stakes: computeLegacyStakes(data),
    milestones: computeMilestones(data, awards),
    season: liveThisSeason(data.activeLeagues).season,
  }
}

/** League marks are smaller: ten wins in one league is a real number. */
const LEAGUE_WIN_MARKS = [10, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200, 250]

/**
 * One league's milestones. These count games ALREADY PLAYED (`matchupFact` rows with a
 * result), so a running season contributes its finished weeks — nothing projected.
 */
export function computeLeagueMilestones(data: LeagueCareerData): Milestone[] {
  const out: Milestone[] = []
  const name = data.league.name
  const wins = data.totals.wins

  if (data.totals.games > 0) {
    const { mark, floor } = nextMark(wins, LEAGUE_WIN_MARKS)
    const remaining = mark - wins
    if (isNear(remaining, mark - floor)) {
      out.push({
        key: `league-wins:${mark}`,
        kind: 'league-wins',
        title: `${mark} wins in ${name}`,
        detail: `${plural(wins, 'win')} here since ${data.firstSeason}. ${plural(remaining, 'more win')} gets there.`,
        remaining,
        progressPct: pct(wins - floor, mark - floor),
        ask: `I'm ${remaining} wins from ${mark} all-time wins in ${name}. How do I get there this season?`,
      })
    }
  }

  const seasons = data.seasons.length
  const nextSeason = seasons + 1
  if (seasons >= 2 && [5, 10, 15, 20].includes(nextSeason)) {
    out.push({
      key: `league-seasons:${nextSeason}`,
      kind: 'league-seasons',
      title: `${ordinal(nextSeason)} season in ${name}`,
      detail: `${plural(seasons, 'season')} played here since ${data.firstSeason}.`,
      remaining: 1,
      progressPct: pct(seasons, nextSeason),
      ask: `Looking back over my ${seasons} seasons in ${name}, what have I done well and what should I change?`,
    })
  }

  return out
}
