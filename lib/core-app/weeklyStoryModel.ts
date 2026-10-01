import type { WeekAllData } from './weekAll'

/**
 * Weekly Career Story — the pure half. Last week across every league, as a sequence of full-screen
 * cards: the week's record, each result, your top starter, upsets and awards, then what to do next.
 *
 * Every card is a reading of facts the home's "Your week" card already loads (`getRoutineFacts` in
 * `weeklyRoutine.ts`); nothing here is new data, and nothing here calls a model. The one line Chimmy
 * writes — the cover headline — is generated on open and checked against these facts by
 * `validateHeadline` before anyone sees it (see `weeklyStory.ts`).
 *
 * ⚠ ONLY SETTLED RESULTS. A row whose week is not final is left out of every card and counted as
 * `pending`, the same rule the home recap applies: "you lost" on a Monday-night game still being
 * played is a claim nobody can make yet.
 */

export type StoryResult = {
  leagueId: string
  leagueName: string
  platform: string | null
  pointsFor: number
  pointsAgainst: number
  won: boolean
  /** Absolute margin, one decimal. */
  margin: number
}

export type StoryAward = { leagueId: string; leagueName: string; label: string; value: number; unit: 'pts' | 'margin' }
export type StoryUpset = { leagueId: string; leagueName: string; winChance: string; pointsFor: number; pointsAgainst: number }
export type StoryTopScorer = { name: string; points: number; leagueName: string }

export type StoryCard =
  | { kind: 'cover'; key: string; season: number; week: number; wins: number; losses: number; ties: number; leagues: number; pending: number }
  | ({ kind: 'result'; key: string } & StoryResult)
  | { kind: 'more'; key: string; count: number; wins: number; losses: number }
  | ({ kind: 'top-scorer'; key: string } & StoryTopScorer)
  | ({ kind: 'upset'; key: string } & StoryUpset)
  | ({ kind: 'award'; key: string } & StoryAward)
  | { kind: 'next'; key: string; actions: Array<{ label: string; href: string }>; ask: string }

export type WeeklyStory = {
  /** "2026-W4" — what a viewer's "seen" mark is keyed on. */
  id: string
  season: number
  week: number
  cards: StoryCard[]
  /** Deterministic cover line; shown until (and unless) Chimmy's validated line arrives. */
  templateHeadline: string
}

/** Results beyond this fold into one "and N more" card — a story is not a table. */
export const MAX_RESULT_CARDS = 6

const round1 = (n: number) => Math.round(n * 10) / 10

