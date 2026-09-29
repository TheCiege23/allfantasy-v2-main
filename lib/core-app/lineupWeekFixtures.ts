/**
 * Does this club still have a game to play in THIS lineup's week?
 *
 * 🛑 WHY THIS EXISTS. The home's "starter who cannot play" alert paired a lineup with the club's
 * NEXT kickoff, whatever week it fell in. On a Monday the Sleeper lineup is still week 3, but a
 * club that played on Sunday has its next game in week 4 — so the queue raised a red, urgent
 * "Listed Out in your starting lineup · kicks off Sun 1:00p ET · IN 6D" for a slot that had
 * already locked and scored, and whose next-week version does not exist yet. Measured on
 * production 2026-09-28 for three leagues at once. It is the false-alert complaint the Core audit
 * started from, reached through the calendar instead of the league format.
 *
 * Pure and client-safe: the caller supplies the fixtures it already read.
 */

export type WeekFixture = {
  startTime: Date | null
  homeTeam: string | null
  awayTeam: string | null
  week: number | null
}

export type WeekFixtureIndex = {
  /**
   * True when at least one upcoming fixture carries a week number. Production stores each game
   * from two sources, one with `week` and one without; if NONE carry it, we cannot tell a finished
   * week from a data gap and every verdict is `unknown`.
   */
  labelled: boolean
  /** week → club key (lower-cased full name) → that club's earliest remaining kickoff in the week. */
  byWeek: Map<number, Map<string, Date>>
}

export function clubKey(name: string | null | undefined): string | null {
  const key = name?.trim().toLowerCase()
  return key ? key : null
}

/** Index UPCOMING fixtures (the caller filters to startTime >= now) by week and club. */
export function indexFixturesByWeek(fixtures: WeekFixture[]): WeekFixtureIndex {
  const byWeek = new Map<number, Map<string, Date>>()
  let labelled = false
  for (const g of fixtures) {
    if (!g.startTime || g.week == null) continue
    labelled = true
    let clubs = byWeek.get(g.week)
    if (!clubs) byWeek.set(g.week, (clubs = new Map()))
    for (const club of [g.homeTeam, g.awayTeam]) {
      const key = clubKey(club)
      if (!key) continue
      const prior = clubs.get(key)
      if (!prior || g.startTime < prior) clubs.set(key, g.startTime)
    }
  }
  return { labelled, byWeek }
}

export type WeekVerdict =
  /** The club plays again in this week; `kickoff` is that game. */
  | { verdict: 'plays'; kickoff: Date }
  /** The club has no game left in this week — already played, or on bye. The slot is settled. */
  | { verdict: 'done' }
  /** We cannot tell (no week on the lineup, no club, or no week-labelled fixtures at all). */
  | { verdict: 'unknown' }

export function weekVerdict(index: WeekFixtureIndex, club: string | null, week: number | null | undefined): WeekVerdict {
  if (week == null || !club || !index.labelled) return { verdict: 'unknown' }
  const clubs = index.byWeek.get(week)
  if (clubs) {
    const kickoff = clubs.get(club)
    return kickoff ? { verdict: 'plays', kickoff } : { verdict: 'done' }
  }
  /*
   * ⚠ NO UPCOMING GAME CARRIES THIS WEEK NUMBER AT ALL. That is "the week is over" only when the
   * schedule has moved PAST it (Tuesday, with Sleeper still on the old week) — and it is also what
   * a numbering mismatch looks like: a provider that restarts postseason weeks at 1 while Sleeper
   * says 19 would put every club at `done` and silently erase every alert in the playoffs.
   * So: finished only when a LATER labelled week exists and no earlier one does.
   */
  const weeks = [...index.byWeek.keys()]
  const later = weeks.filter((w) => w > week)
  if (later.length === 0 || weeks.some((w) => w < week)) return { verdict: 'unknown' }
  /*
   * 🛑 A FINISHED WEEK DOES NOT SETTLE THE SLOT — THE LINEUP CARRIES INTO THE NEXT ONE. This
   * returned `done` here until 2026-09-29, reasoning from the Monday case above. But Monday and
   * Tuesday differ: on Monday the week is still being played and a club that played Sunday really
   * is settled; once the whole week is over, Sleeper and ESPN carry the same starters into the
   * next week, so an IR starter IS in next week's lineup until someone moves him.
   *
   * Measured on the App Review account that Tuesday: the home's Top decisions said "No … injured
   * starters" above a "Starters in doubt" rail listing De'Von Achane (IR, starting, kickoff in 5d),
   * while My Team said "1 ruled out · 5d". The commit that added this file set out to make the
   * queue agree with My Team; on the day after a week it disagreed from the other side. So the
   * verdict is read against the next scheduled week — `plays` with that kickoff, or `done` if the
   * club is on bye there.
   */
  const next = index.byWeek.get(Math.min(...later))
  const kickoff = next?.get(club)
  return kickoff ? { verdict: 'plays', kickoff } : { verdict: 'done' }
}
