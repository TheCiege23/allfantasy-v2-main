import type { CareerAward } from './careerAwards'
import { TIER_LABEL } from './careerAwards'
import { isUnfiltered, type CareerData } from './careerModel'
import type { LeagueCareerData, LeagueWeeklyCareerData } from './leagueCareer'

/**
 * Career ↔ Chimmy, both directions.
 *
 *   careerChimmyPrompts / leagueCareerChimmyPrompts
 *       questions the career screens offer, written from the user's own numbers. They go
 *       into the Chimmy composer UNSENT (`COMMS_OPEN_EVENT` prefill) — a screen that sent a
 *       question on the user's behalf would spend their request allowance on words they
 *       never typed.
 *
 *   renderCareerGroundingPrompt
 *       the career record Chimmy reads when it is opened from Career. It is rendered from
 *       the SAME `CareerData` the screen renders, so when a user asks "how many titles do I
 *       have?" from the trophy room, Chimmy's answer and the ring shelf cannot disagree.
 *       Before this, Chimmy's only history was the Sleeper-only import slice.
 *
 * Pure: no I/O, no clock. The caller owns the read.
 */

export type CareerChimmyPrompt = {
  key: string
  /** Chip text — short. */
  label: string
  /** The question placed in the composer. */
  ask: string
}

const MAX_PROMPTS = 4

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

export function careerChimmyPrompts(data: CareerData): CareerChimmyPrompt[] {
  if (data.accountIsEmpty) {
    return [
      {
        key: 'import',
        label: 'Backfill my history',
        ask: 'Which of my past leagues can I import from Sleeper, ESPN, Yahoo, Fantrax, MFL or Fleaflicker to build my career?',
      },
      {
        key: 'first-season',
        label: 'Plan my first season',
        ask: 'This is my first season on AllFantasy. What should I focus on to win my league?',
      },
    ]
  }

  const out: CareerChimmyPrompt[] = []
  const acc = data.accomplishments
  // Counts quoted in a question must match the whole-career record Chimmy is grounded on,
  // so the ones that quote a count are only offered on the unfiltered board.
  const whole = isUnfiltered(data.filter)

  if (data.activeLeagues.length > 0) {
    out.push({
      key: 'best-shot',
      label: 'Best title shot this year',
      ask: 'Which of my live leagues gives me the best shot at a title this season, and what should I do in it this week?',
    })
  }

  // Many playoff trips, few rings: the single most common career question.
  if (whole && acc.playoffAppearances >= 3 && data.championships < acc.playoffAppearances / 3) {
    out.push({
      key: 'convert',
      label: 'Turn playoffs into titles',
      ask: `I've made the playoffs ${acc.playoffAppearances} times but won ${data.championships} ${
        data.championships === 1 ? 'title' : 'titles'
      }. What should I change to convert more playoff runs into championships?`,
    })
  }

  const best = acc.bestSeasons.at(0)
  if (best) {
    out.push({
      key: 'best-season',
      label: `Repeat my ${best.season}`,
      ask: `What made my ${best.season} ${best.leagueName} season (${best.record}) work, and how do I repeat it?`,
    })
  }

  const platforms = data.coverage.platforms.filter((p) => p.leagueSeasons > 0)
  if (whole && platforms.length >= 2) {
    const [a, b] = platforms
    out.push({
      key: 'platforms',
      label: 'Where am I strongest?',
      ask: `Compare my results on ${a.platform} and ${b.platform}${
        platforms.length > 2 ? ' and my other platforms' : ''
      }. Where am I strongest, and why?`,
    })
  }

  out.push({
    key: 'weakness',
    label: 'My biggest weakness',
    ask: 'Looking at my whole fantasy career, what is my biggest weakness as a manager?',
  })

  return out.slice(0, MAX_PROMPTS)
}

