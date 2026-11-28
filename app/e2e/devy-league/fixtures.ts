/**
 * Fixture data for the Devy league-tab harness (/e2e/devy-league/<tab>?mood=<mood>). Browser-side fetch override
 * only: no route handler, no Prisma, no database. Shapes follow the route that answers each read
 * (app/api/leagues/[leagueId]/devy/summary, …/devy/promotion, …/devy/admin/overrides) and the components that read
 * them (components/devy/DevyHome, DevySpecialtyHome, DevyPromotionPanel, DevyCommissionerTools).
 *
 * The stash, pipeline and feed go through the route's own pure shapers (lib/devy/devyHomeView.ts), so the order,
 * class labels, production bars and feed copy are what the route would produce from these rows. Harness-only.
 */
import type { DevyHomeBlock } from '@/components/league/specialty/devy/DevySpecialtyHome'
import type { DevyDraftPhaseInfo } from '@/lib/devy/draft/DevyDraftOrchestration'
import type { PromotionWindowStatus } from '@/lib/devy/lifecycle/DevyLifecycleAutomation'
import { buildDevyStash, devyFeedItems, devyPipelineByYear } from '@/lib/devy/devyHomeView'
import { DEVY_LIFECYCLE_STATE as S } from '@/lib/devy/types'

export const DEVY_LEAGUE_ID = 'e2e-devy-league'
export const DEVY_HARNESS_TABS = ['devy'] as const
export type DevyHarnessTab = (typeof DEVY_HARNESS_TABS)[number]
/**
 * in_season: week 10 of 17, one stashed player has declared · offseason: promotion window before the rookie draft,
 * two of yours promotion-eligible · commissioner: in_season plus the commissioner tools · empty: new league, nothing stashed
 */
export const DEVY_HARNESS_MOODS = ['in_season', 'offseason', 'commissioner', 'empty'] as const
export type DevyHarnessMood = (typeof DEVY_HARNESS_MOODS)[number]

const DAY = 86_400_000
const MY_ROSTER = 'r-devy-me'

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

/** Mirrors DevySummary in components/devy/DevyHome.tsx (local, not exported). */
type DevySummaryFixture = {
  leagueId: string
  sport: string
  sportAdapterId: string | null
  config: {
    devySlotCount: number
    taxiSize: number
    rookieDraftRounds: number
    devyDraftRounds: number
    startupVetRounds?: number | null
    bestBallEnabled: boolean
    startupDraftType: string
    rookieDraftType: string
    devyDraftType: string
  }
  draftPhase: string | null
  draftPhaseInfo: DevyDraftPhaseInfo | null
  sessionId: string | null
  promotionEligibleCount?: number
  league?: DevyHomeBlock['league']
  my?: DevyHomeBlock['my']
  feed?: DevyHomeBlock['feed']
}

/** Mirrors EligibleItem / PromotionResponse in components/devy/DevyPromotionPanel.tsx (local, not exported). */
type EligibleItemFixture = {
  mine?: boolean
  canPromote?: boolean
  rightsId: string
  rosterId: string
  platformUserId: string
  devyPlayerId: string
  devyPlayer: { name: string; position: string; school: string; draftEligibleYear: number | null } | null
  promotedProPlayerId: string | null
  seasonYear: number | null
}
type PromotionResponseFixture = {
  eligible: EligibleItemFixture[]
  seasonYear: number
  config: { promotionTiming: string; maxYearlyDevyPromotions: number | null } | null
  promotionWindow: PromotionWindowStatus
}

/** Mirrors OverrideRow in components/devy/DevyCommissionerTools.tsx (local, not exported). */
type OverrideRowFixture = { id: string; devyPlayerId: string; proPlayerId: string | null; action: string; notes: string | null; createdAt: string }

