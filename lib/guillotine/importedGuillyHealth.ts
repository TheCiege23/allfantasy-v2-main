/**
 * Is an imported Guilly league's picture here trustworthy? (2026-10-30)
 *
 * An imported Guilly league is chopped by its provider (./importedLeagueGuard.ts); we only mirror its
 * sync. Nothing records a chop for it — no chop row, no eliminated flag — so everything the app shows
 * about who is out is INFERRED: from the week's scores (a team at 0 while the field scored is out; the
 * single lowest scorer of a completed week is chopped after it — `choppedBefore` in
 * lib/core-app/railMatchups.ts, whose rule this mirrors week by week) and from rosters the provider
 * has emptied. When that inference and the provider disagree, the app is quietly wrong. This says so.
 *
 * Pure. The loader is lib/core-app/leagueSync.ts; the card is the league's Sync screen.
 */

export type ImportedGuillyRow = { week: number; rosterId: string; pointsFor: number; matchupId: number | null }

export type ImportedGuillyInput = {
  /** League.leagueType — an importer's guess unless the commissioner confirmed it. */
  leagueType: string | null
  guillotineMode: boolean | null
  settings: unknown
  /** This season's weekly score rows (WeeklyMatchup), keyed by the provider's roster id. */
  rows: ReadonlyArray<ImportedGuillyRow>
  /** The provider's roster ids with how many players each holds now. */
  rosters: ReadonlyArray<{ rosterId: string; players: number }>
  /** The league's current week; weeks before it are complete. */
  currentWeek: number | null
  /** Our last successful read of the league. */
  lastReadAt: Date | null
  /** In season: a stale read matters (a chop may have happened since). */
  inSeason: boolean
  now: Date
}

export type ImportedGuillyFinding = {
  code:
    | 'unconfirmed_format'
    | 'plays_head_to_head'
    | 'stale_read'
    | 'no_scores'
    | 'scored_after_chop'
    | 'tie_at_bottom'
    | 'mass_emptying'
    | 'empty_without_chop'
  severity: 'attention' | 'info'
  text: string
  week?: number
  rosterIds?: string[]
}

export type ImportedGuillyHealth = {
  /** confirmed: the commissioner said so; detected: an importer's guess from the name/settings. */
  format: 'confirmed' | 'detected'
  status: 'ok' | 'attention'
  /** Chops read from the scores, oldest first. */
  chops: Array<{ week: number; rosterIds: string[] }>
  teamsAlive: number | null
  findings: ImportedGuillyFinding[]
}

/** Our read is stale in season after this long: a week's chop can land in a day. */
export const IMPORTED_GUILLY_STALE_MS = 24 * 60 * 60 * 1000

function confirmedType(settings: unknown): string | null {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : null
  const c = s?.leagueTypeConfirmation
  return c && typeof c === 'object' && typeof (c as Record<string, unknown>).type === 'string' ? String((c as Record<string, unknown>).type) : null
}

/** Whether this league is treated as Guilly at all, and how sure that is. Null: not a Guilly league. */
export function importedGuillyFormat(league: Pick<ImportedGuillyInput, 'leagueType' | 'guillotineMode' | 'settings'>): ImportedGuillyHealth['format'] | null {
  const confirmed = confirmedType(league.settings)
  if (confirmed != null) return confirmed === 'guillotine' ? 'confirmed' : null
  return league.leagueType === 'guillotine' || league.guillotineMode === true ? 'detected' : null
}

/**
 * Chops week by week, by the rule the rail uses (railMatchups.ts `choppedBefore`), but keeping the week
 * each team went. A tie at the bottom chops nobody: the provider's tiebreak is not on file.
 */
export function chopTimeline(rows: ReadonlyArray<ImportedGuillyRow>, currentWeek: number): {
  chops: Array<{ week: number; rosterIds: string[] }>
  out: Map<string, number>
  ties: Array<{ week: number; rosterIds: string[] }>
} {
  const out = new Map<string, number>()
  const chops: Array<{ week: number; rosterIds: string[] }> = []
  const ties: Array<{ week: number; rosterIds: string[] }> = []
  const weeks = [...new Set(rows.map((r) => r.week))].filter((w) => w < currentWeek).sort((a, b) => a - b)
  for (const week of weeks) {
    const live = rows.filter((r) => r.week === week && !out.has(r.rosterId))
    const scored = live.filter((r) => r.pointsFor > 0)
    if (scored.length === 0) continue
    const goneThisWeek: string[] = []
    // A team at 0 while the field scored was already out: it went at the end of the week before.
    for (const r of live) if (r.pointsFor <= 0) { out.set(r.rosterId, week - 1); goneThisWeek.push(r.rosterId) }
    if (goneThisWeek.length) {
      const prior = chops.find((c) => c.week === week - 1)
      if (prior) prior.rosterIds.push(...goneThisWeek.filter((id) => !prior.rosterIds.includes(id)))
      else chops.push({ week: week - 1, rosterIds: goneThisWeek })
    }
    const low = Math.min(...scored.map((r) => r.pointsFor))
    const lowest = scored.filter((r) => r.pointsFor === low)
    if (lowest.length === 1) {
      out.set(lowest[0]!.rosterId, week)
      const existing = chops.find((c) => c.week === week)
      if (existing) existing.rosterIds.push(lowest[0]!.rosterId)
      else chops.push({ week, rosterIds: [lowest[0]!.rosterId] })
    } else {
      ties.push({ week, rosterIds: lowest.map((r) => r.rosterId).sort() })
    }
  }
  chops.sort((a, b) => a.week - b.week)
  for (const c of chops) c.rosterIds.sort()
  return { chops, out, ties }
}