export function leagueCareerChimmyPrompts(data: LeagueCareerData): CareerChimmyPrompt[] {
  const name = data.league.name
  const out: CareerChimmyPrompt[] = [
    {
      key: 'win-here',
      label: `How do I win ${name}?`,
      ask: `Based on my history in ${name}, what do I need to do differently to win it?`,
    },
  ]

  const rival = data.toughestRival
  if (rival) {
    out.push({
      key: 'rival',
      label: `Beat ${rival.name}`,
      ask: `${rival.name} has beaten me ${rival.losses} ${rival.losses === 1 ? 'time' : 'times'} in ${
        rival.meetings
      } meetings in ${name}. How do I beat them next time?`,
    })
  }

  if (data.tradeGrade.available) {
    out.push({
      key: 'trade-grade',
      label: `Why a ${data.tradeGrade.data.letter} trade grade?`,
      ask: `My career trade grade in ${name} is ${data.tradeGrade.data.letter} (${data.tradeGrade.data.sample}). What is dragging it down, and how do I trade better here?`,
    })
  }

  const best = data.seasons.reduce<(typeof data.seasons)[number] | null>(
    (acc, s) => (s.games > 0 && (acc == null || s.wins / s.games > acc.wins / acc.games) ? s : acc),
    null,
  )
  if (best && data.seasons.length >= 2) {
    out.push({
      key: 'best-season',
      label: `Repeat my ${best.season}`,
      ask: `My best season in ${name} was ${best.season} (${best.wins}-${best.losses}). What worked that year?`,
    })
  }

  return out.slice(0, MAX_PROMPTS)
}

/**
 * Prompts for a league with no head-to-head history (`leagueWeeklyCareer.ts`). Every number quoted
 * is one the screen shows — a finish against the field, never a win-loss record the league never had.
 */
