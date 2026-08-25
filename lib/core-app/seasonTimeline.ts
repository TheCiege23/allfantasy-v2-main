/**
 * The season timeline, built from the league's OWN settings.
 *
 * ⚠ EVERY PHASE HERE MUST COME FROM THE IMPORTED LEAGUE. The panel previously
 * read like a real calendar — "Trade deadline WK 10", "Playoffs WK 15-16" — for
 * leagues nobody had checked. Those are the defaults of a typical 12-team
 * Sleeper redraft, and printing them for a league that trades all season, or
 * has no playoffs at all, is a confident lie about that league's rules. Someone
 * plans around a deadline that does not exist, or misses one that does.
 *
 * So: a phase appears ONLY when the setting behind it is present. Absence is
 * rendered as absence. A league with no `trade_deadline` gets no trade-deadline
 * marker — not a guessed one, and not a silent omission either: `notes` says
 * which settings were missing so the screen can explain the shorter timeline.
 *
 * ⚠ AND A LEAGUE WITHOUT PLAYOFFS IS NOT A BROKEN LEAGUE. Guillotine leagues
 * eliminate a team every week and end with one survivor; there is no bracket and
 * no championship round. The timeline reshapes rather than showing empty
 * playoff phases.
 *
 * Client-safe on purpose: no `server-only`, no Prisma. The loader passes the
 * settings blob in, and the same function is testable without a database.
 */

export type TimelinePhase = {
  key: string
  label: string
  /** "WK 10", "WK 15-17", "Aug", or null when the phase has no week range. */
  when: string | null
  /** Matches the vocabulary af-league-home.css already styles. */
  state: 'past' | 'now' | 'future'
  /** Shown under the label — why this phase exists or what it means. */
  detail?: string
}

export type SeasonTimeline = {
  phases: TimelinePhase[]
  /**
   * Settings we looked for and did not find. The screen uses these to explain a
   * timeline that is shorter than someone expects, instead of leaving them to
   * assume the data is broken.
   */
  notes: string[]
  /** True when the league has no playoff bracket configured. */
  eliminationFormat: boolean
  /** The week the timeline believes we are in, or null. */
  currentWeek: number | null
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : null
  return n == null || Number.isNaN(n) ? null : n
}

function readSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') return {}
  const s = settings as Record<string, unknown>
  /*
   * Imports keep Sleeper's flat keys alongside a canonical snapshot, and which
   * one is populated varies by import path. Checking both costs nothing and
   * avoids a timeline that silently empties for half the leagues.
   */
  const nested = s.sleeper ?? s.sleeperLeague ?? s.league
  return nested && typeof nested === 'object'
    ? { ...(nested as Record<string, unknown>), ...s }
    : s
}

/**
 * The league's own current week, from Sleeper's `leg`.
 *
 * ⚠ THIS IS THE AUTHORITATIVE PER-LEAGUE WEEK AND NOTHING WAS READING IT. The
 * league home derived "you are here" from the next NFL kickoff on the calendar,
 * with no season-type filter — so in August it matched a PRESEASON fixture and
 * rendered its round number as a fantasy week. That is how a screen on
 * 2026-08-24 said "You are here · week 3" for a season that had not started.
 *
 * A real-world kickoff cannot answer this question anyway: it knows nothing
 * about the league. `leg` is the platform's own answer for THIS league.
 */
export function leagueWeekFromSettings(settings: unknown): number | null {
  const s = readSettings(settings)
  const leg = num(s.leg ?? s.current_week ?? s.currentWeek)
  // A sane bound, because a junk value here mislabels the whole timeline.
  return leg != null && leg >= 1 && leg <= 30 ? leg : null
}

/** Week range label: "WK 15" or "WK 15-17". */
function weeks(from: number, to: number): string {
  return from === to ? `WK ${from}` : `WK ${from}-${to}`
}

/**
 * How many weeks the regular season runs, from the league's own settings.
 *
 * Extracted so the week picker and the timeline cannot disagree about where the
 * season ends. Falls back to the week before the playoffs start, and returns
 * null rather than guessing 14 — a picker offering weeks a league does not play
 * is worse than one that offers none.
 */
export function regularSeasonWeeks(settings: unknown): number | null {
  const s = readSettings(settings)
  const playoffStart = num(
    s.playoff_start_week ?? s.playoff_week_start ?? s.playoffStartWeek ?? s.playoffWeekStart,
  )
  return (
    num(s.regular_season_length) ??
    (playoffStart != null && playoffStart > 1 ? playoffStart - 1 : null)
  )
}

