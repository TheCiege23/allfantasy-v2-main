/**
 * The top of /core/live in plain words (2026-11-13). The owner's ask: a reader should know what the
 * page is for and why they would open it. Everything here is read from what the page already holds —
 * the slate (`LivePageData`), your starters' stage counts (`LiveImpact`), and your matchups across
 * leagues (`LeaguesAtAGlance`) — plus one cached "next kickoff for this sport" read the server passes in.
 *
 * Pure functions only, so the client component stays a renderer and the rules are testable.
 */
import type { LiveImpact } from '@/lib/live/liveScoresPage'
import type { LeaguesAtAGlance } from '@/lib/live/leaguesAtAGlance'

/** How many plays the side feed shows before "Show all". A finished game's feed ran a whole screen. */
export const PLAYS_SHOWN = 5

export type LiveMoment =
  /** We could not read your rosters — the page says so rather than "nothing is on". */
  | { kind: 'roster-failed' }
  /** No claimed team anywhere: nothing of yours to follow yet. */
  | { kind: 'no-roster' }
  /** At least one of your starters is in a game being played now. */
  | { kind: 'live'; playing: number; done: number }
  /** Nothing of yours on the field; `nextAt` is when your next players (or this sport) kick off. */
  | { kind: 'between'; nextAt: string | null; done: number }

/**
 * The earliest kickoff still ahead: your own starters' next game from today's slate first, then the
 * sport's next stated kickoff (server-side, cached). Either may be absent; a past or unparseable
 * instant is ignored rather than shown as "next".
 */
export function nextKickoff(
  upNext: ReadonlyArray<{ startTime: string }>,
  sportNextAt: string | null,
  nowMs: number,
): string | null {
  const future = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    const t = Date.parse(iso)
    return Number.isFinite(t) && t > nowMs ? t : null
  }
  const mine = upNext.map((u) => future(u.startTime)).filter((t): t is number => t != null)
  if (mine.length > 0) return new Date(Math.min(...mine)).toISOString()
  const any = future(sportNextAt)
  return any != null ? new Date(any).toISOString() : null
}

export function liveMoment(input: {
  rosterFailed: boolean
  hasRosterData: boolean
  impact: Pick<LiveImpact, 'livePlayers' | 'finishedPlayers' | 'upNext'>
  sportNextAt: string | null
  nowMs: number
}): LiveMoment {
  if (input.rosterFailed) return { kind: 'roster-failed' }
  if (!input.hasRosterData) return { kind: 'no-roster' }
  if (input.impact.livePlayers > 0) return { kind: 'live', playing: input.impact.livePlayers, done: input.impact.finishedPlayers ?? 0 }
  return {
    kind: 'between',
    nextAt: nextKickoff(input.impact.upNext, input.sportNextAt, input.nowMs),
    done: input.impact.finishedPlayers ?? 0,
  }
}

export type LiveChip =
  | { key: 'playing'; value: number; href: string; tone: 'live' | 'plain' }
  | { key: 'behind'; value: number; href: string | null; tone: 'bad' | 'plain' }
  | { key: 'close'; value: number; href: string | null; tone: 'warn' | 'plain' }
  | { key: 'next'; at: string; href: string }
  | { key: 'done'; value: number; href: string }

/**
 * At most four chips, each a number said once on the page. Matchup counts come from the
 * cross-league glance and are absent when a league is held (its own matchup strip is the answer there).
 * The fourth chip is the next kickoff between games and "done today" during them.
 */
export function liveChips(moment: LiveMoment, glance: Pick<LeaguesAtAGlance, 'counts'> | null): LiveChip[] {
  const chips: LiveChip[] = []
  if (moment.kind === 'live' || moment.kind === 'between') {
    const playing = moment.kind === 'live' ? moment.playing : 0
    chips.push({ key: 'playing', value: playing, href: '#af-live-slate', tone: playing > 0 ? 'live' : 'plain' })
  }
  if (glance) {
    const { behind, close } = glance.counts
    chips.push({ key: 'behind', value: behind, href: behind > 0 ? '#af-live-glance' : null, tone: behind > 0 ? 'bad' : 'plain' })
    chips.push({ key: 'close', value: close, href: close > 0 ? '#af-live-glance' : null, tone: close > 0 ? 'warn' : 'plain' })
  }
  if (moment.kind === 'between' && moment.nextAt) chips.push({ key: 'next', at: moment.nextAt, href: '#af-live-next' })
  else if (moment.kind === 'live' || moment.kind === 'between') chips.push({ key: 'done', value: moment.done, href: '#af-live-slate' })
  return chips.slice(0, 4)
}

/**
 * Sports with a game today first, then the empty ones — every sport stays listed (a missing tab reads
 * as "we stopped covering it"; see the tablist note in LiveScores), but nine tabs with six zeros in
 * front of the one you need is the noise the owner asked to remove. Stable within each group.
 */
export function orderSportTabs<T extends { slateCount: number }>(counts: readonly T[]): T[] {
  return [...counts.filter((c) => c.slateCount > 0), ...counts.filter((c) => c.slateCount <= 0)]
}
