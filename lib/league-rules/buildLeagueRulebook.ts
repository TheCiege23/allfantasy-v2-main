/**
 * The league's rules in plain words (2026-10-27): every setting the commissioner chose, with what it
 * means for a manager. Pure — it reads the same values the League Settings list shows
 * (lib/league-settings-home/buildLeagueSettingsHome.ts), so the two can never disagree, and the
 * explanations are fixed templates rather than generated text: a rule's wording has to be exactly
 * right, and a template can be tested.
 *
 * Shown on the "Rules explained" page (every member) and, as the few `key` entries, on the one-time
 * welcome sheet a manager sees on the league home.
 */

import {
  formatDraftDateTime,
  formatPickTimer,
  formatRosterSummary,
  formatScoringMode,
  formatTrades,
  formatWaivers,
  isGuillotineSettingsLeague,
  type SettingsHomeDraft,
  type SettingsHomeGuillotine,
  type SettingsHomeLeague,
} from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { getGuillotineSportConfig, WAIVER_BLIND_WINDOW_HOURS } from '@/lib/guillotine/sportConfig'
import { ENDGAME_OPTIONS, RELEASE_OPTIONS, TIEBREAK_OPTIONS } from '@/lib/guillotine/guillotineRules'
import { FAAB_ON_CHOP_OPTIONS, readFaabOnChop } from '@/lib/guillotine/faabOnChop'
import { readLineupLockSettings } from '@/lib/redraft/lineupLock'

export type RulebookEntry = {
  id: string
  label: string
  /** The choice, short — the same wording the settings list shows. */
  value: string
  /** What the choice means for a manager, in a sentence or two. */
  meaning: string
  /** One of the few rules that matter most; shown on the welcome sheet. */
  key?: boolean
  /** Value still loading from its GET. */
  pending?: boolean
}

export type RulebookSection = { id: string; title: string; entries: RulebookEntry[] }

export type BuildRulebookInput = {
  league: SettingsHomeLeague
  /** e.g. "Redraft", "Guillotine" — from lib/league-media/leagueTypeMedia. */
  formatLabel: string
  scoringLabel: string | null
  /** null = still loading. */
  rosterSlots: Record<string, number> | null
  draft: SettingsHomeDraft | null
  /** null = loading, or not a Guilly league. */
  guillotine: SettingsHomeGuillotine | null
  viewerTimeZone?: string
}

const LOADING = '…'

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function scoringMeaning(settings: unknown, guillotine: boolean): string {
  const mode = formatScoringMode(settings)
  if (guillotine) return "Your starters' points are added up for the week. There are no head-to-head matchups: you only need to outscore the lowest teams."
  if (mode === 'Categories') return 'Each stat category is a separate win or loss against your opponent every week.'
  if (mode === 'Roto') return 'Teams are ranked in every stat category across the whole season; the best combined rank wins.'
  return "Your starters' points are added up each week, and the higher total wins the matchup."
}

const BENCH = new Set(['BN', 'BENCH'])
const RESERVE = new Set(['IL', 'IR', 'IL+', 'NA'])

function rosterMeaning(slots: Record<string, number> | null): string {
  if (!slots) return LOADING
  let starters = 0
  let bench = 0
  let reserve = 0
  let taxi = 0
  for (const [rawKey, rawCount] of Object.entries(slots)) {
    const n = Number(rawCount)
    if (!Number.isFinite(n) || n <= 0) continue
    const key = rawKey.toUpperCase()
    if (BENCH.has(key)) bench += n
    else if (RESERVE.has(key)) reserve += n
    else if (key === 'TAXI') taxi += n
    else starters += n
  }
  const parts = [`You start ${plural(starters, 'player')}; only starters score.`]
  if (bench) parts.push(`${plural(bench, 'bench spot')} hold${bench === 1 ? 's' : ''} players who don't score that week.`)
  if (reserve) parts.push(`${plural(reserve, 'injured-reserve spot')} let${reserve === 1 ? 's' : ''} you stash an injured player without using a bench spot.`)
  if (taxi) parts.push(`${plural(taxi, 'taxi spot')} keep${taxi === 1 ? 's' : ''} young players off your active roster.`)
  return parts.join(' ')
}

