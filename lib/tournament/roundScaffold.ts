/**
 * The rounds a tournament will play, laid out from its own calendar.
 *
 * 🛑 THE IMPORTER CREATED ONE ROUND AND STOPPED. Everything downstream assumes
 * more exist: `executeAdvancement` looks for the next play round and marks the
 * tournament COMPLETE when it finds none, `applyRoundRosterRules` reads the
 * round to know the roster cap, and the redraft plan has nothing to point at.
 * So a tournament imported from existing leagues would reach the end of its
 * regular season and declare itself finished.
 *
 * ⚠ THE BUBBLE IS A ROUND, AND IT IS NOT A PLAY ROUND. `resolveNextPlayRound`
 * filters `roundType !== 'bubble'` precisely so a bubble week is not mistaken
 * for the next stage of the bracket. It is scaffolded here as its own row
 * because it has a week, a status and an audience — but it sits beside the
 * progression rather than in it.
 *
 * Pure: no prisma, no `server-only`. A calendar this fiddly is worth asserting
 * directly, and the importer just writes what it returns.
 */

export type ScaffoldInput = {
  /** First and last week of the regular season. */
  openingWeekStart: number
  openingWeekEnd: number
  /** The week outside-the-cut teams get one more shot. Usually the last opening week. */
  bubbleWeek?: number | null
  /** The week spent redrafting — played through, not played in. */
  redraftWeek?: number | null
  /** First week of the elite stage, which is also when it drafts. */
  eliteRedraftWeek?: number | null
  /** The final. */
  championshipWeek?: number | null
  /** Where the season ends if nothing later is configured. */
  finalWeek?: number
}

export type ScaffoldedRound = {
  roundNumber: number
  roundType: 'opening' | 'bubble' | 'tournament' | 'elite' | 'final'
  roundLabel: string
  weekStart: number
  weekEnd: number
}

export type ScaffoldResult =
  | { ok: true; rounds: ScaffoldedRound[] }
  | { ok: false; error: string }

const DEFAULT_FINAL_WEEK = 17

/**
 * Lay out the rounds.
 *
 * ⚠ EVERY BOUNDARY IS DERIVED FROM THE NEXT STAGE, NOT GUESSED. The bracket
 * stage runs from the week after the redraft until whatever comes next starts —
 * so configuring an elite stage automatically shortens it rather than leaving
 * two rounds claiming the same weeks. Overlapping rounds are the kind of thing
 * nobody notices until two of them are both "current".
 */
export function buildRoundScaffold(input: ScaffoldInput): ScaffoldResult {
  const openingStart = Math.trunc(input.openingWeekStart)
  const openingEnd = Math.trunc(input.openingWeekEnd)

  if (!Number.isFinite(openingStart) || !Number.isFinite(openingEnd)) {
    return { ok: false, error: 'The regular season needs a first and last week.' }
  }
  if (openingStart < 1 || openingEnd < openingStart) {
    return { ok: false, error: 'The regular season must start at week 1 or later and end after it starts.' }
  }

  const bubbleWeek = input.bubbleWeek ?? null
  const redraftWeek = input.redraftWeek ?? null
  const eliteWeek = input.eliteRedraftWeek ?? null
  const championshipWeek = input.championshipWeek ?? null
  const finalWeek = input.finalWeek ?? DEFAULT_FINAL_WEEK

  /*
   * ⚠ CHECKED AS A SEQUENCE, NOT FIELD BY FIELD. Each of these can be
   * individually plausible and collectively impossible — an elite stage before
   * the redraft, a final before the semis — and the resulting rounds would look
   * fine in a list while the engine walked them in an order nobody intended.
   */
  const ordered = [
    ['the regular season end', openingEnd],
    ['the redraft week', redraftWeek],
    ['the elite redraft', eliteWeek],
    ['the championship', championshipWeek],
  ] as const
  let previousLabel = 'the regular season start'
  let previous = openingStart
  for (const [label, week] of ordered) {
    if (week == null) continue
    if (week < previous) {
      return { ok: false, error: `${label} (week ${week}) cannot come before ${previousLabel} (week ${previous}).` }
    }
    previousLabel = label
    previous = week
  }

  if (bubbleWeek != null && (bubbleWeek < openingStart || bubbleWeek > openingEnd)) {
    /* The bubble is a second chance inside the regular season, not after it. */
    return {
      ok: false,
      error: `The bubble week (${bubbleWeek}) has to fall inside the regular season (weeks ${openingStart}–${openingEnd}).`,
    }
  }

  const rounds: ScaffoldedRound[] = []
  let roundNumber = 1

  rounds.push({
    roundNumber: roundNumber++,
    roundType: 'opening',
    roundLabel: 'Regular season',
    weekStart: openingStart,
    weekEnd: openingEnd,
  })

  if (bubbleWeek != null) {
    rounds.push({
      roundNumber: roundNumber++,
      roundType: 'bubble',
      roundLabel: 'Bubble',
      weekStart: bubbleWeek,
      weekEnd: bubbleWeek,
    })
  }

  if (redraftWeek != null) {
    /* The bracket starts the week AFTER the redraft — the redraft week is spent
       drafting, not playing. */
    const start = redraftWeek + 1
    const end = (eliteWeek ?? championshipWeek ?? finalWeek + 1) - 1
    if (end >= start) {
      rounds.push({
        roundNumber: roundNumber++,
        roundType: 'tournament',
        roundLabel: 'Elimination bracket',
        weekStart: start,
        weekEnd: end,
      })
    }
  }

  if (eliteWeek != null) {
    const end = (championshipWeek ?? finalWeek + 1) - 1
    if (end >= eliteWeek) {
      rounds.push({
        roundNumber: roundNumber++,
        roundType: 'elite',
        roundLabel: 'Elite bracket',
        weekStart: eliteWeek,
        weekEnd: end,
      })
    }
  }

  if (championshipWeek != null) {
    rounds.push({
      roundNumber: roundNumber++,
      roundType: 'final',
      roundLabel: 'Championship',
      weekStart: championshipWeek,
      weekEnd: championshipWeek,
    })
  }

  return { ok: true, rounds }
}