/** DevyPlayer rows as the summary route selects them. One long name, one long school. */
const PLAYERS = [
  { id: 'dp-arch', name: 'Arch Manning', position: 'QB', school: 'Texas', classYear: 3, draftEligibleYear: 2027, draftProjectionScore: 88, devyValue: null },
  { id: 'dp-jsmith', name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', classYear: 2, draftEligibleYear: 2027, draftProjectionScore: 95, devyValue: null },
  { id: 'dp-rwilliams', name: 'Ryan Williams', position: 'WR', school: 'Alabama', classYear: 2, draftEligibleYear: 2027, draftProjectionScore: 81, devyValue: null },
  { id: 'dp-underwood', name: 'Bryce Underwood', position: 'QB', school: 'Michigan', classYear: 2, draftEligibleYear: 2028, draftProjectionScore: 74, devyValue: null },
  { id: 'dp-moore', name: 'Dakorien Moore', position: 'WR', school: 'Oregon', classYear: 2, draftEligibleYear: 2028, draftProjectionScore: 70, devyValue: null },
  // No projection score and no value: the row shows no production bar (the route's "null, not zero" rule).
  { id: 'dp-long', name: 'Demetrius Kingsley-Okonkwo Jr.', position: 'RB', school: 'Middle Tennessee State University', classYear: 1, draftEligibleYear: 2029, draftProjectionScore: null, devyValue: null },
  { id: 'dp-other', name: 'Kewan Lacy', position: 'RB', school: 'Ole Miss', classYear: 3, draftEligibleYear: 2027, draftProjectionScore: 77, devyValue: null },
]

const right = (id: string, devyPlayerId: string, state: string, promotedProPlayerId: string | null = null) => ({
  id, devyPlayerId, state, slotCategory: state === S.NCAA_DEVY_TAXI ? 'taxi' : 'devy', promotedProPlayerId,
})

const IN_SEASON_RIGHTS = [
  right('rt-arch', 'dp-arch', S.DECLARED),
  right('rt-jsmith', 'dp-jsmith', S.NCAA_DEVY_ACTIVE),
  right('rt-rwilliams', 'dp-rwilliams', S.NCAA_DEVY_ACTIVE),
  right('rt-underwood', 'dp-underwood', S.NCAA_DEVY_ACTIVE),
  right('rt-moore', 'dp-moore', S.RETURNED_TO_SCHOOL),
  right('rt-long', 'dp-long', S.NCAA_DEVY_TAXI),
]

/**
 * After the 2027 NFL draft: Jeremiah Smith drafted and mapped to his pro id (promotable from the callout), Arch Manning
 * promotion-eligible but not yet mapped, Ryan Williams drafted with rights held.
 */
const OFFSEASON_RIGHTS = [
  right('rt-arch', 'dp-arch', S.PROMOTION_ELIGIBLE),
  right('rt-rwilliams', 'dp-rwilliams', S.DRAFTED_RIGHTS_HELD),
  right('rt-jsmith', 'dp-jsmith', S.PROMOTION_ELIGIBLE, 'nfl-jeremiah-smith'),
  right('rt-underwood', 'dp-underwood', S.NCAA_DEVY_ACTIVE),
  right('rt-moore', 'dp-moore', S.NCAA_DEVY_ACTIVE),
  right('rt-long', 'dp-long', S.NCAA_DEVY_TAXI),
]

const ev = (id: string, eventType: string, devyPlayerId: string | null, daysAgo: number) => ({
  id, eventType, devyPlayerId, createdAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
})

const IN_SEASON_EVENTS = [
  ev('ev-1', 'declare_detected', 'dp-arch', 2),
  ev('ev-2', 'return_to_school', 'dp-moore', 9),
  ev('ev-3', 'pool_assignment', 'dp-long', 23),
  ev('ev-4', 'commissioner_override', 'dp-other', 30),
  // An unknown type: devyFeedItems skips it, as the route does.
  ev('ev-5', 'some_future_event', 'dp-jsmith', 31),
]
/** Fixed dates in the 2027 offseason the mood depicts (the feed shows month and day only). */
const at = (id: string, eventType: string, devyPlayerId: string | null, iso: string) => ({ id, eventType, devyPlayerId, createdAt: iso })
const OFFSEASON_EVENTS = [
  at('ev-o1', 'promotion', 'dp-other', '2027-04-29T15:00:00Z'),
  at('ev-o4', 'force_promote', null, '2027-04-28T18:00:00Z'),
  at('ev-o2', 'declare_detected', 'dp-jsmith', '2027-01-12T17:00:00Z'),
  at('ev-o3', 'declare_detected', 'dp-arch', '2027-01-08T17:00:00Z'),
]

const nameOf = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? null

const CONFIG: DevySummaryFixture['config'] = {
  devySlotCount: 8,
  taxiSize: 4,
  rookieDraftRounds: 4,
  devyDraftRounds: 3,
  startupVetRounds: 25,
  bestBallEnabled: false,
  startupDraftType: 'snake',
  rookieDraftType: 'linear',
  devyDraftType: 'snake',
}

const phaseInfo = (phase: DevyDraftPhaseInfo['phase'], status: DevyDraftPhaseInfo['status'], rounds: number, draftType: 'snake' | 'linear'): DevyDraftPhaseInfo => ({
  phase,
  status,
  rounds,
  draftType,
  pickOrderMethod: 'reverse_standings',
  description:
    phase === 'startup_vet' ? 'Startup veteran draft — veterans and established pros only'
    : phase === 'rookie' ? 'Rookie draft — first-year pros; promoted devy excluded'
    : 'Devy draft — NCAA prospects only; graduated players excluded',
})

/** The league season the mood sits in. */
export function moodSeason(mood: DevyHarnessMood): number {
  return mood === 'offseason' ? 2027 : 2026
}

function summary(mood: DevyHarnessMood) {
  const season = moodSeason(mood)
  const league = { name: mood === 'empty' ? 'Campus Futures' : 'Saturday to Sunday Dynasty', season, teamCount: 12, rosterSize: 26 }
  if (mood === 'empty') {
    return {
      leagueId: DEVY_LEAGUE_ID, sport: 'NFL', sportAdapterId: 'nfl_devy', config: CONFIG,
      draftPhase: 'startup_vet', draftPhaseInfo: phaseInfo('startup_vet', 'not_started', 25, 'snake'), sessionId: null,
      promotionEligibleCount: 0,
      league,
      my: { rosterId: MY_ROSTER, proRosterCount: 0, stash: [], pipeline: [] },
      feed: [],
    } satisfies DevySummaryFixture
  }
  const offseason = mood === 'offseason'
  const stash = buildDevyStash(offseason ? OFFSEASON_RIGHTS : IN_SEASON_RIGHTS, PLAYERS)
  return {
    leagueId: DEVY_LEAGUE_ID, sport: 'NFL', sportAdapterId: 'nfl_devy', config: CONFIG,
    draftPhase: 'rookie',
    draftPhaseInfo: offseason ? phaseInfo('rookie', 'not_started', 4, 'linear') : phaseInfo('rookie', 'completed', 4, 'linear'),
    sessionId: offseason ? null : 'ds-rookie-2026',
    // League-wide count, as the route counts it: two of yours plus one on another team.
    promotionEligibleCount: offseason ? 3 : 0,
    league,
    my: { rosterId: MY_ROSTER, proRosterCount: offseason ? 23 : 25, stash, pipeline: devyPipelineByYear(stash, season) },
    feed: devyFeedItems(offseason ? OFFSEASON_EVENTS : IN_SEASON_EVENTS, nameOf),
  } satisfies DevySummaryFixture
}

function promotion(mood: DevyHarnessMood) {
  const season = moodSeason(mood)
  const offseason = mood === 'offseason'
  const eligible: EligibleItemFixture[] = offseason
    ? [
        { rightsId: 'rt-arch', rosterId: MY_ROSTER, platformUserId: 'u-me', devyPlayerId: 'dp-arch', devyPlayer: { name: 'Arch Manning', position: 'QB', school: 'Texas', draftEligibleYear: 2027 }, promotedProPlayerId: null, seasonYear: 2027 },
        { rightsId: 'rt-jsmith', rosterId: MY_ROSTER, platformUserId: 'u-me', devyPlayerId: 'dp-jsmith', devyPlayer: { name: 'Jeremiah Smith', position: 'WR', school: 'Ohio State', draftEligibleYear: 2027 }, promotedProPlayerId: 'nfl-jeremiah-smith', seasonYear: 2027, mine: true, canPromote: true },
        // The route returns another team's eligible player only to the commissioner (2026-11-23), so a manager never sees it.
      ]
    : []
  return {
    eligible,
    seasonYear: season,
    config: { promotionTiming: 'manager_choice_before_rookie_draft', maxYearlyDevyPromotions: null },
    promotionWindow: {
      timing: 'manager_choice_before_rookie_draft',
      // The route reads this off config (`promotionDeadlineIso`); only the offseason has one.
      deadlineIso: offseason ? new Date(Date.now() + 3 * DAY + 6 * 3_600_000).toISOString() : null,
      timingLabel: 'Manager must choose before rookie draft',
      eligibleCount: eligible.length,
    },
  } satisfies PromotionResponseFixture
}

const OVERRIDES: OverrideRowFixture[] = [
  { id: 'ov-1', devyPlayerId: 'dp-other', proPlayerId: null, action: 'manual_map_pending', notes: 'Two "Kewan Lacy" rows in the pro pool', createdAt: new Date(Date.now() - 30 * DAY).toISOString() },
  { id: 'ov-2', devyPlayerId: 'dp-long', proPlayerId: null, action: 'school_mismatch', notes: null, createdAt: new Date(Date.now() - 12 * DAY).toISOString() },
]

/** Every /api/ path the harness saw and did not answer, for the verification script to read. */
export const UNANSWERED_KEY = '__devyHarnessUnanswered'

export function installDevyHarnessFetch(mood: DevyHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __devyHarnessFetch?: boolean; [UNANSWERED_KEY]?: string[] }
  if (w.__devyHarnessFetch) return
  w.__devyHarnessFetch = true
  w[UNANSWERED_KEY] = []
  const real = window.fetch.bind(window)
  const base = `/api/leagues/${DEVY_LEAGUE_ID}/devy`
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const p = url.pathname
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method === 'GET') {
      if (p === `${base}/summary`) return json(summary(mood))
      if (p === `${base}/promotion`) return json(promotion(mood))
      if (p === `${base}/admin/overrides` && mood === 'commissioner') return json({ overrides: OVERRIDES })
      // NativeLeagueWorkspace's scoring chip (it reads `config.presetLabel`).
      if (p === `/api/commissioner/leagues/${DEVY_LEAGUE_ID}/nfl-scoring`) return json({ config: { presetLabel: 'Half PPR' } })
    }
    // Unmatched, writes included: a visual harness answers nothing it was not built for (scripts/e2e-harness-capture.mjs does the same).
    w[UNANSWERED_KEY]!.push(`${method} ${p}${url.search}`)
    return json({ error: 'Not part of this harness.' }, 503)
  }
}