function lineupLockEntry(league: SettingsHomeLeague): RulebookEntry {
  const { mode } = readLineupLockSettings(league.settings, league.sport ?? null)
  switch (mode) {
    case 'daily':
      return {
        id: 'lineup-lock',
        label: 'Lineups',
        value: 'Daily',
        meaning:
          "Set your lineup every day. Each player locks when their game starts and unlocks the next day. Your week's score is the sum of each day's starters.",
        key: true,
      }
    case 'first_game_of_week':
      return {
        id: 'lineup-lock',
        label: 'Lineups',
        value: 'Lock at the first game of the week',
        meaning: 'Your whole lineup locks when the first game of the week starts. Set it before then.',
        key: true,
      }
    case 'manual':
      return {
        id: 'lineup-lock',
        label: 'Lineups',
        value: 'Locked by the commissioner',
        meaning: 'The commissioner decides when lineups lock.',
        key: true,
      }
    default:
      return {
        id: 'lineup-lock',
        label: 'Lineups',
        value: 'Lock at each game',
        meaning: "Set a weekly lineup. Each player locks when their game starts; you can still move anyone whose game hasn't started.",
        key: true,
      }
  }
}

function draftTypeMeaning(type: string | null): string {
  switch (String(type ?? 'snake').toLowerCase()) {
    case 'auction':
      return 'Every team has the same budget and bids on players; the highest bid gets the player.'
    case 'linear':
      return 'Every round uses the same pick order.'
    case 'third_round_reversal':
      return 'The pick order reverses each round, and round 3 reverses again so the first pick is not stacked.'
    case 'offline':
      return 'The draft happens outside the app, and the commissioner enters the results.'
    default:
      return 'The pick order reverses each round, so the last pick of one round gets the first pick of the next.'
  }
}

function waiverMeaning(league: SettingsHomeLeague): string {
  const type = String(league.waiverType ?? 'rolling').toLowerCase()
  if (type === 'faab') {
    const budget = Number(league.waiverBudget ?? 100)
    return `Each team has $${budget.toLocaleString('en-US')} for the season to bid on free agents. The highest bid wins the player, and the amount comes off your budget.`
  }
  if (type === 'reverse_standings') return 'The team with the worst record gets first claim on a player.'
  if (type === 'rolling') return 'A successful claim sends you to the back of the waiver line.'
  return 'Claims are settled in waiver order.'
}

const TRADE_MEANINGS: Record<string, string> = {
  commissioner: 'The commissioner approves or vetoes every trade.',
  league_vote: 'The league votes on every trade before it goes through.',
  instant: 'Trades go through as soon as both teams accept.',
  none: 'Trading is turned off in this league.',
}

function tradeMeaning(league: SettingsHomeLeague): string {
  const s = settingsRecord(league.settings)
  const json = settingsRecord(s.settingsJson)
  const mode = String(s.trade_review_mode ?? s.tradeReviewMode ?? json.tradeReviewMode ?? 'commissioner').toLowerCase()
  const review = TRADE_MEANINGS[mode] ?? 'Trades are reviewed before they go through.'
  if (mode === 'none') return review
  return league.tradeDeadlineWeek ? `${review} No trades after the week ${league.tradeDeadlineWeek} deadline.` : `${review} There is no trade deadline.`
}

