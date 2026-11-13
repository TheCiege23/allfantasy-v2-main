/**
 * Guilly (NBA guillotine) setup — design-refs/native-league-handoff/guilly/ `GuillySetup`.
 *
 * Guilly is NOT a new engine. It is an NBA league on the existing guillotine engine
 * (`lib/guillotine/*`), created through the existing routes with config only:
 *
 *   1. POST /api/league/create                         sport NBA, leagueType guillotine, size, draft type
 *   2. PATCH /api/leagues/[id]/guillotine/summary      first chop week (existing commissioner edit)
 *   3. PUT /api/waiver-wire/leagues/[id]/settings      FAAB waivers + season budget (owner only)
 *
 * Options the engine cannot honour by config are kept in the model but marked unsupported, so the
 * screen shows them disabled ("coming soon") instead of silently accepting a setting nothing runs.
 * Each one is listed with its reason in `GUILLY_UNSUPPORTED` — verified against the engine, not assumed.
 */

export const GUILLY_SPORT = 'NBA' as const
/** NBA guillotine season length (lib/guillotine/sportConfig.ts NBA.regularSeasonWeeks). */
export const GUILLY_NBA_SEASON_WEEKS = 24

export const GUILLY_LEAGUE_SIZES = [12, 14, 16, 18, 20] as const
export const GUILLY_FIRST_CHOP_WEEKS = [1, 2, 3] as const
export const GUILLY_AUCTION_BUDGETS = [100, 200, 500] as const
export const GUILLY_FAAB_BUDGETS = [500, 1000, 2000] as const

export type GuillyDraft = 'auction' | 'snake'
export type GuillyLineups = 'managed' | 'bestball'
export type GuillyRelease = 'blind_faab' | 'free_agency'

export interface GuillySetupState {
  name: string
  leagueSize: (typeof GUILLY_LEAGUE_SIZES)[number]
  draft: GuillyDraft
  auctionBudget: (typeof GUILLY_AUCTION_BUDGETS)[number]
  lineups: GuillyLineups
  firstChopWeek: (typeof GUILLY_FIRST_CHOP_WEEKS)[number]
  doubleChop: boolean
  faabBudget: (typeof GUILLY_FAAB_BUDGETS)[number]
  release: GuillyRelease
}

export const GUILLY_DEFAULTS: GuillySetupState = {
  name: '',
  leagueSize: 18,
  draft: 'auction',
  auctionBudget: 200,
  lineups: 'managed',
  firstChopWeek: 1,
  doubleChop: false,
  faabBudget: 1000,
  release: 'blind_faab',
}

/**
 * Every option the handoff offers that the current engine cannot run, with the evidence. The UI
 * disables exactly these; the PR lists them under "Rules needing a decision".
 */
export const GUILLY_UNSUPPORTED = {
  auctionBudget: 'League creation fixes the auction budget at $200 per team (createCanonicalLeagueInTransaction); other budgets need a create-time setting.',
  freeAgency: 'Releasing chopped rosters straight to free agency is rosterReleaseTiming "immediate", but no route sets it; creation always writes "next_waiver_run" (blind FAAB).',
} as const

/*
 * Best ball and double-chop weeks USED to be listed above as unsupported. Both reasons went stale:
 *  - best ball: a Guilly league's lineups set themselves through `settings.best_ball`
 *    (lib/guillotine/guillotineBestBall.ts) — the same flag the main create wizard writes from its
 *    Guilly "best ball" box (`conceptSetup.guillotineBestBall`). The create route carries
 *    `roster_mode: 'best_ball'` to that flag (legacyManualToCanonicalCreateBody.ts).
 *  - double chops: the chop schedule takes a per-week count (lib/guillotine/chopSchedule.ts
 *    `overrides`), saved through the existing summary PATCH (`{ advanced }`, AF Commissioner).
 */
export function isGuillyOptionSupported(option: 'doubleChop' | 'bestball' | 'freeAgency' | { auctionBudget: number }): boolean {
  if (typeof option === 'object') return option.auctionBudget === 200
  return option === 'doubleChop' || option === 'bestball'
}

/** Double-chop weeks: the first chop week takes two heads (one week of the schedule's `overrides`). */
export function guillyDoubleChopWeeks(s: Pick<GuillySetupState, 'doubleChop' | 'firstChopWeek'>): number[] {
  return s.doubleChop ? [s.firstChopWeek] : []
}

export interface GuillySummary {
  chops: number
  firstChopWeek: number
  lastChopWeek: number
  seasonWeeks: number
  fitsSeason: boolean
  warning: string | null
}

/** One chop per week (the engine's teamsPerChop = 1) plus any double-chop week, last team standing. */
export function summarizeGuilly(s: Pick<GuillySetupState, 'leagueSize' | 'firstChopWeek'> & Partial<Pick<GuillySetupState, 'doubleChop'>>): GuillySummary {
  const chops = s.leagueSize - 1
  // Each double-chop week takes one extra head, so the blade finishes a week sooner.
  const lastChopWeek = s.firstChopWeek + chops - 1 - guillyDoubleChopWeeks({ doubleChop: s.doubleChop === true, firstChopWeek: s.firstChopWeek }).length
  const fitsSeason = lastChopWeek <= GUILLY_NBA_SEASON_WEEKS
  return {
    chops,
    firstChopWeek: s.firstChopWeek,
    lastChopWeek,
    seasonWeeks: GUILLY_NBA_SEASON_WEEKS,
    fitsSeason,
    warning: fitsSeason
      ? null
      : `The last chop would land in week ${lastChopWeek}, after the ${GUILLY_NBA_SEASON_WEEKS}-week NBA season. Choose a smaller league or an earlier first chop.`,
  }
}