const PLATFORM_DISPLAY: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
}
/** A native league is stored as `manual` (or blank); on a card it is AllFantasy, never "MANUAL". */
function platformDisplay(raw: string | null): string | null {
  const p = String(raw ?? '').toLowerCase()
  if (!p || p === 'manual' || p === 'native' || p === 'allfantasy') return 'AllFantasy'
  return PLATFORM_DISPLAY[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
}
const recordText = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`

export function buildWeeklyStory(input: {
  lastWeek: WeekAllData | null
  topScorer: StoryTopScorer | null
  awards: readonly StoryAward[]
  upsets: readonly StoryUpset[]
}): WeeklyStory | null {
  const week = input.lastWeek
  if (!week || week.season == null || week.week == null) return null

  const settled: StoryResult[] = week.rows
    .filter((r) => r.completed !== false)
    .map((r) => ({
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      platform: platformDisplay(r.platform),
      pointsFor: round1(r.pointsFor),
      pointsAgainst: round1(r.pointsAgainst),
      won: r.pointsFor > r.pointsAgainst,
      margin: round1(Math.abs(r.pointsFor - r.pointsAgainst)),
    }))
  if (settled.length === 0) return null

  const wins = settled.filter((r) => r.pointsFor > r.pointsAgainst)
  const losses = settled.filter((r) => r.pointsFor < r.pointsAgainst)
  const ties = settled.length - wins.length - losses.length
  const { season } = week
  const wk = week.week

  // Best news first: wins by margin, then the closest losses — the ones that sting.
  const ordered = [
    ...[...wins].sort((a, b) => b.margin - a.margin),
    ...settled.filter((r) => r.pointsFor === r.pointsAgainst),
    ...[...losses].sort((a, b) => a.margin - b.margin),
  ]
  const shown = ordered.slice(0, MAX_RESULT_CARDS)
  const rest = ordered.slice(MAX_RESULT_CARDS)

  const cards: StoryCard[] = [
    {
      kind: 'cover',
      key: 'cover',
      season,
      week: wk,
      wins: wins.length,
      losses: losses.length,
      ties,
      leagues: settled.length,
      pending: week.rows.length - settled.length,
    },
    ...shown.map((r): StoryCard => ({ kind: 'result', key: `result:${r.leagueId}`, ...r })),
  ]
  if (rest.length > 0) {
    cards.push({
      kind: 'more',
      key: 'more',
      count: rest.length,
      wins: rest.filter((r) => r.won).length,
      losses: rest.filter((r) => r.pointsFor < r.pointsAgainst).length,
    })
  }
  if (input.topScorer) cards.push({ kind: 'top-scorer', key: 'top-scorer', ...input.topScorer })
  for (const u of input.upsets) cards.push({ kind: 'upset', key: `upset:${u.leagueId}`, ...u })
  for (const a of input.awards) cards.push({ kind: 'award', key: `award:${a.leagueId}:${a.label}`, ...a })

  const closest = [...losses].sort((a, b) => a.margin - b.margin)[0]
  cards.push({
    kind: 'next',
    key: 'next',
    actions: [
      { label: 'Set this week’s lineups', href: '/core/my-team' },
      { label: 'Work the waiver wire', href: '/core/waivers' },
    ],
    ask: closest
      ? `Last week I went ${recordText(wins.length, losses.length, ties)} and lost ${closest.leagueName} by ${closest.margin}. What should I change this week?`
      : `Last week I went ${recordText(wins.length, losses.length, ties)} across my leagues. What should I focus on this week?`,
  })

  return {
    id: `${season}-W${wk}`,
    season,
    week: wk,
    cards,
    templateHeadline: templateHeadline({ wins, losses, ties }),
  }
}

/** The cover line with no model involved — also the fallback whenever Chimmy's line is refused. */
export function templateHeadline(input: { wins: readonly StoryResult[]; losses: readonly StoryResult[]; ties: number }): string {
  const w = input.wins.length
  const l = input.losses.length
  const record = recordText(w, l, input.ties)
  const best = [...input.wins].sort((a, b) => b.margin - a.margin)[0]
  const closest = [...input.losses].sort((a, b) => a.margin - b.margin)[0]
  if (w + l + input.ties === 1) {
    if (best) return `A win in ${best.leagueName}, by ${best.margin}.`
    if (closest) return `A loss in ${closest.leagueName}, by ${closest.margin}. Next week.`
    return 'A tie. Nobody blinked.'
  }
  if (l === 0 && w > 0) return `A perfect ${record} week. ${best!.leagueName} led the way, by ${best!.margin}.`
  if (w === 0 && l > 0) return `A ${record} week. ${closest!.leagueName} came closest, by ${closest!.margin}.`
  // A split week leads with the story, not the record — the cover already prints it in 100px type.
  if (w > l) return `${best!.leagueName} set the tone, by ${best!.margin}.`
  if (l > w) return `${closest!.leagueName} got away, by just ${closest!.margin}.`
  return `Dead even. ${best ? `${best.leagueName} was the high point.` : ''}`.trim()
}

/** The facts Chimmy may use, as the prompt states them and as the validator checks them. */
export function headlineFacts(story: WeeklyStory): { lines: string[]; numbers: Set<string> } {
  const lines: string[] = []
  const nums: number[] = []
  const cover = story.cards.find((c) => c.kind === 'cover')
  if (cover && cover.kind === 'cover') {
    lines.push(`Week ${cover.week} of ${cover.season}: ${recordText(cover.wins, cover.losses, cover.ties)} across ${cover.leagues} leagues.`)
    nums.push(cover.week, cover.season, cover.wins, cover.losses, cover.ties, cover.leagues)
  }
  for (const c of story.cards) {
    if (c.kind === 'result') {
      lines.push(`${c.won ? 'Won' : c.pointsFor === c.pointsAgainst ? 'Tied' : 'Lost'} in "${c.leagueName}", ${c.pointsFor} to ${c.pointsAgainst} (margin ${c.margin}).`)
      nums.push(c.pointsFor, c.pointsAgainst, c.margin)
    } else if (c.kind === 'top-scorer') {
      lines.push(`Top starter: ${c.name}, ${c.points} points in "${c.leagueName}".`)
      nums.push(c.points)
    } else if (c.kind === 'upset') {
      lines.push(`Upset win in "${c.leagueName}" at a ${c.winChance} pre-game win chance.`)
      nums.push(Number.parseFloat(c.winChance))
    } else if (c.kind === 'award') {
      lines.push(`Award in "${c.leagueName}": ${c.label} (${c.value} ${c.unit === 'pts' ? 'points' : 'margin'}).`)
      nums.push(c.value)
    }
  }
  return { lines, numbers: new Set(nums.filter(Number.isFinite).map((n) => String(round1(n)))) }
}

export function headlinePrompt(story: WeeklyStory): string {
  const { lines } = headlineFacts(story)
  return [
    'You are Chimmy, the AllFantasy assistant. Write ONE headline for this manager\'s weekly recap story.',
    'Rules: at most 110 characters; second person ("you"); playful but kind about losses; no hashtags, no emoji, no quotation marks;',
    'use ONLY the facts below — every number you write must appear in them exactly; never invent a score, a name or a ranking.',
    '',
    'FACTS',
    ...lines.map((l) => `- ${l}`),
    '',
    'Reply with the headline text only.',
  ].join('\n')
}

/**
 * Chimmy's line, or null if it may not be shown. A headline that quotes ANY number the facts do not
 * contain is refused outright — the cheapest possible check against an invented score, and the one
 * failure a recap cannot survive.
 */
export function validateHeadline(raw: string | null | undefined, story: WeeklyStory): string | null {
  if (!raw) return null
  const text = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\s+/g, ' ').trim()
  if (text.length < 8 || text.length > 140) return null
  if (/\n|https?:|#/.test(raw)) return null
  const { numbers } = headlineFacts(story)
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!numbers.has(String(round1(Number(m[0]))))) return null
  }
  return text
}
