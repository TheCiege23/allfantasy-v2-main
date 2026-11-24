/**
 * Fixture data for the Big Brother league-tab harness (/e2e/big-brother-league/<tab>?mood=<mood>). Browser-side fetch
 * override only: no route handler, no Prisma, no database.
 *
 * The reads, from components/big-brother/*:
 *   GET /api/leagues/[id]/big-brother/summary  BigBrotherHome, every view (`BigBrotherSpecialtySummary`)
 *   GET /api/leagues/[id]/big-brother/config   the Twists view (`config.premiumEngineSpec`)
 *   GET /api/leagues/[id]/big-brother/audit    the History view's house log (`{ log }`), and Admin tools' log
 * BigBrotherCommandDashboard (bb_command) reads nothing.
 *
 * The summary is assembled the way app/api/leagues/[leagueId]/big-brother/summary/route.ts assembles it: `myStatus`,
 * the memory wall's statuses and order come from lib/big-brother/memoryWallStatus.ts (pure, imported here), `ballot`
 * and `finalists` follow the route's own rules, and `home` mirrors lib/league-specialty/bigBrotherHome.ts
 * (`phaseStep` from its STEP_BY_PHASE table, the feed's newest-first HOH / Veto / eviction order, limit 4).
 *
 * Harness-only.
 */
import type { HarnessApiRoute } from '../harnessApi'
import type { BigBrotherSpecialtySummary } from '@/components/big-brother/BigBrotherSpecialtyHome'
import type { BigBrotherMemoryWallEntry } from '@/components/big-brother/types'
import { compareMemoryWallEntries, resolveMemoryWallStatus } from '@/lib/big-brother/memoryWallStatus'
import type { UserProfileForSettings } from '@/lib/user-settings/types'

export const BIG_BROTHER_LEAGUE_ID = 'e2e-big-brother-league'

/** Every LeagueShell tab that renders a Big Brother surface (app/league/[leagueId]/LeagueShell.tsx). */
export const BIG_BROTHER_HARNESS_TABS = ['big_brother', 'bb_hoh', 'bb_veto', 'bb_voting', 'bb_jury', 'bb_twists', 'bb_history', 'bb_command'] as const
export type BigBrotherHarnessTab = (typeof BIG_BROTHER_HARNESS_TABS)[number]

/**
 * hoh_comp:       week 5 of a 12-houseguest NFL season, HOH competition open. Four out (two on the jury). Viewer safe.
 * nominations:    week 5, nominations locked: Morgan is HOH and the viewer is one of the two on the block.
 * veto:           week 5, Veto meeting: the viewer won the Veto and has to decide whether to use it.
 * eviction_vote:  week 5, eviction vote open; the viewer is safe, eligible and has not voted. Week 4's eviction is sealed until "Reveal".
 * jury_finale:    the finale: ten out, seven on the jury (the viewer among them), the final two, the jury's vote open.
 * evicted_viewer: week 6, vote open; the viewer was evicted in week 2, before the jury, so is simply out. Totals private.
 * commissioner:   week 5, Veto competition running; the viewer commissions the league (Command tab, Admin tools).
 * empty:          the house before the season: no cycle yet, twelve houseguests, nobody out.
 */
export const BIG_BROTHER_HARNESS_MOODS = ['hoh_comp', 'nominations', 'veto', 'eviction_vote', 'jury_finale', 'evicted_viewer', 'commissioner', 'empty'] as const
export type BigBrotherHarnessMood = (typeof BIG_BROTHER_HARNESS_MOODS)[number]

export const BB_SEASON = 2026

/** One long personal name, one long team-style display name (BB shows the manager's display name, never a team name). */
const NAMES = [
  'Jordan', // the viewer
  'Morgan',
  'Maximiliana Castellanos-Whitmore',
  'Dez',
  'Avery',
  'The Backyard Gridiron Floaters of East Lansing',
  'Sam',
  'Taylor',
  'Quinn',
  'Drew',
  'Casey',
  'Reese',
] as const
const ID = (i: number) => `ckbbhg${String(i + 1).padStart(6, '0')}`
const ALL = NAMES.map((_, i) => ID(i))
const ME = ID(0)

