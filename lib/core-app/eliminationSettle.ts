import type { StarterGameState } from './matchupGameState'

/**
 * Is this elimination week already DECIDED for you, from whose games are finished? PURE.
 *
 * ── 🛑 WHY A MARGIN IS NOT ENOUGH ──────────────────────────────────────────────────────────
 * Asked live on 2026-09-28 (a Monday night, week 3), Chimmy said the user was "41.2 clear of the
 * cut line — you'd need a collapse from here to fall into last." Measured against Sleeper, all
 * five of the user's starters had FINISHED, and so had every starter of the team in last. The
 * user could not be chopped at all. A margin describes a race that is still running; this reads
 * whether it has stopped.
 *
 * ── THE RULE, AND WHY IT ONLY TRUSTS FINISHED TEAMS ───────────────────────────────────────
 * You are SAFE when every one of your starters is final AND at least `chops` other teams are
 * also fully final with a LOWER score. Those teams cannot pass you and you cannot fall.
 *
 * ⚠ A TEAM STILL PLAYING IS NOT "ABOVE YOU FOR GOOD". Fantasy points can go DOWN mid-game — an
 * interception, a fumble, a defence conceding — so a team that is currently ahead but not
 * finished proves nothing. Only finished teams are counted, in either direction.
 *
 * ⚠ AND UNKNOWN IS NOT FINAL. A starter whose game state could not be read, or a roster with no
 * starter rows on file, makes that team unfinished for this purpose. The verdict can only get
 * weaker from missing data, never stronger.
 *
 * `CHOPPED` is claimed only when EVERY team in the field is final — the one case where no later
 * score can move anybody. Stat corrections can still move a finished score for ~12h after a game,
 * which is why the wording says "barring a stat correction".
 */

export type SettleTeam = {
  rosterId: string
  points: number
  /** Game state of each of this team's starters. Empty means no starters on file. */
  starters: readonly StarterGameState[]
}

export type EliminationSettle =
  | { verdict: 'safe'; finishedBelow: number; chops: number }
  | { verdict: 'chopped'; chops: number }
  | { verdict: 'no_chop'; }
  | {
      verdict: 'open'
      /** Your starters still to kick off, and in progress. */
      yourUpcoming: number
      yourLive: number
      /** Your starters whose game state could not be read. */
      yourUnknown: number
      /** Finished teams below you so far, against the chops needed. */
      finishedBelow: number
      chops: number
      /** The team currently lowest (not you): its unfinished starters, or null when it is you. */
      cutLinePending: number | null
    }

export const teamFinished = (t: SettleTeam) => t.starters.length > 0 && t.starters.every((s) => s === 'final')

export function settleEliminationWeek(args: {
  /** Every roster carrying a score this week — the same field the cut line is drawn from. */
  field: readonly SettleTeam[]
  yourRosterId: string
  /** Teams eliminated at the end of this week. 1 for an ordinary guillotine. */
  chops: number
}): EliminationSettle | null {
  const you = args.field.find((t) => t.rosterId === args.yourRosterId)
  if (!you || args.field.length < 2) return null
  const chops = Math.max(0, Math.floor(args.chops))
  if (chops === 0) return { verdict: 'no_chop' }

  const others = args.field.filter((t) => t.rosterId !== you.rosterId)
  const finishedBelow = others.filter((t) => teamFinished(t) && t.points < you.points).length
  const youDone = teamFinished(you)

  if (youDone && finishedBelow >= chops) return { verdict: 'safe', finishedBelow, chops }

  if (youDone && others.every(teamFinished)) {
    const below = others.filter((t) => t.points < you.points).length
    if (below < chops) return { verdict: 'chopped', chops }
  }

  const lowestOther = [...others].sort((a, b) => a.points - b.points)[0]
  const youAreLowest = lowestOther != null && you.points <= lowestOther.points
  return {
    verdict: 'open',
    yourUpcoming: you.starters.filter((s) => s === 'upcoming').length,
    yourLive: you.starters.filter((s) => s === 'live').length,
    yourUnknown: you.starters.length === 0 ? 0 : you.starters.filter((s) => s === 'unknown').length,
    finishedBelow,
    chops,
    cutLinePending: youAreLowest || !lowestOther ? null : lowestOther.starters.filter((s) => s !== 'final').length,
  }
}

/** One sentence for the model, which it must repeat rather than soften or sharpen. */
export function settleSentence(s: EliminationSettle): string {
  switch (s.verdict) {
    case 'no_chop':
      return 'Nobody is eliminated this week under the league\'s published schedule.'
    case 'safe':
      return (
        'SAFE THIS WEEK — IT IS DECIDED: every one of their starters has finished, and ' +
        `${s.finishedBelow === 1 ? 'the team below them has' : `${s.finishedBelow} teams below them have`} finished too, ` +
        `so ${s.chops === 1 ? 'the chop cannot' : `the ${s.chops} chops cannot`} reach them. Say they are safe, not that they are "comfortably clear"; ` +
        'the only caveat is a stat correction.'
      )
    case 'chopped':
      return (
        'DECIDED AGAINST THEM: every team in the field has finished and they are ' +
        `${s.chops === 1 ? 'the lowest score' : `inside the lowest ${s.chops}`}. Barring a stat correction, they are eliminated this week.`
      )
    case 'open': {
      const mine: string[] = []
      if (s.yourUpcoming) mine.push(`${s.yourUpcoming} yet to kick off`)
      if (s.yourLive) mine.push(`${s.yourLive} in progress`)
      if (s.yourUnknown) mine.push(`${s.yourUnknown} with no game status on file`)
      const own = mine.length ? `Their starters: ${mine.join(', ')}.` : 'All their starters have finished.'
      const line =
        s.cutLinePending == null
          ? ''
          : s.cutLinePending === 0
            ? ' The team currently lowest has finished.'
            : ` The team currently lowest still has ${s.cutLinePending} starter${s.cutLinePending === 1 ? '' : 's'} to finish.`
      return `NOT YET DECIDED. ${own}${line} The margin can still move, in either direction.`
    }
  }
}

/**
 * What the week board's value column shows for a settle verdict. CLIENT-SAFE: this module has no
 * runtime imports, so the board and Your Week can call it without pulling a server module in.
 *
 * Null means "no verdict to show" — the caller keeps its own "+N clear" / "OUT on the block".
 */
export function settleBadge(
  settle: EliminationSettle | null | undefined,
): { label: string | null; sub: string; tone: 'up' | 'down' | null; aria: string } | null {
  if (!settle) return null
  switch (settle.verdict) {
    case 'safe':
      return { label: 'SAFE', sub: 'decided', tone: 'up', aria: 'Safe this week: your starters and enough teams below you have finished' }
    case 'chopped':
      return { label: 'OUT', sub: 'decided', tone: 'down', aria: 'Every team has finished and yours is eliminated this week' }
    case 'no_chop':
      return { label: null, sub: 'no chop this week', tone: null, aria: 'Nobody is eliminated this week' }
    case 'open': {
      const mine = settle.yourUpcoming + settle.yourLive
      if (mine > 0) return { label: null, sub: `${mine} to play`, tone: null, aria: `${mine} of your starters still to finish` }
      if (settle.cutLinePending) {
        return { label: null, sub: 'last team playing', tone: null, aria: `Your starters are done; the lowest team still has ${settle.cutLinePending} to finish` }
      }
      return null
    }
  }
}