/** Errors that block creation. Unsupported options are errors, never silently dropped. */
export function validateGuillySetup(s: GuillySetupState): string[] {
  const errors: string[] = []
  const name = s.name.trim()
  if (name.length < 1 || name.length > 100) errors.push('Give the league a name (up to 100 characters).')
  if (!GUILLY_LEAGUE_SIZES.includes(s.leagueSize)) errors.push('Choose 12, 14, 16, 18 or 20 teams.')
  if (!GUILLY_FIRST_CHOP_WEEKS.includes(s.firstChopWeek)) errors.push('First chop must be week 1, 2 or 3.')
  if (!GUILLY_FAAB_BUDGETS.includes(s.faabBudget)) errors.push('Choose a season FAAB of $500, $1,000 or $2,000.')
  if (s.draft !== 'auction' && s.draft !== 'snake') errors.push('Choose an auction or snake draft.')
  if (s.draft === 'auction' && !isGuillyOptionSupported({ auctionBudget: s.auctionBudget })) errors.push(GUILLY_UNSUPPORTED.auctionBudget)
  if (s.lineups !== 'managed' && s.lineups !== 'bestball') errors.push('Choose managed or best ball lineups.')
  if (s.release === 'free_agency') errors.push(GUILLY_UNSUPPORTED.freeAgency)
  const summary = summarizeGuilly(s)
  if (summary.warning) errors.push(summary.warning)
  return errors
}

/** Body for POST /api/league/create. Only fields that route actually reads. */
export function buildGuillyCreateBody(s: GuillySetupState) {
  return {
    platform: 'manual' as const,
    name: s.name.trim(),
    sport: GUILLY_SPORT,
    leagueSize: s.leagueSize,
    leagueType: 'guillotine',
    draftType: s.draft,
    // `best_ball` is carried to `conceptSetup.guillotineBestBall` -> `settings.best_ball`, exactly what
    // the main wizard's Guilly best ball box saves.
    settings: { teamCount: s.leagueSize, roster_mode: s.lineups === 'bestball' ? 'best_ball' : 'redraft' },
  }
}

export type GuillyFollowUp = { method: 'PATCH' | 'PUT'; url: string; body: Record<string, unknown>; label: string }

/** Requests to run after the league exists. Each one is an existing, permission-checked route. */
export function buildGuillyFollowUps(leagueId: string, s: GuillySetupState): GuillyFollowUp[] {
  const id = encodeURIComponent(leagueId)
  const out: GuillyFollowUp[] = [
    { method: 'PUT', url: `/api/waiver-wire/leagues/${id}/settings`, body: { waiverType: 'faab', faabBudget: s.faabBudget }, label: 'Season FAAB' },
  ]
  const doubleWeeks = guillyDoubleChopWeeks(s)
  // After the first chop week is saved: the summary PATCH checks the schedule against the calendar.
  if (doubleWeeks.length) {
    out.unshift({
      method: 'PATCH',
      url: `/api/leagues/${id}/guillotine/summary`,
      body: { advanced: { steps: [], overrides: Object.fromEntries(doubleWeeks.map((w) => [w, 2])), immunity: 'off' } },
      label: 'Double-chop week (AF Commissioner)',
    })
  }
  if (s.firstChopWeek !== 1) {
    out.unshift({ method: 'PATCH', url: `/api/leagues/${id}/guillotine/summary`, body: { eliminationStartWeek: s.firstChopWeek }, label: 'First chop week' })
  }
  return out
}

/** Notification defaults from the handoff. Display only — nothing is sent from here. */
export const GUILLY_NOTIFICATION_DEFAULTS: { moment: string; when: string; push: boolean; inApp: boolean; email: boolean; chat: boolean }[] = [
  { moment: 'On the chopping block', when: 'Mid-week, below the blade line', push: true, inApp: true, email: false, chat: false },
  { moment: 'Danger alert', when: 'Within reach of the line', push: true, inApp: true, email: false, chat: false },
  { moment: 'Chop night is live', when: 'Before the reveal', push: true, inApp: true, email: false, chat: true },
  { moment: 'Off with your head', when: 'You were chopped', push: true, inApp: true, email: true, chat: true },
  { moment: 'You survived', when: 'Your head stays on', push: true, inApp: true, email: false, chat: false },
  { moment: 'Waiver frenzy is open', when: 'After the chop', push: true, inApp: true, email: true, chat: false },
  { moment: 'Bid results', when: 'After processing', push: true, inApp: true, email: true, chat: true },
  { moment: 'Last team standing', when: 'After the final chop', push: true, inApp: true, email: true, chat: true },
]