export function leagueNameFor(mood: BigBrotherHarnessMood) {
  return mood === 'empty' ? 'Big Brother: Gridiron House' : 'Big Brother: The Gridiron House of Questionable Alliances and Backdoor Plans'
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

type Summary = BigBrotherSpecialtySummary
type Cycle = NonNullable<Summary['cycle']>
type Home = NonNullable<Summary['home']>

/** lib/league-specialty/bigBrotherHome.ts STEP_BY_PHASE (that module imports Prisma, so the table is mirrored here). */
const STEP_BY_PHASE: Record<string, number> = {
  HOH_OPEN: 0, HOH_LOCKED: 0, NOMINATION_OPEN: 1, NOMINATION_LOCKED: 1, VETO_DRAW: 2, VETO_CHALLENGE_OPEN: 2,
  VETO_DECISION_OPEN: 3, REPLACEMENT_NOMINATION_OPEN: 3, VOTING_OPEN: 4, VOTING_LOCKED: 5, EVICTION_RESOLVED: 5,
  JURY_UPDATE: 5, RESET_NEXT_WEEK: 5,
}

/** One past or current week, as a BigBrotherCycle row (ids by houseguest index). */
type Week = { week: number; hoh: number; noms: [number, number]; veto: number; evicted?: number; votes?: [number, number] }

/**
 * The season so far. Each closed week evicts one; week N's HOH cannot compete in week N+1. The jury starts after three
 * evictions (`after_eliminations`), so week 1–3 evictees are simply out and week 4 onward join the jury.
 */
const PAST: Week[] = [
  { week: 1, hoh: 6, noms: [11, 7], veto: 9, evicted: 11, votes: [7, 2] },
  { week: 2, hoh: 9, noms: [10, 0], veto: 4, evicted: 10, votes: [6, 2] },
  { week: 3, hoh: 3, noms: [9, 8], veto: 1, evicted: 9, votes: [5, 2] },
  { week: 4, hoh: 7, noms: [8, 6], veto: 6, evicted: 8, votes: [5, 1] },
]
/** evicted_viewer: the same house, except the viewer went home in week 2 instead of Casey. */
const PAST_VIEWER_OUT: Week[] = [
  PAST[0]!,
  { week: 2, hoh: 9, noms: [0, 10], veto: 4, evicted: 0, votes: [6, 2] },
  { week: 3, hoh: 3, noms: [9, 8], veto: 1, evicted: 9, votes: [5, 2] },
  { week: 4, hoh: 7, noms: [8, 6], veto: 6, evicted: 8, votes: [5, 1] },
  { week: 5, hoh: 1, noms: [10, 6], veto: 4, evicted: 10, votes: [4, 1] },
]
/** jury_finale: ten weeks, ten out. The viewer (Jordan) is evicted in week 7 and joins the jury; Morgan and Maximiliana are the final two. */
const PAST_FINALE: Week[] = [
  ...PAST,
  { week: 5, hoh: 1, noms: [7, 6], veto: 6, evicted: 7, votes: [4, 1] },
  { week: 6, hoh: 2, noms: [6, 3], veto: 4, evicted: 6, votes: [4, 0] },
  { week: 7, hoh: 5, noms: [0, 3], veto: 2, evicted: 0, votes: [3, 0] },
  { week: 8, hoh: 1, noms: [3, 4], veto: 5, evicted: 3, votes: [2, 0] },
  { week: 9, hoh: 2, noms: [4, 5], veto: 1, evicted: 4, votes: [1, 0] },
  // Final three: the HOH casts the only eviction vote (BigBrotherVoteEngine).
  { week: 10, hoh: 1, noms: [5, 2], veto: 1, evicted: 5, votes: [1, 0] },
]

const JURY_AFTER = 3

type Current = Omit<Cycle, 'id' | 'week'> & { week: number }

function cycleFor(c: Current): Cycle {
  return { id: `cycle-${c.week}`, ...c }
}

function emptyCycle(week: number, phase: string, rest: Partial<Current> = {}): Current {
  return {
    week, phase, hohRosterId: null, nominee1RosterId: null, nominee2RosterId: null, vetoWinnerRosterId: null,
    vetoParticipantRosterIds: null, vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null,
    evictedRosterId: null, voteDeadlineAt: null, voteOpenedAt: null, closedAt: null, ...rest,
  }
}

/** The `eviction` audit row's public copy (publicEvictionResult): evicted first, counts only when totals are exact. */
function lastEvictionOf(w: Week, exact: boolean, juryEnrolled: boolean): NonNullable<Home['lastEviction']> {
  const [a, b] = w.noms
  const out = w.evicted!
  const stay = a === out ? b : a
  const [outVotes, stayVotes] = w.votes ?? [0, 0]
  return {
    week: w.week,
    evictedRosterId: ID(out),
    nomineeRosterIds: [ID(out), ID(stay)],
    votesByNominee: exact ? { [ID(out)]: outVotes, [ID(stay)]: stayVotes } : null,
    tied: false,
    nominatedByRosterId: ID(w.hoh),
    juryEnrolled,
    releasedPlayerCount: 16,
  }
}

/** bigBrotherFeed: cycles newest first; per cycle eviction, then Veto, then HOH; first four. */
function feedOf(weeks: { week: number; hoh: number | null; veto: number | null; evicted: number | null }[]): Home['feed'] {
  const out: Home['feed'] = []
  for (const c of [...weeks].sort((x, y) => y.week - x.week)) {
    if (c.evicted != null) out.push({ id: `evict-${c.week}`, kind: 'evict', week: c.week, rosterId: ID(c.evicted) })
    if (c.veto != null) out.push({ id: `veto-${c.week}`, kind: 'veto', week: c.week, rosterId: ID(c.veto) })
    if (c.hoh != null) out.push({ id: `hoh-${c.week}`, kind: 'hoh', week: c.week, rosterId: ID(c.hoh) })
  }
  return out.slice(0, 4)
}

const idx = (id: string | null) => (id == null ? null : ALL.indexOf(id))

/**
 * The route's response for one state of the house.
 *   past: closed weeks; current: this week's cycle (null before week 1); exact: publicVoteTotalsVisibility === 'exact'
 */
function summaryFor(opts: {
  mood: BigBrotherHarnessMood
  past: Week[]
  current: Current | null
  exact: boolean
  viewerIsCommissioner: boolean
  nextDecision: Home['nextDecision']
  hasVoted?: boolean
  finaleFormat?: 'final_2' | 'final_3'
}): Summary {
  const { past, current, exact } = opts
  const cycle = current ? cycleFor(current) : null
  const evictedOrder = past.filter((w) => w.evicted != null).map((w) => ({ id: ID(w.evicted!), week: w.week }))
  const eliminatedRosterIds = evictedOrder.map((e) => e.id)
  const jury = evictedOrder.slice(JURY_AFTER).map((e) => ({ rosterId: e.id, evictedWeek: e.week }))
  const juryRosterIds = jury.map((j) => j.rosterId)
  const alive = ALL.filter((id) => !eliminatedRosterIds.includes(id))
  const finalNomineeRosterIds = cycle
    ? [cycle.nominee1RosterId, cycle.nominee2RosterId]
        .map((id) => (id && cycle.vetoUsed && id === cycle.vetoSavedRosterId ? cycle.replacementNomineeRosterId : id))
        .filter((id): id is string => !!id)
    : []
  const lastHoh = past.length ? ID(past[past.length - 1]!.hoh) : null
  const eligibility = cycle
    ? {
        // The outgoing HOH sits out the next HOH competition; this week's HOH cannot be nominated.
        canCompeteHOH: alive.filter((id) => id !== lastHoh),
        canBeNominated: alive.filter((id) => id !== cycle.hohRosterId),
        canVote: alive.filter((id) => id !== cycle.hohRosterId && !finalNomineeRosterIds.includes(id)),
        juryRosterIds,
        eliminatedRosterIds,
      }
    : null

  const myStatus = resolveMemoryWallStatus({ rosterId: ME, cycle, finalNomineeRosterIds, eliminatedRosterIds, juryRosterIds })
  const ballot = cycle
    ? {
        canVote: (eligibility?.canVote.includes(ME) ?? false) && cycle.phase === 'VOTING_OPEN' && !cycle.closedAt,
        hasVoted: opts.hasVoted ?? false,
        voteDeadlineAt: cycle.voteDeadlineAt,
        closed: !!cycle.closedAt || cycle.phase === 'VOTING_LOCKED',
      }
    : null

  const finaleFormat = opts.finaleFormat ?? 'final_2'
  const finaleSize = finaleFormat === 'final_3' ? 3 : 2
  const remainingCount = ALL.length - eliminatedRosterIds.length
  const finalists =
    remainingCount > 0 && remainingCount <= finaleSize
      ? alive.map((id) => ({
          rosterId: id,
          stats: {
            hohWins: past.filter((w) => ID(w.hoh) === id).length,
            vetoWins: past.filter((w) => ID(w.veto) === id).length,
            timesNominated: past.filter((w) => w.noms.some((n) => ID(n) === id)).length,
          },
        }))
      : []

  const rosterDisplayNames = Object.fromEntries(NAMES.map((n, i) => [ID(i), n]))
  const memoryWall: BigBrotherMemoryWallEntry[] = ALL.map((rosterId, i) => ({
    rosterId,
    displayName: NAMES[i]!,
    avatarUrl: null,
    status: resolveMemoryWallStatus({ rosterId, cycle, finalNomineeRosterIds, eliminatedRosterIds, juryRosterIds }),
  })).sort(compareMemoryWallEntries)

  const lastClosed = [...past].reverse().find((w) => w.evicted != null)
  const lastEviction = lastClosed
    ? lastEvictionOf(lastClosed, exact, juryRosterIds.includes(ID(lastClosed.evicted!)))
    : null
  const feedWeeks = [
    ...past.map((w) => ({ week: w.week, hoh: w.hoh, veto: w.veto, evicted: w.evicted ?? null })),
    ...(cycle && !past.some((w) => w.week === cycle.week)
      ? [{ week: cycle.week, hoh: idx(cycle.hohRosterId), veto: idx(cycle.vetoWinnerRosterId), evicted: idx(cycle.evictedRosterId) }]
      : []),
  ]

  return {
    totalRosterCount: ALL.length,
    remainingCount,
    config: {
      sport: 'NFL',
      finaleFormat,
      juryStartMode: 'after_eliminations',
      evictionTieBreakMode: 'season_points',
      challengeMode: 'hybrid',
    },
    sportCalendar: {
      regularSeasonWeeks: 18,
      evictionEndWeek: 17,
      // Empty for NFL (BigBrotherSportCalendar: the disclaimer is non-NFL only).
      scoringWindowDisclaimer: '',
      timelineNote:
        'Weekly deadlines (HOH, nominations, veto, voting) should align to your league\'s scoring week so fantasy points and evictions stay in sync.',
    },
    cycle,
    finalNomineeRosterIds,
    eligibility,
    jury,
    finalists,
    ballot,
    myRosterId: ME,
    myStatus,
    rosterDisplayNames,
    memoryWall,
    isCommissioner: opts.viewerIsCommissioner,
    haveNotRosterIds: cycle ? [ID(6), ID(7)].filter((id) => alive.includes(id)) : [],
    ...(cycle?.phase === 'VETO_CHALLENGE_OPEN'
      ? {
          vetoChallenge: {
            competitorRosterIds: cycle.vetoParticipantRosterIds ?? [],
            challengeMode: 'hybrid',
            themeHints: ['Red-zone efficiency', 'Longest play of the week'],
          },
        }
      : {}),
    home: {
      leagueName: leagueNameFor(opts.mood),
      season: BB_SEASON,
      phaseStep: cycle ? (STEP_BY_PHASE[cycle.phase] ?? -1) : -1,
      nextDecision: opts.nextDecision,
      lastEviction,
      feed: feedOf(feedWeeks),
    },
  }
}

/** Week 5's cast in the four mid-week moods: Morgan won HOH (Taylor, last week's HOH, sat out). */
const W5_HOH = ID(1)

export function summary(mood: BigBrotherHarnessMood): Summary {
  switch (mood) {
    case 'hoh_comp':
      return summaryFor({
        mood, past: PAST, exact: true, viewerIsCommissioner: false,
        current: emptyCycle(5, 'HOH_OPEN'),
        nextDecision: { label: 'HOH challenge', at: iso(26 * HOUR) },
      })
    case 'nominations':
      return summaryFor({
        mood, past: PAST, exact: true, viewerIsCommissioner: false,
        current: emptyCycle(5, 'NOMINATION_LOCKED', { hohRosterId: W5_HOH, nominee1RosterId: ME, nominee2RosterId: ID(2) }),
        nextDecision: { label: 'Veto draw', at: iso(20 * HOUR) },
      })
    case 'veto':
      return summaryFor({
        mood, past: PAST, exact: true, viewerIsCommissioner: false,
        current: emptyCycle(5, 'VETO_DECISION_OPEN', {
          hohRosterId: W5_HOH, nominee1RosterId: ID(2), nominee2RosterId: ID(3), vetoWinnerRosterId: ME,
          vetoParticipantRosterIds: [W5_HOH, ID(2), ID(3), ME, ID(5), ID(6)],
        }),
        nextDecision: { label: 'Veto decision due', at: iso(9 * HOUR) },
      })
    case 'eviction_vote':
      return summaryFor({
        mood, past: PAST, exact: true, viewerIsCommissioner: false,
        current: emptyCycle(5, 'VOTING_OPEN', {
          hohRosterId: W5_HOH, nominee1RosterId: ID(2), nominee2RosterId: ID(3), vetoWinnerRosterId: ID(4),
          vetoParticipantRosterIds: [W5_HOH, ID(2), ID(3), ID(4), ID(5), ID(6)],
          voteOpenedAt: iso(-6 * HOUR), voteDeadlineAt: iso(30 * HOUR),
        }),
        nextDecision: { label: 'Voting closes / eviction', at: iso(30 * HOUR) },
      })
    case 'jury_finale':
      return summaryFor({
        mood, past: PAST_FINALE, exact: true, viewerIsCommissioner: false,
        // The week-10 cycle is the last one; it closed with Morgan's final-three vote.
        current: {
          ...emptyCycle(10, 'JURY_UPDATE', {
            hohRosterId: ID(1), nominee1RosterId: ID(5), nominee2RosterId: ID(2), vetoWinnerRosterId: ID(1),
            vetoParticipantRosterIds: [ID(1), ID(2), ID(5)], evictedRosterId: ID(5),
            voteOpenedAt: iso(-3 * DAY), voteDeadlineAt: iso(-1 * DAY), closedAt: iso(-1 * DAY),
          }),
        },
        nextDecision: null,
      })
    case 'evicted_viewer':
      return summaryFor({
        mood, past: PAST_VIEWER_OUT, exact: false, viewerIsCommissioner: false,
        current: emptyCycle(6, 'VOTING_OPEN', {
          hohRosterId: ID(3), nominee1RosterId: ID(6), nominee2RosterId: ID(2), vetoWinnerRosterId: ID(5),
          vetoParticipantRosterIds: [ID(3), ID(6), ID(2), ID(5), ID(1), ID(7)],
          voteOpenedAt: iso(-4 * HOUR), voteDeadlineAt: iso(28 * HOUR),
        }),
        nextDecision: { label: 'Voting closes / eviction', at: iso(28 * HOUR) },
      })
    case 'commissioner':
      return summaryFor({
        mood, past: PAST, exact: true, viewerIsCommissioner: true,
        current: emptyCycle(5, 'VETO_CHALLENGE_OPEN', {
          hohRosterId: W5_HOH, nominee1RosterId: ID(2), nominee2RosterId: ID(3),
          vetoParticipantRosterIds: [W5_HOH, ID(2), ID(3), ME, ID(5), ID(6)],
        }),
        nextDecision: { label: 'Veto decision due', at: iso(2 * DAY) },
      })
    case 'empty':
      return summaryFor({ mood, past: [], current: null, exact: true, viewerIsCommissioner: false, nextDecision: null })
  }
}

type AuditRow = { eventType: string; metadata: Record<string, unknown>; createdAt: string }

/**
 * GET /api/leagues/[id]/big-brother/audit — newest first, event types from lib/big-brother/BigBrotherAuditLog.ts.
 * Vote totals ride on the eviction row only when the league shows exact totals (redactBigBrotherAuditForViewer).
 */
export function audit(mood: BigBrotherHarnessMood): { log: AuditRow[] } {
  if (mood === 'empty') return { log: [] }
  const s = summary(mood)
  const past = mood === 'jury_finale' ? PAST_FINALE : mood === 'evicted_viewer' ? PAST_VIEWER_OUT : PAST
  const exact = mood !== 'evicted_viewer'
  const rows: AuditRow[] = []
  // Each week runs Thursday–Wednesday; anchor the last closed week at four days ago.
  const base = Date.now() - (past.length + 1) * 7 * DAY + 4 * DAY
  for (const w of past) {
    const t0 = base + (w.week - 1) * 7 * DAY
    const juror = s.jury.some((j) => j.rosterId === ID(w.evicted!))
    rows.push({ eventType: 'hoh_assigned', metadata: { week: w.week, rosterId: ID(w.hoh) }, createdAt: new Date(t0).toISOString() })
    rows.push({ eventType: 'nomination', metadata: { week: w.week, nominee1RosterId: ID(w.noms[0]), nominee2RosterId: ID(w.noms[1]) }, createdAt: new Date(t0 + DAY).toISOString() })
    rows.push({ eventType: 'veto_winner', metadata: { week: w.week, rosterId: ID(w.veto) }, createdAt: new Date(t0 + 2 * DAY).toISOString() })
    rows.push({
      eventType: 'eviction',
      metadata: {
        week: w.week, evictedRosterId: ID(w.evicted!), juryEnrolled: juror, releasedPlayerCount: 16,
        ...(exact ? { voteCount: { [ID(w.evicted!)]: w.votes?.[0] ?? 0 } } : {}),
      },
      createdAt: new Date(t0 + 5 * DAY).toISOString(),
    })
    if (juror) rows.push({ eventType: 'jury_enrolled', metadata: { week: w.week, rosterId: ID(w.evicted!) }, createdAt: new Date(t0 + 5 * DAY + 60_000).toISOString() })
  }
  const c = s.cycle
  if (c && !past.some((w) => w.week === c.week)) {
    const t0 = base + (c.week - 1) * 7 * DAY
    if (c.hohRosterId) rows.push({ eventType: 'hoh_assigned', metadata: { week: c.week, rosterId: c.hohRosterId }, createdAt: new Date(t0).toISOString() })
    if (c.nominee1RosterId && c.nominee2RosterId)
      rows.push({ eventType: 'nomination', metadata: { week: c.week, nominee1RosterId: c.nominee1RosterId, nominee2RosterId: c.nominee2RosterId }, createdAt: new Date(t0 + DAY).toISOString() })
    if (c.vetoWinnerRosterId) rows.push({ eventType: 'veto_winner', metadata: { week: c.week, rosterId: c.vetoWinnerRosterId }, createdAt: new Date(t0 + 2 * DAY).toISOString() })
  }
  return { log: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
}

/**
 * GET /api/leagues/[id]/big-brother/config — the Twists view reads only `config.premiumEngineSpec`. The spec here is
 * what league creation writes (DEFAULT_BIG_BROTHER_PREMIUM_ENGINE_SPEC's twist keys) plus two planned twist weeks.
 * The route returns many more config fields; nothing this harness renders reads them.
 */
export function config(mood: BigBrotherHarnessMood) {
  return {
    config: {
      sport: 'NFL',
      finaleFormat: 'final_2',
      juryStartMode: 'after_eliminations',
      publicVoteTotalsVisibility: mood === 'evicted_viewer' ? 'evicted_only' : 'exact',
      challengeMode: 'hybrid',
      premiumEngineSpec: {
        version: 2,
        twists: {
          enabledKeys: ['double_eviction', 'battle_back', 'secret_hoh', 'hidden_powers', 'safety_pass'],
          scheduledTwistWeeks: mood === 'empty' ? [] : [6, 9],
        },
      },
    },
  }
}

/**
 * GET /api/user/settings `{ profile }` — hooks/useSettingsProfile, read by useUserTimezone for the Voting view's
 * deadline and the house view's "Vote deadline". The viewer's zone is pinned so the harness renders the same
 * times on every machine. (On a miss the hook falls back to /api/user/profile, then to the browser's zone.)
 */
const VIEWER_PROFILE = {
  userId: 'e2e-bb-viewer', username: 'jordan', email: null, displayName: 'Jordan', profileImageUrl: null, avatarPreset: null,
  preferredLanguage: 'en', timezone: 'America/New_York', themePreference: null, phone: null, phoneVerifiedAt: null,
  emailVerifiedAt: null, ageConfirmedAt: null, verificationMethod: null, hasPassword: true, profileComplete: true,
  sleeperUsername: null, sleeperUserId: null, sleeperLinkedAt: null, discordUserId: null, discordUsername: null,
  discordEmail: null, discordAvatar: null, discordGuildId: null, discordConnectedAt: null, spotifyDisplayName: null,
  spotifyConnectedAt: null, bio: null, preferredSports: null, notificationPreferences: null, onboardingStep: null,
  onboardingCompletedAt: null, sessionIdleTimeoutMinutes: null, chimmyTtsVoiceId: null, settings: null,
  updatedAt: new Date('2026-11-01T12:00:00.000Z'),
} satisfies UserProfileForSettings

/** Every /api/ GET a Big Brother tab (and the workspace around it) makes, for this mood. First match wins. */
export function bigBrotherHarnessApi(mood: BigBrotherHarnessMood): HarnessApiRoute[] {
  const base = `/api/leagues/${BIG_BROTHER_LEAGUE_ID}/big-brother`
  const preseason = mood === 'empty'
  return [
    { path: `${base}/summary`, body: summary(mood) },
    { path: `${base}/audit`, body: audit(mood) },
    { path: `${base}/config`, body: config(mood) },
    // NativeLeagueWorkspace's scoring chip (it reads `config.presetLabel`).
    { path: `/api/commissioner/leagues/${BIG_BROTHER_LEAGUE_ID}/nfl-scoring`, body: { config: { presetLabel: 'Half PPR' } } },
    { path: '/api/subscription/entitlements', body: { hasAccess: true, entitlement: { plans: ['pro'], status: 'active' } } },
    // The workspace rail's unread badges: none.
    { path: '/api/chat/unread', body: { byLeague: {} } },
    // The league list's odds bar (components/core-app/useRailOdds).
    { path: '/api/core/rail-odds', body: { odds: preseason ? {} : { [BIG_BROTHER_LEAGUE_ID]: 0.5 }, liveNow: false } },
    { path: '/api/guest-mode/status', body: { isGuest: false } },
    { path: '/api/user/settings', body: { profile: VIEWER_PROFILE } },
  ]
}

/** Every /api/ call the harness saw and did not answer, for the verification script to read. */
export const UNANSWERED_KEY = '__bigBrotherLeagueHarnessUnanswered'

export function installBigBrotherHarnessFetch(mood: BigBrotherHarnessMood) {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __bigBrotherLeagueHarnessFetch?: boolean; [UNANSWERED_KEY]?: string[] }
  if (w.__bigBrotherLeagueHarnessFetch) return
  w.__bigBrotherLeagueHarnessFetch = true
  w[UNANSWERED_KEY] = []
  const routes = bigBrotherHarnessApi(mood)
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const hit =
      method === 'GET'
        ? routes.find((r) => r.path === url.pathname && Object.entries(r.query ?? {}).every(([key, v]) => url.searchParams.get(key) === v))
        : undefined
    if (hit) return new Response(JSON.stringify(hit.body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    // Unmatched, writes included: a visual harness answers nothing it was not built for.
    w[UNANSWERED_KEY]!.push(`${method} ${url.pathname}${url.search}`)
    return new Response(JSON.stringify({ error: 'Not part of this harness.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}
