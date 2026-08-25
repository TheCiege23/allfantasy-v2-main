/**
 * Survivor All-Stars Guillotine: the one format where DEPTH APPRECIATES.
 *
 * 22 teams in two tribes of 11. One team is eliminated a week — two a week
 * during the Gauntlet — and their roster hits waivers. Elimination is never by
 * vote: you go out by being the lowest scorer on your tribe or in the league.
 * $1000 FAAB for the whole season and **no trades at all**.
 *
 * ⚠ THE STARTING LINEUP GROWS ON A PUBLISHED SCHEDULE, and nothing else in this
 * repo models that. It opens at QB/2RB/2WR/TE/2WRT — eight starters — and gains
 * a WRT flex in week 7, a SUPERFLEX in week 9, another WRT in week 11 and one
 * more in week 14, finishing at twelve. Every other format in this codebase
 * prices depth as a decaying asset because rosters shrink or expire. Here a
 * bench body you cannot start in week 1 is a starter by week 14, and the
 * question "is he worth a bid" has a different answer depending on whether the
 * slot that uses him exists yet.
 *
 * ⚠ THE SUPERFLEX ARRIVES IN WEEK 9 AND REPRICES EVERY QUARTERBACK ON A KNOWN
 * DATE. A second QB is an unstartable bench body for eight weeks and a weekly
 * starter from the ninth. That is the sharpest dated inflection in any format
 * here, and it is public — everybody can see it coming, which means the bidding
 * for quarterbacks moves before the slot does.
 *
 * ⚠ AND THERE ARE NO TRADES. This module exists for the FAAB decisions, which
 * are the only acquisitions available, and for the variant that ever enables
 * trading.
 */

/** Starting lineup size by week, from the published schedule. */
export const LINEUP_SCHEDULE: Array<{ fromWeek: number; starters: number; added: string }> = [
  { fromWeek: 1, starters: 8, added: 'QB, 2RB, 2WR, TE, 2WRT flex' },
  { fromWeek: 7, starters: 9, added: 'WRT flex' },
  { fromWeek: 9, starters: 10, added: 'SUPERFLEX' },
  { fromWeek: 11, starters: 11, added: 'WRT flex' },
  { fromWeek: 14, starters: 12, added: 'WRT flex' },
]

/** The week a second quarterback stops being a bench body. */
export const SUPERFLEX_WEEK = 9

/** Standard idols cannot be played after this week. */
export const STANDARD_IDOL_LAST_WEEK = 10

/** Gauntlet idols cannot be played after this week. */
export const GAUNTLET_IDOL_LAST_WEEK = 13

export type LineupState = {
  starters: number
  /** The next expansion, if one is still ahead. */
  nextAt: number | null
  nextAdds: string | null
  basis: string
}

export function lineupAt(week: number): LineupState | null {
  if (!Number.isFinite(week) || week < 1) return null

  const current = [...LINEUP_SCHEDULE].reverse().find((s) => week >= s.fromWeek)
  if (!current) return null
  const next = LINEUP_SCHEDULE.find((s) => s.fromWeek > week) ?? null

  return {
    starters: current.starters,
    nextAt: next?.fromWeek ?? null,
    nextAdds: next?.added ?? null,
    basis: next
      ? `You start ${current.starters} this week, and a ${next.added} arrives in week ${next.fromWeek}. Depth you buy now is a starter later — this is the one format where the lineup grows into your bench instead of shrinking away from it.`
      : `You start ${current.starters} — the lineup is at its full size and will not grow again.`,
  }
}

/**
 * What a player is worth when the slot that uses him has not arrived yet.
 *
 * ⚠ NOT A DISCOUNT, A DELAY. He is not worth less because he is a bench body; he
 * is worth nothing THIS week and full value from the week his slot opens. A flat
 * "bench players are worth less" rule would misprice both ends — too high now,
 * too low later — and the difference is a known number of weeks, not a guess.
 */
