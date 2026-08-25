/**
 * Four things about a roster that change what a trade is worth, none of which
 * are about any player in it.
 *
 * These are the datapoints a value chart structurally cannot hold, because they
 * are properties of the ROSTER and the CALENDAR rather than of the assets.
 */

/** Slot names that are not a playing position. */
const NON_PLAYING = new Set(['BN', 'IR', 'TAXI', 'RES', 'BENCH'])

/* ── 1. Roster crunch ──────────────────────────────────────────────────────
 *
 * ⚠ IN A DEEP LEAGUE YOU CANNOT ABSORB PLAYERS. Taking three back for one is a
 * fine idea in a 12-team league with six bench spots and an impossible one in a
 * 32-team league where every seat is filled and the players you would cut are
 * the ones somebody claims off waivers an hour later. A 3-for-1 that forces two
 * drops is not a 3-for-1; it is a 1-for-1 plus two donations to the league.
 */

export type RosterCrunch = {
  rosterSize: number | null
  held: number
  /** Net change in bodies this deal causes. */
  netChange: number
  /** Players who would have to be dropped for the deal to be legal. */
  forcedDrops: number
  basis: string | null
}

export function assessRosterCrunch(args: {
  /** Total roster spots, from league settings. Null when not on file. */
  rosterSize: number | null
  /** Players currently held. */
  held: number
  incoming: number
  outgoing: number
}): RosterCrunch {
  const { rosterSize, held, incoming, outgoing } = args
  const netChange = incoming - outgoing
  const after = held + netChange
  const forcedDrops = rosterSize != null ? Math.max(0, after - rosterSize) : 0

  return {
    rosterSize,
    held,
    netChange,
    forcedDrops,
    basis:
      forcedDrops > 0
        ? `this deal leaves you ${after} players against ${rosterSize} spots — you would have to drop ${forcedDrops}, and in a league this deep those are gone the moment you do`
        : rosterSize != null && netChange > 0 && after >= rosterSize
          ? `this fills your last roster spot — you have no room to absorb anything else`
          : null,
  }
}

/* ── 2. Deadline proximity ─────────────────────────────────────────────────
 *
 * ⚠ WIN-NOW HELP IS WORTH WHAT IS LEFT TO USE IT ON. A starter acquired in week
 * 12 of a 14-week season buys three games; the same player in week 3 buys
 * eleven. The market price is the same in both cases and the value to the
 * roster plainly is not — this is the clearest case in the whole model where a
 * chart cannot know something a calendar does.
 *
 * And after the deadline the direction reverses entirely: nobody can buy, so
 * anything with a future is all that is tradeable.
 */

export type DeadlineWindow = {
  weeksOfUse: number | null
  /** Weeks until trades close. Null when the league has no deadline. */
  weeksToDeadline: number | null
  basis: string | null
}

export function assessDeadline(args: {
  currentWeek: number | null
  seasonWeeks: number | null
  /** The league's own trade deadline week, or null for no deadline. */
  deadlineWeek: number | null
  /** Positive when the deal moves value toward the future. */
  futureLean: number
}): DeadlineWindow {
  const { currentWeek, seasonWeeks, deadlineWeek, futureLean } = args
  if (currentWeek == null) return { weeksOfUse: null, weeksToDeadline: null, basis: null }

  const weeksOfUse = seasonWeeks != null ? Math.max(0, seasonWeeks - currentWeek + 1) : null
  const weeksToDeadline = deadlineWeek != null ? deadlineWeek - currentWeek : null

  let basis: string | null = null
  if (futureLean < 0 && weeksOfUse != null && weeksOfUse <= 4) {
    basis = `there are ${weeksOfUse} regular-season week${
      weeksOfUse === 1 ? '' : 's'
    } left to use this — present-value help is worth less the later you buy it`
  } else if (weeksToDeadline != null && weeksToDeadline <= 1 && weeksToDeadline >= 0) {
    basis =
      weeksToDeadline === 0
        ? 'the trade deadline is this week — this is the last deal either side can make'
        : 'the trade deadline is next week, so there is no time to correct this one'
  }

  return { weeksOfUse, weeksToDeadline, basis }
}

