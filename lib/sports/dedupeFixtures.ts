/**
 * COLLAPSE THE FOUR PROVIDER ROWS THAT DESCRIBE ONE FIXTURE.
 *
 * ⚠ `SportsGame` HOLDS ONE ROW PER PROVIDER PER GAME, AND THEY DISAGREE. Measured
 * on production for a single preseason game:
 *
 *   espn             Pittsburgh Steelers @ Buffalo Bills   27-28  final        fetched 07:00
 *   thesportsdb      Pittsburgh Steelers @ Buffalo Bills   27-28  final        fetched 07:00
 *   rolling_insights Pittsburgh Steelers @ Buffalo Bills   null   final        fetched 07:00
 *   espn_live        PIT @ BUF                             14-10  in_progress  fetched 04:17
 *
 * Listed verbatim that reads as four games, two of them with a score that never
 * happened. Chimmy showed exactly that to a user: six "games" for three
 * fixtures, with contradictory scores.
 *
 * ⚠ TEAM NAMES CANNOT BE COMPARED AS STRINGS, which is why the previous
 * de-duplication silently did nothing — its key included `awayTeam`, so "PIT"
 * and "Pittsburgh Steelers" hashed apart and both survived. `homeTeamId` is null
 * on every source except TheSportsDB, which uses its own id space, so there is
 * no join key either. Matching has to be done on the names themselves.
 *
 * ⚠ AND KICKOFF ALONE IS NOT A FIXTURE. Two different games started at
 * 04:00Z that night, so grouping on `sport + startTime` would merge unrelated
 * teams into one line.
 */

export type FixtureRow = {
  sport?: string | null
  awayTeam?: string | null
  homeTeam?: string | null
  awayScore?: number | null
  homeScore?: number | null
  status?: string | null
  startTime?: Date | string | null
  fetchedAt?: Date | string | null
  source?: string | null
  [key: string]: unknown
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Word initials: "san francisco 49ers" -> "sf4", "los angeles rams" -> "lar". */
function initials(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
}

/**
 * Do two spellings name the same team?
 *
 * Covers every shape observed in production, and the two rules are different
 * because the abbreviations are built two different ways: a one-word city is
 * truncated (Pittsburgh -> PIT, Cleveland -> CLE, Buffalo -> BUF) while a
 * two-word city is initialised (New England -> NE, San Francisco -> SF,
 * Las Vegas -> LV, Los Angeles Rams -> LAR).
 */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = normalise(a)
  const y = normalise(b)
  if (!x || !y) return false
  if (x === y) return true

  const shortIsX = x.length <= y.length
  const short = shortIsX ? x : y
  /* An abbreviation is at most four characters; longer means a real name. */
  if (short.length > 4) return false

  const longRaw = shortIsX ? b : a
  const words = longRaw.toLowerCase().split(/\s+/).filter(Boolean)

  /*
   * ⚠ MATCH THE FIRST WORD, NOT THE WHOLE NAME, AND ONLY FROM THREE LETTERS.
   * Comparing against the concatenated name made "NE" match "New Orleans
   * Saints" — "neworleanssaints" starts with "ne" — so New England and New
   * Orleans would have collapsed into one fixture. Two-letter forms are always
   * city initials and are handled by the initials rule below; only a genuine
   * truncation (Pittsburgh -> PIT) may match a word prefix.
   */
  if (short.length >= 3 && normalise(words[0] ?? '').startsWith(short)) return true

  /* Initialised multi-word name: New England -> NE, Los Angeles Rams -> LAR. */
  return initials(longRaw).startsWith(short)
}

function time(value: Date | string | null | undefined): number {
  if (!value) return 0
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  return Number.isFinite(t) ? t : 0
}

function hasScore(row: FixtureRow): boolean {
  return typeof row.awayScore === 'number' && typeof row.homeScore === 'number'
}

/**
 * Which of two rows for the same fixture should be believed?
 *
 * ⚠ FRESHNESS FIRST, AND IT IS NOT A TIE-BREAK — IT IS THE ANSWER. The stale
 * row in production was not merely older, it was WRONG: `espn_live` froze at
 * 14-10 in_progress when the poller stopped, while every source fetched three
 * hours later agreed the game finished 27-28. Preferring "has a score" or
 * "looks final" over recency would have picked the frozen one on other nights.
 *
 * Only when two rows are equally fresh does having a score decide it — a row
 * with nulls tells the reader nothing.
 */
function preferred(a: FixtureRow, b: FixtureRow): FixtureRow {
  const fa = time(a.fetchedAt)
  const fb = time(b.fetchedAt)
  if (fa !== fb) return fa > fb ? a : b
  if (hasScore(a) !== hasScore(b)) return hasScore(a) ? a : b
  return a
}

/**
 * One row per real fixture, newest data winning.
 *
 * Order is preserved from the input, so a caller that sorted by kickoff keeps
 * that ordering.
 */
export function dedupeFixtures<T extends FixtureRow>(rows: T[]): T[] {
  const kept: T[] = []

  for (const row of rows) {
    const idx = kept.findIndex(
      (held) =>
        (held.sport ?? null) === (row.sport ?? null) &&
        time(held.startTime) === time(row.startTime) &&
        sameTeam(held.awayTeam, row.awayTeam) &&
        sameTeam(held.homeTeam, row.homeTeam),
    )

    if (idx === -1) {
      kept.push(row)
      continue
    }
    kept[idx] = preferred(kept[idx], row) as T
  }

  return kept
}