function guillotineSection(input: BuildRulebookInput): RulebookSection {
  const { league } = input
  const g = input.guillotine
  const profile = getGuillotineSportConfig(String(league.sport ?? 'NFL'))
  const pending = g == null
  const perWeek = g?.teamsPerChop ?? 1
  const endgame = ENDGAME_OPTIONS.find((o) => o.value === (league.guillotineEndgame ?? 'last_team_standing')) ?? ENDGAME_OPTIONS[0]
  const entries: RulebookEntry[] = [
    {
      id: 'how-guilly-works',
      label: 'How it works',
      value: `${plural(perWeek, 'team')} chopped a week`,
      meaning: `Every week the ${perWeek === 1 ? 'lowest-scoring team is' : `${perWeek} lowest-scoring teams are`} chopped: out of the league, with their players released to waivers for everyone else.`,
      key: true,
      pending,
    },
    {
      id: 'first-chop',
      label: 'First chop',
      value: g ? `Week ${g.firstChopWeek}` : LOADING,
      meaning: g ? `Chops start in week ${g.firstChopWeek}${g.endWeek ? ` and the last one is in week ${g.endWeek}` : ''}.` : LOADING,
      key: true,
      pending,
    },
  ]
  const extraLines = (g?.scheduleLines ?? []).slice(1)
  if (extraLines.length) {
    entries.push({ id: 'chop-schedule-changes', label: 'Chop schedule', value: 'Custom', meaning: extraLines.join(' '), pending })
  }
  if (profile) {
    entries.push({
      id: 'chop-timing',
      label: 'Chop & waivers',
      value: `Chop ${profile.chopLabel.replace(/^By /, 'by ')} · Waivers ${profile.waiverLabel}`,
      meaning: `The week's scores are final and the chop happens ${profile.chopLabel.replace(/^By /, 'by ')}. Waivers run ${profile.waiverLabel}, so you can bid on the chopped team's players right after.`,
      key: true,
    })
  }
  if (g?.blindAuction) {
    entries.push({
      id: 'blind-auction',
      label: 'Waiver bids',
      value: 'Blind auction',
      meaning: `Bids made in the ${WAIVER_BLIND_WINDOW_HOURS} hours before waivers run are sealed and settled together, highest bid first. Outside that window, claims go through in the order they are made.`,
      key: true,
    })
  }
  const release = RELEASE_OPTIONS.find((o) => o.value === g?.rosterReleaseTiming)
  if (release) entries.push({ id: 'release', label: "Chopped team's players", value: release.label, meaning: release.help })
  const faab = FAAB_ON_CHOP_OPTIONS.find((o) => o.value === readFaabOnChop(league.settings))
  if (faab && String(league.waiverType ?? '').toLowerCase() === 'faab') {
    entries.push({ id: 'faab-on-chop', label: "Chopped team's FAAB", value: faab.label, meaning: faab.help })
  }
  if (g?.tiebreakerOrder?.length) {
    const labels = g.tiebreakerOrder
      .map((step) => TIEBREAK_OPTIONS.find((o) => o.value === step)?.label)
      .filter((l): l is string => Boolean(l))
      .map((l) => l.charAt(0).toLowerCase() + l.slice(1))
    if (labels.length) {
      entries.push({
        id: 'tiebreakers',
        label: 'Ties at the bottom',
        value: TIEBREAK_OPTIONS.find((o) => o.value === g.tiebreakerOrder?.[0])?.label ?? 'Set',
        meaning: `If the lowest scores tie: ${labels[0]}${labels.length > 1 ? `; if still tied, ${listWords(labels.slice(1))}` : ''}.`,
      })
    }
  }
  if (g?.advanced?.immunity === 'top_scorer') {
    entries.push({ id: 'immunity', label: 'Immunity', value: 'Top scorer', meaning: "The week's top scorer cannot be chopped the next week." })
  }
  if (typeof g?.dangerMarginPoints === 'number' && g.dangerMarginPoints > 0) {
    entries.push({
      id: 'danger',
      label: 'Danger zone',
      value: `${g.dangerMarginPoints} points`,
      meaning: `Teams within ${g.dangerMarginPoints} points of the chop line show as in danger.`,
    })
  }
  entries.push({ id: 'endgame', label: 'How it ends', value: endgame.label, meaning: endgame.help, key: true })
  return { id: 'guillotine', title: 'Guilly', entries }
}