function hours(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`
}

export function assessImportedGuilly(input: ImportedGuillyInput): ImportedGuillyHealth | null {
  const format = importedGuillyFormat(input)
  if (!format) return null
  const findings: ImportedGuillyFinding[] = []

  if (format === 'detected') {
    findings.push({
      code: 'unconfirmed_format',
      severity: 'info',
      text: 'We recognised this as a Guilly league from its name or settings. Confirm the league type so the chop view can be trusted.',
    })
  }

  /*
   * A Guilly week has no opponent. Two rows sharing a matchup id are a head-to-head game, and a league
   * where most teams are paired is not chopping anyone, whatever its name says.
   */
  const pairedWeeks = [...new Set(input.rows.map((r) => r.week))].filter((week) => {
    const ids = input.rows.filter((r) => r.week === week && r.matchupId != null).map((r) => r.matchupId!)
    const counts = new Map<number, number>()
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
    const paired = [...counts.values()].filter((n) => n === 2).length * 2
    const field = input.rows.filter((r) => r.week === week).length
    return field > 0 && paired >= field / 2
  })
  if (pairedWeeks.length > 0) {
    findings.push({
      code: 'plays_head_to_head',
      severity: 'attention',
      text: `Teams are paired head-to-head in ${pairedWeeks.length === 1 ? 'one week' : `${pairedWeeks.length} weeks`} of scores. A Guilly league has no opponents, so this may not be a Guilly league.`,
    })
  }

  if (input.inSeason) {
    if (!input.lastReadAt) {
      findings.push({ code: 'stale_read', severity: 'attention', text: 'We have never read this league, so no chop can be shown.' })
    } else if (input.now.getTime() - input.lastReadAt.getTime() > IMPORTED_GUILLY_STALE_MS) {
      findings.push({
        code: 'stale_read',
        severity: 'attention',
        text: `We last read this league ${hours(input.now.getTime() - input.lastReadAt.getTime())} ago. A chop since then is not shown yet.`,
      })
    }
  }

  const currentWeek = input.currentWeek ?? (input.rows.length ? Math.max(...input.rows.map((r) => r.week)) + 1 : 1)
  const timeline = chopTimeline(input.rows, currentWeek)
  if (input.rows.length === 0 && input.inSeason && currentWeek > 1) {
    findings.push({ code: 'no_scores', severity: 'attention', text: 'No weekly scores are on file, so we cannot tell who has been chopped.' })
  }

  // A team the scores say is out, scoring again later: the provider kept it, so our "out" is wrong.
  const revived = [...timeline.out.entries()]
    .filter(([rosterId, week]) => input.rows.some((r) => r.rosterId === rosterId && r.week > week && r.pointsFor > 0))
    .map(([rosterId]) => rosterId)
    .sort()
  if (revived.length > 0) {
    findings.push({
      code: 'scored_after_chop',
      severity: 'attention',
      text: `${revived.length === 1 ? 'A team' : `${revived.length} teams`} we read as chopped scored again in a later week. Our chop view is wrong for ${revived.length === 1 ? 'it' : 'them'}.`,
      rosterIds: revived,
    })
  }

  for (const tie of timeline.ties) {
    findings.push({
      code: 'tie_at_bottom',
      severity: 'info',
      week: tie.week,
      rosterIds: tie.rosterIds,
      text: `Week ${tie.week} tied at the bottom. The provider's tiebreak is not on file, so the chop shows once the next week's scores do.`,
    })
  }

  /*
   * Empty rosters. A chopped team's players are released, so its roster empties — late in a season most
   * rosters are empty, legitimately. Only the empties the scores do NOT explain count: one or two is a chop
   * the scores have not caught up with; half the league at once is a new season or a re-import.
   */
  const unexplained = input.rosters.filter((r) => r.players === 0 && !timeline.out.has(r.rosterId)).map((r) => r.rosterId).sort()
  if (unexplained.length > 1 && unexplained.length >= Math.ceil(input.rosters.length / 2)) {
    findings.push({
      code: 'mass_emptying',
      severity: 'attention',
      text: `${unexplained.length} of ${input.rosters.length} rosters emptied at once. That is a new season or a re-import, not chops — the chop view is paused until rosters fill.`,
      rosterIds: unexplained,
    })
  } else if (unexplained.length > 0 && input.rows.length > 0) {
    findings.push({
      code: 'empty_without_chop',
      severity: 'attention',
      text: `${unexplained.length === 1 ? 'A roster is' : `${unexplained.length} rosters are`} empty, but the scores show no chop for ${unexplained.length === 1 ? 'it' : 'them'} yet.`,
      rosterIds: unexplained,
    })
  }

  const teamsAlive = input.rosters.length > 0 ? input.rosters.filter((r) => !timeline.out.has(r.rosterId)).length : null
  return {
    format,
    status: findings.some((f) => f.severity === 'attention') ? 'attention' : 'ok',
    chops: timeline.chops,
    teamsAlive,
    findings,
  }
}
