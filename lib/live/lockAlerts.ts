/**
 * "Kicks off in 12m" — the warning that a lineup decision is about to close.
 *
 * Pure, and deliberately NOT in `liveScoresPage.ts`, which carries
 * `import 'server-only'`. Both live surfaces need this: `/core/live` recomputes
 * it in the browser when the rail scopes the screen to one league. Same reason
 * `liveTieInGroups.ts` and `liveGameSearch.ts` were split out.
 *
 * ⚠ ANCHORED ON KICKOFF, NOT ON A PLATFORM LOCK TIME, BECAUSE WE DO NOT
 * HAVE ONE. `AiTimeContextPayload.nextLockTimeUTC` looks like exactly the right
 * source and is not: `composeFantasyTimeEnginePayload` only FORMATS whatever
 * `matchupLockAt` it is handed, and every caller in this repo hands it `null`
 * (`buildStandardAiPayload` hardcodes it twice). It is a formatter with no feed,
 * so reusing it here would inherit the null and render nothing at all — the
 * quiet kind of wrong that looks like "there is nothing to warn about".
 *
 * Kickoff is the honest anchor: on every platform we import, a player locks when
 * his game starts. A league on a WEEKLY lock rule closed EARLIER than this — at
 * the first game of the week — so this warning can be late for those leagues and
 * is never early. `settings.lineupLockRule` is frequently unset (see
 * `LeagueGovernanceAnalyzer`'s `missing-lineup-lock-rule` finding), so we cannot
 * tell which leagues those are. The copy therefore says "kicks off", never
 * "locks", and points at the platform instead of implying we know its rule.
 */

/**
 * How far ahead of kickoff a game is worth warning about.
 *
 * An hour is the shortest window that still catches the common miss — a bench
 * player in an early game, noticed while watching a different one. Widening it
 * makes the banner permanent furniture on a Sunday morning, which is how an
 * alert stops being read at all.
 */
export const LOCK_WARN_WINDOW_MS = 60 * 60 * 1000

/**
 * The shape this needs from a game card, named structurally so this module does
 * not import from the server-only page loader. `LiveGameCard` satisfies it.
 */
export type LockAlertGame = {
  gameId: string
  isLive: boolean
  completed: boolean
  startTime: string
  home: { abbrev: string }
  away: { abbrev: string }
  tieIns: readonly { leagueId: string; leagueName: string; isStarter: boolean }[]
}

export type LiveLockAlert = {
  gameId: string
  /** "KC @ BUF" — the abbrevs already on the card. */
  matchup: string
  /**
   * Absolute kickoff instant, ISO.
   *
   * ⚠ ABSOLUTE ON PURPOSE — NEVER SEND "IN 14 MINUTES". A relative figure
   * is computed once and then served to every later reader and every 20-second
   * poll, so it is wrong by however long it sat there. Same trap as
   * `LivePageData.fetchedAt`, in the one place on this page where being wrong by
   * minutes changes what the user does. Each client derives the countdown from
   * its own clock.
   */
  kickoffAt: string
  /**
   * Your leagues rostering someone in this game, bench-heaviest first.
   *
   * `leagueId` is carried so `/core/live` can scope the banner to the league in
   * its rail — without it the screen would warn about leagues it is not showing.
   */
  leagues: Array<{ leagueId: string; leagueName: string; starters: number; bench: number }>
  /** Totals across those leagues, so a banner need not re-sum them. */
  starters: number
  bench: number
}

/**
 * Games of yours about to kick off, soonest first.
 *
 * Every branch here is a REFUSAL to warn, which is invisible from the outside —
 * hence the suite.
 */
export function buildLockAlerts(
  games: readonly LockAlertGame[],
  now: number,
): LiveLockAlert[] {
  const out: LiveLockAlert[] = []

  for (const game of games) {
    // Under way, or over: there is no decision left to warn about.
    if (game.isLive || game.completed) continue
    // No player of yours in it, so no lineup of yours turns on it.
    if (game.tieIns.length === 0) continue

    const at = new Date(game.startTime).getTime()
    /*
     * ⚠ AN UNTIMEABLE GAME IS SKIPPED, NOT WARNED ABOUT WITH A GUESS —
     * the same rule `isInSlateWindow` applies to the slate, at the point where
     * being wrong costs a lineup. Explicit rather than incidental: every
     * comparison below is already false for NaN, so a later edit could delete
     * this line and change nothing until the day it matters.
     */
    if (Number.isNaN(at)) continue
    /*
     * ⚠ PAST KICKOFFS ARE EXCLUDED EVEN THOUGH `isLive` IS FALSE. The feed
     * lags — a game can be minutes into the first quarter while its status still
     * reads scheduled, which is why `isLiveRow` is documented as blind for
     * DB-sourced rows. Counting one of those down to "0m" would tell someone
     * they still have time to fix a lineup that locked before they opened the page.
     */
    if (at <= now) continue
    if (at - now > LOCK_WARN_WINDOW_MS) continue

    /*
     * Grouped per league, because the same player is a different decision in
     * each one: started in a TE-premium league and benched in a standard league
     * is two facts, and collapsing them to a headcount loses the actionable half.
     */
    const byLeague = new Map<string, LiveLockAlert['leagues'][number]>()
    for (const tieIn of game.tieIns) {
      const entry =
        byLeague.get(tieIn.leagueId) ??
        { leagueId: tieIn.leagueId, leagueName: tieIn.leagueName, starters: 0, bench: 0 }
      if (tieIn.isStarter) entry.starters += 1
      else entry.bench += 1
      byLeague.set(tieIn.leagueId, entry)
    }

    /*
     * Bench-heaviest league first: a benched player is the decision you are
     * about to lose, where a starter is the choice you already made.
     */
    const leagues = [...byLeague.values()].sort(
      (a, b) => b.bench - a.bench || a.leagueName.localeCompare(b.leagueName),
    )

    out.push({
      gameId: game.gameId,
      matchup: `${game.away.abbrev} @ ${game.home.abbrev}`,
      // Normalised through Date so no client is handed a format only the feed
      // can parse — the feed's own `startTime` strings are not uniform.
      kickoffAt: new Date(at).toISOString(),
      leagues,
      starters: leagues.reduce((sum, l) => sum + l.starters, 0),
      bench: leagues.reduce((sum, l) => sum + l.bench, 0),
    })
  }

  // Soonest first — the only ordering an expiring warning can sensibly have.
  out.sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
  return out
}