export function leagueWeeklyCareerChimmyPrompts(data: LeagueWeeklyCareerData): CareerChimmyPrompt[] {
  const name = data.league.name
  const { weekly } = data
  const current = weekly.seasons[weekly.seasons.length - 1]
  const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`
  const out: CareerChimmyPrompt[] = []

  if (weekly.format === 'elimination' && current && current.choppedAfterWeek == null) {
    out.push({
      key: 'survive',
      label: 'How do I avoid the chop?',
      ask: `In ${name} (a guillotine league) I have survived ${weeks(current.weeks)} this season, finishing ${current.averageFinish.toFixed(1)} of ${current.fieldSize} on average. How do I stay out of the bottom spot this week?`,
    })
  } else {
    out.push({
      key: 'win-here',
      label: `How do I win ${name}?`,
      ask: `Based on my weekly scores in ${name}, what do I need to do differently to finish at the top?`,
    })
  }

  if (current) {
    out.push({
      key: 'finish',
      label: 'Why am I finishing here?',
      ask: `In ${name} my average weekly finish is ${current.averageFinish.toFixed(1)} of ${current.fieldSize} across ${weeks(current.weeks)}, with ${current.topScores} top ${current.topScores === 1 ? 'score' : 'scores'}. What is holding my weekly score back?`,
    })
  }

  if (data.tradeGrade.available) {
    out.push({
      key: 'trade-grade',
      label: `Why a ${data.tradeGrade.data.letter} trade grade?`,
      ask: `My career trade grade in ${name} is ${data.tradeGrade.data.letter} (${data.tradeGrade.data.sample}). What is dragging it down, and how do I trade better here?`,
    })
  }

  return out.slice(0, MAX_PROMPTS)
}

/**
 * The career record, as a prompt section. Every line is a field the career screen shows;
 * nothing is derived here that the screen does not also print.
 */
export function renderCareerGroundingPrompt(data: CareerData, awards: CareerAward[]): string {
  const lines: string[] = ['## CAREER RECORD (the Career screen\'s own figures)']

  if (data.accountIsEmpty) {
    lines.push(
      '- No finished seasons are on file for this user yet, on any platform.',
      data.activeLeagues.length > 0
        ? `- Live this season (not in any total): ${data.activeLeagues
            .slice(0, 8)
            .map((a) => `${a.leagueName} (${a.platform}${a.record ? `, ${a.record}` : ''})`)
            .join('; ')}.`
        : '- No live leagues are on file either.',
      'Rule: do not invent a career record. If asked, say what is on file and suggest importing past seasons.',
    )
    return lines.join('\n')
  }

  const acc = data.accomplishments
  if (data.handle) lines.push(`- Handle: ${data.handle}${data.level != null ? ` · level ${data.level}${data.levelName ? ` (${data.levelName})` : ''}` : ''}`)
  lines.push(
    `- Record: ${data.wins}-${data.losses}${data.ties ? `-${data.ties}` : ''}${
      data.winRate != null ? ` (${pct(data.winRate)} win rate)` : ''
    } across ${data.leaguesPlayed} finished league-seasons in ${data.distinctLeagues} leagues${
      data.firstSeason != null ? `, ${data.firstSeason}–${data.lastSeason}` : ''
    }.`,
  )
  if (data.coverage.platforms.length > 0) {
    lines.push(
      `- Platforms: ${data.coverage.platforms
        .map((p) => `${p.platform} (${p.leagueSeasons} league-seasons, ${p.firstSeason}–${p.lastSeason})`)
        .join('; ')}.`,
    )
  }
  if (data.sports.length > 0) lines.push(`- Sports: ${data.sports.join(', ')}.`)

  lines.push(
    `- Championships: ${data.championships}${
      data.titles.length > 0
        ? ` — ${data.titles
            .slice(0, 8)
            .map((t) => `${t.season} ${t.leagueName} (${t.platform}${t.record ? `, ${t.record}` : ''})`)
            .join('; ')}${data.titles.length > 8 ? `; and ${data.titles.length - 8} more` : ''}`
        : ''
    }.`,
  )
  lines.push(
    `- Playoffs: ${acc.playoffAppearances} berths${
      acc.playoffRate != null ? ` in ${acc.playoffKnown} league-seasons where it is known (${pct(acc.playoffRate)})` : ''
    }.`,
  )
  if (acc.finals != null) lines.push(`- Title games: ${acc.finals} played, ${acc.finalsLost} lost (from stored playoff brackets).`)
  if (acc.bestSeasons.length > 0) {
    lines.push(
      `- Best seasons: ${acc.bestSeasons
        .map((b) => `${b.season} ${b.leagueName} ${b.record}${b.champion ? ' (champion)' : b.madePlayoffs ? ' (playoffs)' : ''}`)
        .join('; ')}.`,
    )
  }
  if (data.prestige) lines.push(`- Prestige score: ${data.prestige.total.toFixed(1)} / 100.`)
  if (awards.length > 0) {
    lines.push(
      `- Awards: ${awards
        .slice(0, 8)
        .map((a) => `${a.name} ${TIER_LABEL[a.tier]} (${a.evidence}${a.next ? `; ${a.next.remaining} to ${TIER_LABEL[a.next.tier]}` : ''})`)
        .join('; ')}.`,
    )
  }
  if (data.activeLeagues.length > 0) {
    lines.push(
      `- Live this season, NOT in any total above: ${data.activeLeagues
        .slice(0, 8)
        .map((a) => `${a.leagueName} (${a.platform}${a.record ? `, ${a.record}` : ''})`)
        .join('; ')}.`,
    )
  }
  if (data.legacy && data.legacy.unavailable.length > 0) {
    lines.push(`- Not measured from imports: ${data.legacy.unavailable.join(', ')}.`)
  }
  lines.push(
    'Rule: quote these figures exactly when the user asks about their career. Seasons still in progress are not in the totals; say so rather than adding them. If something is not listed here, say it is not on file rather than estimating it.',
  )
  return lines.join('\n')
}