export function buildLeagueRulebook(input: BuildRulebookInput): RulebookSection[] {
  const { league } = input
  const guillotine = isGuillotineSettingsLeague(league)
  const scoringMode = formatScoringMode(league.settings)

  const sections: RulebookSection[] = [
    {
      id: 'format',
      title: 'Format & scoring',
      entries: [
        {
          id: 'format',
          label: 'Format',
          value: `${input.formatLabel} · ${scoringMode}`,
          meaning: scoringMeaning(league.settings, guillotine),
          key: !guillotine,
        },
        {
          id: 'scoring',
          label: 'Scoring',
          value: input.scoringLabel || scoringMode,
          meaning: input.scoringLabel
            ? `Each stat is worth the points in the ${input.scoringLabel} scoring settings.`
            : 'Each stat is worth the points the commissioner set for this league.',
        },
      ],
    },
    {
      id: 'roster',
      title: 'Roster & lineups',
      entries: [
        {
          id: 'roster',
          label: 'Roster',
          value: formatRosterSummary(input.rosterSlots),
          meaning: rosterMeaning(input.rosterSlots),
          pending: input.rosterSlots == null,
        },
        lineupLockEntry(league),
      ],
    },
  ]

  const d = input.draft
  sections.push({
    id: 'draft',
    title: 'Draft',
    entries: [
      {
        id: 'draft-date',
        label: 'When',
        value: d ? formatDraftDateTime(d.dateIso, input.viewerTimeZone) : LOADING,
        meaning: !d
          ? LOADING
          : !d.dateIso
            ? 'The commissioner has not scheduled the draft yet.'
            : d.autostart
              ? 'The draft starts by itself at this time.'
              : 'The commissioner starts the draft.',
        key: Boolean(d?.dateIso),
        pending: d == null,
      },
      {
        id: 'draft-type',
        label: 'Type',
        value: d ? `${d.type ? d.type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Snake'}${d.rounds ? ` · ${d.rounds} rounds` : ''}` : LOADING,
        meaning: d ? draftTypeMeaning(d.type) : LOADING,
        pending: d == null,
      },
      {
        id: 'pick-timer',
        label: 'Pick timer',
        value: d ? formatPickTimer(d.timerSeconds) : LOADING,
        meaning: !d
          ? LOADING
          : d.timerSeconds && d.timerSeconds > 0
            ? `You have ${formatPickTimer(d.timerSeconds)} to make each pick.`
            : 'There is no clock on picks.',
        pending: d == null,
      },
    ],
  })

  sections.push({
    id: 'waivers-trades',
    title: 'Waivers & trades',
    entries: [
      { id: 'waivers', label: 'Waivers', value: formatWaivers(league), meaning: waiverMeaning(league), key: true },
      { id: 'trades', label: 'Trades', value: formatTrades(league), meaning: tradeMeaning(league), key: !guillotine },
    ],
  })

  if (guillotine) {
    sections.push(guillotineSection(input))
  } else {
    const teams = league.playoffTeams ?? 6
    const start = resolvePlayoffStartWeek(league).week
    sections.push({
      id: 'playoffs',
      title: 'Playoffs',
      entries: [
        {
          id: 'playoffs',
          label: 'Playoffs',
          value: `${teams} teams · starts Wk ${start}`,
          meaning: `The top ${teams} teams make the playoffs, which start in week ${start}.`,
          key: true,
        },
      ],
    })
  }

  return sections
}

/**
 * The few rules the welcome sheet shows. A Guilly league's own rules come first — they are what a
 * manager who has never played one needs — then the rest in rulebook order.
 */
export function welcomeRules(sections: readonly RulebookSection[], max = 6): RulebookEntry[] {
  const ordered = [...sections.filter((s) => s.id === 'guillotine'), ...sections.filter((s) => s.id !== 'guillotine')]
  return ordered.flatMap((s) => s.entries).filter((e) => e.key).slice(0, max)
}