/* ── 3. Unpriced exposure ──────────────────────────────────────────────────
 *
 * ⚠ A VERDICT BUILT ON HALF THE ASSETS IS NOT A VERDICT. The market feed prices
 * offence and picks and nothing else. In an IDP league a deal can be mostly
 * defenders, every one of them valued at null, and the grade will still come
 * back looking like a grade. Saying which side the hole is on matters too: if
 * the unpriced players are all coming TO you, the deal looks worse than it is.
 */

export type UnpricedExposure = {
  giveUnpriced: number
  getUnpriced: number
  giveTotal: number
  getTotal: number
  basis: string | null
}

export function assessUnpriced(args: {
  give: Array<{ name: string; marketValue: number | null }>
  get: Array<{ name: string; marketValue: number | null }>
}): UnpricedExposure {
  const unpriced = (l: Array<{ marketValue: number | null }>) =>
    l.filter((x) => x.marketValue == null).length
  const giveUnpriced = unpriced(args.give)
  const getUnpriced = unpriced(args.get)
  const giveTotal = args.give.length
  const getTotal = args.get.length

  if (giveUnpriced === 0 && getUnpriced === 0) {
    return { giveUnpriced, getUnpriced, giveTotal, getTotal, basis: null }
  }

  const side =
    getUnpriced > giveUnpriced
      ? `${getUnpriced} of the ${getTotal} players coming to you`
      : giveUnpriced > getUnpriced
        ? `${giveUnpriced} of the ${giveTotal} players you are sending`
        : `${giveUnpriced + getUnpriced} players on both sides`

  return {
    giveUnpriced,
    getUnpriced,
    giveTotal,
    getTotal,
    basis: `${side} carry no market price at all — our value feed covers offence and picks only. Treat the verdict as covering the rest of the deal, not this part.`,
  }
}

/* ── 4. Concentration ──────────────────────────────────────────────────────
 *
 * ⚠ TWO ROSTERS WITH THE SAME TOTAL VALUE ARE NOT THE SAME ROSTER. One elite
 * player and eleven spares is a different asset than twelve good ones: it scores
 * the same on paper and it is one hamstring from nothing. Consolidating INTO a
 * star is often correct — it is how you win a title — but it is a risk position,
 * and a grade that reports only the totals has hidden the trade-off the manager
 * is actually making.
 *
 * Reported, never priced. There is no defensible number for how much fragility
 * costs, and inventing one would be the most confident guess in the model.
 */

export type Concentration = {
  /** Share of total value held by the single most valuable player, 0..1. */
  topShare: number | null
  topShareAfter: number | null
  basis: string | null
}

const CONSOLIDATION_FLAG = 0.05

export function assessConcentration(args: {
  /** Current roster values; nulls are skipped rather than counted as zero. */
  rosterValues: Array<number | null>
  incoming: Array<number | null>
  outgoing: Array<number | null>
}): Concentration {
  const before = args.rosterValues.filter((v): v is number => typeof v === 'number' && v > 0)
  if (before.length < 3) return { topShare: null, topShareAfter: null, basis: null }

  const out = new Set(args.outgoing.filter((v): v is number => typeof v === 'number'))
  const after = [
    ...before.filter((v) => !out.has(v)),
    ...args.incoming.filter((v): v is number => typeof v === 'number' && v > 0),
  ]
  if (after.length === 0) return { topShare: null, topShareAfter: null, basis: null }

  const share = (xs: number[]) => {
    const total = xs.reduce((a, b) => a + b, 0)
    return total > 0 ? Math.max(...xs) / total : null
  }
  const topShare = share(before)
  const topShareAfter = share(after)
  if (topShare == null || topShareAfter == null) {
    return { topShare, topShareAfter, basis: null }
  }

  const delta = topShareAfter - topShare
  if (Math.abs(delta) < CONSOLIDATION_FLAG) return { topShare, topShareAfter, basis: null }

  return {
    topShare,
    topShareAfter,
    basis:
      delta > 0
        ? `this concentrates your roster: your best player would carry ${Math.round(
            topShareAfter * 100,
          )}% of its value, up from ${Math.round(
            topShare * 100,
          )}%. That is how titles are won and it is one injury from nothing.`
        : `this spreads your roster out: your best player drops from ${Math.round(
            topShare * 100,
          )}% of its value to ${Math.round(
            topShareAfter * 100,
          )}%. Safer week to week, and a lower ceiling.`,
  }
}