export function buildSeasonTimeline(args: {
  settings: unknown
  /** The league's current week, when known. */
  currentWeek: number | null
  /**
   * Sleeper's league `status`: 'pre_draft' | 'drafting' | 'in_season' |
   * 'complete'. The single most reliable phase signal, when present.
   */
  status?: string | null
  /** `League.leagueType` / `leagueVariant`, when the repo knows the format. */
  variant?: string | null
  /**
   * `League.guillotineMode`. The one POSITIVE signal for this format — the
   * Sleeper importer can only ever write 'IDP', 'DYNASTY_IDP', 'legacy_summary'
   * or null into `leagueVariant`, so a guillotine league imported from Sleeper
   * is identified by a name regex into `leagueType` and by this flag.
   */
  guillotineMode?: boolean | null
}): SeasonTimeline {
  const s = readSettings(args.settings)
  const notes: string[] = []

  /*
   * ⚠ THE IMPORTER RENAMES SLEEPER'S KEYS, so reading Sleeper's own spelling
   * finds nothing on an imported league. `SleeperLeagueMapper` maps
   * `playoff_week_start` -> `playoff_start_week` and `trade_deadline` ->
   * `trade_deadline_week` before the blob is written. The raw spellings survive
   * only under `raw_settings` on a second, older sync path, so both are read.
   */
  const playoffStart = num(
    s.playoff_start_week ?? s.playoff_week_start ?? s.playoffStartWeek ?? s.playoffWeekStart,
  )
  const rawDeadline = num(
    s.trade_deadline_week ?? s.trade_deadline ?? s.tradeDeadline ?? s.tradeDeadlineWeek,
  )
  const playoffTeams = num(s.playoff_teams ?? s.playoff_team_count ?? s.playoffTeams)
  // Same rule the week picker uses -- one implementation, so they cannot drift.
  const regularSeasonLength = regularSeasonWeeks(args.settings)

  /*
   * ⚠ 99 MEANS "NO DEADLINE", NOT WEEK 99. It is the platform's sentinel for
   * "trades stay open", and four production leagues carry it against regular
   * seasons of 14 and 18 weeks. Rendering "Trade deadline WK 99" would be a
   * confident, checkable falsehood on a panel people plan around. A deadline
   * past the end of the season means the same thing.
   *
   * This mirrors `resolveDeadline` in lib/core-app/trades.ts — the two panels
   * describe the same rule and must not disagree about it.
   */
  const noDeadline =
    rawDeadline == null ||
    rawDeadline <= 0 ||
    rawDeadline >= 99 ||
    (regularSeasonLength != null && rawDeadline > regularSeasonLength)
  const tradeDeadline = noDeadline ? null : rawDeadline

  const status = (args.status ?? '').toLowerCase()

  const variant = (args.variant ?? '').toLowerCase()
  const knownGuillotine =
    args.guillotineMode === true || variant.includes('guillotine') || variant.includes('survivor')

  /*
   * No playoff week configured means no bracket. That is the real signal —
   * stronger than a league's name, which is not evidence of anything.
   */
  const eliminationFormat = knownGuillotine || playoffStart == null || playoffStart <= 0

  const phases: TimelinePhase[] = []
  const cw = args.currentWeek

  // ── Pre-season phases, driven by the platform's own status ─────────────
  if (status === 'pre_draft' || status === 'drafting' || status === 'complete') {
    phases.push({
      key: 'offseason',
      label: 'Offseason',
      when: null,
      state: status === 'complete' ? 'now' : 'past',
      detail: status === 'complete' ? 'Season finished — rosters carry over' : undefined,
    })
    phases.push({
      key: 'draft',
      label: status === 'drafting' ? 'Draft — on the clock' : 'Draft',
      when: null,
      state: status === 'drafting' ? 'now' : status === 'pre_draft' ? 'future' : 'past',
      detail: status === 'pre_draft' ? 'Not started' : undefined,
    })
    phases.push({
      key: 'preseason',
      label: 'Preseason',
      when: null,
      state: 'future',
      detail: 'Exhibition games — projections do not describe a fantasy week',
    })
  }

  // ── Regular season ─────────────────────────────────────────────────────
  /*
   * The league's own regular-season length, computed at import as
   * `playoff_week_start - 1`. Preferred over re-deriving it, because a league
   * can carry the length without carrying the playoff week.
   */
  const regularEnd = regularSeasonLength

  if (regularEnd == null) {
    notes.push(
      'This league has no playoff start week on file, so the regular season has no end date here.',
    )
  }

  const inRegular = cw != null && (regularEnd == null || cw <= regularEnd)

  if (tradeDeadline != null && regularEnd != null && tradeDeadline < regularEnd) {
    // Split the regular season around the deadline, which is what a manager
    // actually plans against.
    phases.push({
      key: 'regular-early',
      label: eliminationFormat ? 'Survive' : 'Regular season',
      when: weeks(1, tradeDeadline),
      state: cw == null ? 'future' : cw <= tradeDeadline ? 'now' : 'past',
    })
    phases.push({
      key: 'trade-deadline',
      label: 'Trade deadline',
      when: `WK ${tradeDeadline}`,
      state: cw == null ? 'future' : cw > tradeDeadline ? 'past' : 'future',
      detail: 'Read from this league — no trades accepted after it',
    })
    phases.push({
      key: 'regular-late',
      label: eliminationFormat ? 'Survive' : 'Run-in',
      when: weeks(tradeDeadline + 1, regularEnd),
      state: cw == null ? 'future' : cw > tradeDeadline && cw <= regularEnd ? 'now' : cw > regularEnd ? 'past' : 'future',
    })
  } else {
    phases.push({
      key: 'regular',
      label: eliminationFormat ? 'Survive' : 'Regular season',
      when: regularEnd != null ? weeks(1, regularEnd) : 'week 1 onward',
      state: cw == null ? 'future' : inRegular ? 'now' : 'past',
    })
    if (tradeDeadline != null) {
      phases.push({
        key: 'trade-deadline',
        label: 'Trade deadline',
        when: `WK ${tradeDeadline}`,
        state: cw == null ? 'future' : cw > tradeDeadline ? 'past' : 'future',
        detail: 'Read from this league',
      })
    } else {
      notes.push(
        'No trade deadline is set on this league, so trades stay open all season.',
      )
    }
  }

  // ── The end of the season ──────────────────────────────────────────────
  if (eliminationFormat) {
    /*
     * ⚠ NO BRACKET, SO NO BRACKET PHASES. A guillotine league ends when one
     * team is left standing. Showing "Playoffs" and "Championship" here would
     * describe rounds that will never be played.
     */
    phases.push({
      key: 'last-standing',
      label: knownGuillotine ? 'Last one with a head' : 'Last team standing',
      when: null,
      state: cw != null && regularEnd != null && cw > regularEnd ? 'now' : 'future',
      detail: 'No bracket — the league runs until one team is left',
    })
    if (!knownGuillotine) {
      notes.push(
        'No playoff bracket is configured, so this reads as an elimination league. If that is wrong, the league needs a playoff start week.',
      )
    }
  } else if (playoffStart != null && playoffStart > 0) {
    const rounds = playoffTeams != null && playoffTeams > 0 ? Math.ceil(Math.log2(playoffTeams)) : null
    const playoffEnd = rounds != null ? playoffStart + rounds - 1 : playoffStart
    const finalWeek = playoffEnd

    phases.push({
      key: 'playoffs',
      label: 'Playoffs',
      when: rounds != null && rounds > 1 ? weeks(playoffStart, finalWeek - 1) : `WK ${playoffStart}`,
      state: cw == null ? 'future' : cw >= playoffStart && cw < finalWeek ? 'now' : cw >= finalWeek ? 'past' : 'future',
      detail: playoffTeams != null ? `${playoffTeams} teams` : undefined,
    })
    phases.push({
      key: 'championship',
      label: 'Championship',
      when: `WK ${finalWeek}`,
      state: cw == null ? 'future' : cw === finalWeek ? 'now' : cw > finalWeek ? 'past' : 'future',
    })
    if (playoffTeams == null) {
      notes.push(
        'The number of playoff teams is not on file, so the playoff length is the start week only.',
      )
    }
  }

  // ── After it all ───────────────────────────────────────────────────────
  phases.push({
    key: 'offseason-next',
    label: 'Offseason',
    when: null,
    state: status === 'complete' ? 'now' : 'future',
    detail: 'Rookie draft order, keepers and taxi decisions',
  })

  return { phases, notes, eliminationFormat, currentWeek: cw }
}
