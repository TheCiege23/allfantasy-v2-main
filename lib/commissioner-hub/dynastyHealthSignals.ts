/**
 * Dynasty-only commissioner health signals: pick balance and taxi squads over their limit.
 *
 * A dynasty league carries things a redraft league does not — future picks, a taxi squad — and the
 * commissioner health views had no signal for either. These are computed from rows already in
 * Postgres (`future_draft_picks` / the imported-pick inventory through `loadDynastyPickCapital`,
 * each roster's stored taxi section, the league's taxi slot setting). Nothing here calls a provider.
 *
 * ⚠ EVERY SIGNAL IS EITHER MEASURED OR SAYS WHY IT IS NOT. A league whose picks are only partly on
 * file (an import that stores just the traded ones) does not get bars: a team holding "2 picks" when
 * its own picks are simply not recorded is the confident wrong answer this file exists to avoid.
 *
 * Pure and client-safe: no Prisma. `dynastyHealthReads.ts` does the reads.
 */

/** How many upcoming drafts the pick balance looks at ("next 3 drafts"). */
export const PICK_BALANCE_DRAFTS = 3

/**
 * A team "holds far more than the average" when it holds MORE THAN TWICE the league average across
 * the window AND at least three picks more than it. Both, so a league averaging one pick a team does
 * not flag a team holding three. There was no existing threshold in the repo to reuse; this one is
 * deliberately loose — stockpiling picks is a legitimate rebuild, so it is a look, not a ruling.
 */
export const HEAVY_PICKS_MULTIPLE = 2
export const HEAVY_PICKS_MIN_EXCESS = 3

/** `DataState` from lib/dynasty-war-room/types.ts. `stale` rows are still the league's picks. */
export type PickCapitalState = 'available' | 'stale' | 'available_empty' | 'partial' | 'missing'

export type DynastyPickBalanceRow = {
  rosterId: string
  teamName: string | null
  /** The viewer's own team, so it can be drawn in gold. */
  isViewer: boolean
  /** Picks held across the window. */
  total: number
  /** Picks held in the next draft. */
  inNextDraft: number
  flag: 'none_next' | 'heavy' | null
}

export type DynastyPickBalance =
  | {
      measured: true
      /** The draft years in the window, earliest first. */
      seasons: number[]
      average: number
      rows: DynastyPickBalanceRow[]
    }
  | { measured: false; reason: 'missing' | 'empty' | 'partial' | 'no_teams' }

export type DynastyTaxiOverLimit =
  | {
      measured: true
      /** Taxi slots the league allows each team. */
      limit: number
      teams: Array<{ rosterId: string; teamName: string | null; held: number }>
    }
  | { measured: false; reason: 'no_limit' | 'no_rosters' }

export type DynastyHealthSignals = {
  picks: DynastyPickBalance
  taxi: DynastyTaxiOverLimit
}

export type PickBalanceTeam = { rosterId: string; teamName: string | null; isViewer: boolean }

export function computePickBalance(input: {
  state: PickCapitalState
  picksByRosterId: ReadonlyMap<string, ReadonlyArray<{ season: number }>>
  teams: readonly PickBalanceTeam[]
  drafts?: number
}): DynastyPickBalance {
  if (input.state === 'missing') return { measured: false, reason: 'missing' }
  if (input.state === 'partial') return { measured: false, reason: 'partial' }
  if (input.teams.length === 0) return { measured: false, reason: 'no_teams' }

  const allSeasons = new Set<number>()
  for (const team of input.teams) {
    for (const pick of input.picksByRosterId.get(team.rosterId) ?? []) {
      if (Number.isFinite(pick.season)) allSeasons.add(pick.season)
    }
  }
  // No picks anywhere is "nothing on file", never "every team holds none".
  if (input.state === 'available_empty' || allSeasons.size === 0) return { measured: false, reason: 'empty' }

  const seasons = [...allSeasons].sort((a, b) => a - b).slice(0, input.drafts ?? PICK_BALANCE_DRAFTS)
  const window = new Set(seasons)
  const next = seasons[0]
  const counted = input.teams.map((team) => {
    const picks = (input.picksByRosterId.get(team.rosterId) ?? []).filter((p) => window.has(p.season))
    return { ...team, total: picks.length, inNextDraft: picks.filter((p) => p.season === next).length }
  })
  const sum = counted.reduce((n, row) => n + row.total, 0)
  const average = sum / counted.length
  const rows: DynastyPickBalanceRow[] = counted
    .map((row) => ({
      ...row,
      flag:
        row.inNextDraft === 0
          ? ('none_next' as const)
          : row.total > average * HEAVY_PICKS_MULTIPLE && row.total - average >= HEAVY_PICKS_MIN_EXCESS
            ? ('heavy' as const)
            : null,
    }))
    .sort((a, b) => b.total - a.total || String(a.teamName ?? '').localeCompare(String(b.teamName ?? '')))
  return { measured: true, seasons, average: Math.round(average * 10) / 10, rows }
}

export function computeTaxiOverLimit(input: {
  limit: number | null
  rosters: ReadonlyArray<{ rosterId: string; teamName: string | null; taxiCount: number }>
}): DynastyTaxiOverLimit {
  if (input.limit == null || !Number.isFinite(input.limit) || input.limit < 0) return { measured: false, reason: 'no_limit' }
  if (input.rosters.length === 0) return { measured: false, reason: 'no_rosters' }
  const limit = Math.floor(input.limit)
  return {
    measured: true,
    limit,
    teams: input.rosters
      .filter((r) => r.taxiCount > limit)
      .map((r) => ({ rosterId: r.rosterId, teamName: r.teamName, held: r.taxiCount }))
      .sort((a, b) => b.held - a.held),
  }
}

const name = (n: string | null) => n?.trim() || 'an unnamed team'

/**
 * The signals as English alert lines, for the health snapshot's `alerts` — which is what the
 * commissioner health decision, and so Chimmy's commissioner grounding, reads. Only what was
 * measured, with the counts it was measured from; an unmeasured signal adds nothing rather than a
 * guess. Healthy signals add nothing either: an alert is something to act on.
 */
export function dynastyAlertLines(signals: DynastyHealthSignals): string[] {
  const lines: string[] = []
  const { picks, taxi } = signals
  if (picks.measured) {
    const none = picks.rows.filter((r) => r.flag === 'none_next')
    const heavy = picks.rows.filter((r) => r.flag === 'heavy')
    if (none.length > 0) {
      lines.push(
        `Dynasty picks: ${none.map((r) => name(r.teamName)).join(', ')} hold${none.length === 1 ? 's' : ''} no pick in the ${picks.seasons[0]} draft.`,
      )
    }
    if (heavy.length > 0) {
      lines.push(
        `Dynasty picks: ${heavy.map((r) => `${name(r.teamName)} holds ${r.total}`).join(', ')} picks across the next ${picks.seasons.length} drafts, against a league average of ${picks.average}.`,
      )
    }
  }
  if (taxi.measured && taxi.teams.length > 0) {
    lines.push(
      `Taxi squads over the ${taxi.limit}-slot limit: ${taxi.teams.map((t) => `${name(t.teamName)} (${t.held})`).join(', ')}.`,
    )
  }
  return lines
}