export function deferredSlotValue(args: {
  currentWeek: number
  /** The week the slot that would start him appears. */
  slotArrivesWeek: number
  /** Last week of the format, for the denominator. */
  finalWeek?: number
}): { weeksOnBench: number; weeksStarting: number; basis: string } | null {
  const { currentWeek, slotArrivesWeek } = args
  const finalWeek = args.finalWeek ?? 17
  if (currentWeek < 1 || slotArrivesWeek < currentWeek || currentWeek > finalWeek) return null

  const weeksOnBench = slotArrivesWeek - currentWeek
  const weeksStarting = Math.max(0, finalWeek - slotArrivesWeek + 1)

  if (weeksOnBench === 0) {
    return {
      weeksOnBench: 0,
      weeksStarting,
      basis: `His slot exists now — he starts for up to ${weeksStarting} more weeks.`,
    }
  }

  return {
    weeksOnBench,
    weeksStarting,
    basis: `He sits for ${weeksOnBench} week${
      weeksOnBench === 1 ? '' : 's'
    } and then starts for up to ${weeksStarting}. That is a delay, not a discount — and you have to survive those ${weeksOnBench} weeks to collect, which is the part that makes it a gamble rather than a bargain.`,
  }
}

/**
 * The quarterback repricing, said before it happens.
 *
 * ⚠ EVERYBODY CAN SEE IT COMING, WHICH IS THE POINT. The schedule is published,
 * so the market for quarterbacks moves before the slot does. A manager who waits
 * until week 9 to want a second QB is bidding against every other manager who
 * also just noticed.
 */
export function superflexInflectionNote(args: { currentWeek: number }): string | null {
  const { currentWeek } = args
  if (currentWeek >= SUPERFLEX_WEEK) return null

  const away = SUPERFLEX_WEEK - currentWeek
  return `The SUPERFLEX arrives in week ${SUPERFLEX_WEEK}, ${away} week${
    away === 1 ? '' : 's'
  } away. A second quarterback is an unstartable bench body until then and a weekly starter after — and the whole league can read the same schedule, so the bidding moves before the slot does.`
}

export type EliminationStyle = 'match_play' | 'tribe_champion' | 'gauntlet_double' | 'standard'

/**
 * What actually keeps you alive this week, which is not the same every week.
 *
 * ⚠ THREE DIFFERENT SURVIVAL CONDITIONS AND ONLY ONE OF THEM IS ABOUT YOUR OWN
 * SCORE. Under Match Play your tribe's win COUNT decides safety and your score
 * only matters if your tribe loses and you are its lowest. Under Tribe Champion
 * one nominated manager's score decides all eleven. Only in the Gauntlet and the
 * standard weeks does your own floor directly save you.
 *
 * A model that treated every week as "don't be last" would be right about a
 * third of the time.
 */
export function survivalConditionNote(args: { style: EliminationStyle }): string {
  switch (args.style) {
    case 'match_play':
      return 'Match Play: every team faces one from the other tribe and the tribe winning MORE matchups is entirely safe. Your own score only decides anything if your tribe loses the count and you are its lowest scorer — so a big week on a losing tribe can still send you home, and a poor week on a winning tribe cannot.'
    case 'tribe_champion':
      return 'Tribe Champion: one nominated manager from each tribe faces off, and the winning tribe is entirely safe. Eleven teams live or die on one person’s score, and the champion is NOT immune if they also finish lowest. Nobody can be champion twice until everyone has gone.'
    case 'gauntlet_double':
      return 'Gauntlet double elimination: the lowest scorer on EACH tribe goes, so two teams leave every week and your own floor is the only thing protecting you. This is where a boom-bust roster ends seasons.'
    default:
      return 'Standard guillotine: the lowest scorer in the league is eliminated. Your own floor is the only thing that matters now.'
  }
}

/**
 * Idols expire on fixed weeks, and holding one past its date is a total loss.
 *
 * ⚠ AN UNPLAYED IDOL IS ALSO LOST IF YOU ARE ELIMINATED HOLDING IT. So the
 * "save it for when I really need it" instinct fails twice over: the week you
 * really need it may be the week it has already expired, or the week you go out
 * with it in your pocket.
 */
export function idolExpiryNote(args: {
  currentWeek: number
  kind: 'standard' | 'gauntlet'
}): string | null {
  const last = args.kind === 'standard' ? STANDARD_IDOL_LAST_WEEK : GAUNTLET_IDOL_LAST_WEEK
  if (args.currentWeek > last) {
    return `Your ${args.kind} idol expired in week ${last} and is worth nothing now.`
  }
  const left = last - args.currentWeek + 1
  return `Your ${args.kind} idol can be played for ${left} more week${
    left === 1 ? '' : 's'
  } — the last is week ${last}. It is also lost if you are eliminated while still holding it, so "saving it" fails in two different ways.`
}
