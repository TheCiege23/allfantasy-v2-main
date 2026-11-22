import { prisma } from '@/lib/prisma'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { BESTBALL_VARIANTS } from '@/lib/autocoach/bestBallShared'
import { lineupSetsItself } from '@/lib/guillotine/guillotineBestBall'
import { findGuillotineSeasonId } from '@/lib/guillotine/guillotineChopAudit'
import { COMMISSIONER_TIEBREAKS_KEY, decisionDeadline, readCommissionerTiebreak, tiebreakState } from '@/lib/guillotine/commissionerTiebreak'
import { buildWeeklyChecklist, isStarterSlot, isUnavailable, type ChecklistFormat, type ChecklistItem } from './weeklyChecklist'
import { buildZombieWeeklyChecklist } from './zombieWeeklyChecklist'
import { readSettlementHold } from '@/lib/zombie/settlementHoldReasons'

/**
 * Reads for the weekly commissioner checklist (./weeklyChecklist). The league must be AllFantasy-run,
 * in one of the formats `checklistFormat` names, with a season under way.
 */

const RUNNING_SEASON = new Set(['active', 'in_season', 'playoffs'])

type FormatFields = {
  platform: string | null
  leagueType: string | null
  leagueVariant: string | null
  isDynasty: boolean | null
  bestBallMode: boolean | null
  guillotineMode: boolean | null
  settings?: unknown
}

/**
 * The formats whose week runs on the redraft season tables this checklist reads. An ALLOW-list, not a
 * deny-list: survivor, zombie, Big Brother, pirate, salary cap, devy, C2C and any variant added later get no
 * checklist rather than one built for a different week.
 */
const COVERED_TYPES = new Set(['redraft', 'keeper', 'dynasty', 'guillotine', ...BESTBALL_VARIANTS])
const COVERED_VARIANTS = new Set(['', 'redraft', 'keeper', 'dynasty', 'guillotine', ...BESTBALL_VARIANTS])

export function checklistFormat(league: FormatFields): ChecklistFormat | null {
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return null
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  const variant = String(league.leagueVariant ?? '').trim().toLowerCase()
  if (!COVERED_TYPES.has(type) || !COVERED_VARIANTS.has(variant)) return null
  // The same tests the engines use: nativeGuillotineState (lib/league/nativeFormatPatch.ts), lineupSetsItself.
  if (league.guillotineMode === true || type === 'guillotine' || variant === 'guillotine') return 'guillotine'
  if (lineupSetsItself(league)) return 'best_ball'
  if (league.isDynasty === true || type === 'dynasty' || variant === 'dynasty') return 'dynasty'
  if (type === 'keeper' || variant === 'keeper') return 'keeper'
  return 'redraft'
}

export function isPlainRedraft(league: FormatFields): boolean {
  return checklistFormat(league) === 'redraft'
}

/**
 * A tied chop held for the commissioner this season (lib/guillotine/commissionerTiebreak.ts): one that is
 * still `waiting` — not decided, and inside its 12-hour window. An expired one has already fallen through to
 * the league's next tiebreak rule, so there is nothing left for the commissioner to do.
 */
export function waitingChopTiebreak(settings: unknown, season: number, now: Date): { week: number; deadline: Date } | null {
  const all = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COMMISSIONER_TIEBREAKS_KEY] : null
  if (!all || typeof all !== 'object' || Array.isArray(all)) return null
  let found: { week: number; deadline: Date } | null = null
  for (const key of Object.keys(all)) {
    const [s, w] = key.split(':')
    const week = Number(w)
    if (s !== String(season) || !Number.isInteger(week)) continue
    const entry = readCommissionerTiebreak(settings, key)
    if (tiebreakState(entry, now) !== 'waiting') continue
    if (!found || week > found.week) found = { week, deadline: decisionDeadline(entry!) }
  }
  return found
}

export type WeeklyChecklistView =
  | { applies: false; reason: 'not_redraft' | 'no_season' | 'not_in_season' }
  | { applies: true; week: number; format: ChecklistFormat; items: ChecklistItem[] }

export async function readWeeklyChecklist(leagueId: string, now = new Date()): Promise<WeeklyChecklistView | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      platform: true, leagueType: true, leagueVariant: true, isDynasty: true, bestBallMode: true, guillotineMode: true,
      sport: true, settings: true, tradeDeadlineWeek: true,
    },
  })
  if (!league) return null
  // A zombie week runs on the zombie engine's own tables, not the redraft season this checklist reads below.
  if (resolveWriteAuthority(league.platform) === 'NATIVE' && String(league.leagueVariant ?? '').trim().toLowerCase() === ZOMBIE_VARIANT) {
    return readZombieChecklist(leagueId)
  }
  const format = checklistFormat(league)
  // `not_redraft` is kept as the wire value: it means "a format this checklist does not cover".
  if (!format) return { applies: false, reason: 'not_redraft' }

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, status: true, currentWeek: true, totalWeeks: true, playoffStartWeek: true },
  })
  if (!season) return { applies: false, reason: 'no_season' }
  if (!RUNNING_SEASON.has(String(season.status).toLowerCase()) || season.currentWeek < 1) return { applies: false, reason: 'not_in_season' }

  const week = season.currentWeek
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const [lastWeekMatchups, pendingClaims, processedClaimsLast7Days, rosters, tradesAwaitingReview, teams] = await Promise.all([
    week > 1
      ? prisma.redraftMatchup.findMany({ where: { seasonId: season.id, week: week - 1 }, select: { status: true } })
      : Promise.resolve([] as Array<{ status: string }>),
    prisma.redraftWaiverClaim.findMany({ where: { seasonId: season.id, status: 'pending' }, select: { submittedAt: true } }),
    prisma.redraftWaiverClaim.count({ where: { seasonId: season.id, status: { not: 'pending' }, processedAt: { gte: weekAgo } } }),
    prisma.redraftRoster.findMany({
      where: { seasonId: season.id },
      select: {
        id: true, teamName: true, ownerName: true, isEliminated: true,
        // Slot types are position codes (QB, RB, FLX…) in redraft, so starters are "not a reserve slot".
        players: { where: { droppedAt: null }, select: { playerName: true, slotType: true, injuryStatus: true, byeWeek: true } },
      },
    }),
    // Accepted by both sides, held for the commissioner. A league-vote trade waits on the league, not on you.
    prisma.redraftTradeProposal.count({
      where: { seasonId: season.id, status: 'pending', acceptedAt: { not: null }, vetoMode: 'commissioner' },
    }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, teamName: true } }),
  ])

  // The same layout the scoring engine and the lineup validator size a lineup by.
  const required = [...resolveRedraftRosterConfig(String(league.sport ?? 'NFL'), league.settings).starterCapacities.values()].reduce((a, b) => a + b, 0)
  // A team that is out — chopped in guillotine, knocked out of the playoffs — sets no lineup.
  const lineups = rosters.filter((r) => r.isEliminated !== true).map((r) => {
    const starters = r.players.filter((p) => isStarterSlot(p.slotType))
    return {
      teamName: r.teamName || r.ownerName || 'Unnamed team',
      required,
      filled: starters.length,
      unavailable: starters.filter((p) => isUnavailable(p, week)).map((p) => p.playerName),
    }
  })

  // Guillotine: who was chopped after last week (the chop audit's own rows, found the way it writes them),
  // and any tie held for the commissioner.
  let lastWeekChopped: string[] = []
  let chopTiebreak: { week: number; deadline: Date } | null = null
  if (format === 'guillotine') {
    chopTiebreak = waitingChopTiebreak(league.settings, season.season, now)
    const guillotineSeasonId = week > 1 ? await findGuillotineSeasonId(leagueId, season.season) : null
    if (guillotineSeasonId) {
      const chopped = await prisma.guillotineElimination.findMany({
        where: { seasonId: guillotineSeasonId, scoringPeriod: week - 1 },
        select: { eliminatedTeamName: true },
      })
      lastWeekChopped = chopped.map((c) => c.eliminatedTeamName || 'Unnamed team')
    }
  }

  return {
    applies: true,
    week,
    format,
    items: buildWeeklyChecklist(
      {
        leagueId,
        week,
        totalWeeks: season.totalWeeks,
        playoffStartWeek: season.playoffStartWeek,
        lastWeekMatchups,
        pendingClaims,
        processedClaimsLast7Days,
        lineups,
        tradesAwaitingReview,
        tradeDeadlineWeek: league.tradeDeadlineWeek ?? null,
        dues: readDues(league.settings, teams, season.season),
        format,
        lineupsSetThemselves: format === 'best_ball' || lineupSetsItself(league),
        lastWeekChopped,
        chopTiebreak,
      },
      now,
    ),
  }
}

const ZOMBIE_VARIANT = 'zombie'

/** The zombie league's week: the four states in which its engine waits for a person (./zombieWeeklyChecklist.ts). */
async function readZombieChecklist(leagueId: string): Promise<WeeklyChecklistView> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true, status: true, currentWeek: true, correctionHoldFromWeek: true } })
  if (!z) return { applies: false, reason: 'no_season' }
  if (z.currentWeek < 1) return { applies: false, reason: 'not_in_season' }
  const [hold, whisperer] = await Promise.all([
    readSettlementHold(z.id),
    prisma.zombieRoleWorkflow.findFirst({ where: { zombieLeagueId: z.id, kind: 'initial_offer', status: 'review_required' }, select: { id: true } }),
  ])
  return {
    applies: true,
    week: z.currentWeek,
    format: 'zombie',
    items: buildZombieWeeklyChecklist({
      leagueId,
      week: z.currentWeek,
      paused: z.status === 'paused',
      hold: hold ? { week: hold.week, reasonText: hold.reason.text } : null,
      correctionFromWeek: z.correctionHoldFromWeek,
      whispererReviewNeeded: Boolean(whisperer),
    }),
  }
}

/**
 * Unpaid teams by the SAME rule the action queue uses (lib/commissioner-workspace/inboxTasks.ts): a
 * team is paid when its entry says `paid`, or lists this season in `paidSeasons`. Null when the
 * league does not track dues.
 */
export function readDues(settings: unknown, teams: Array<{ id: string; teamName: string | null }>, season: number): { unpaid: string[]; total: number } | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const dues = s.dues_tracker && typeof s.dues_tracker === 'object' ? (s.dues_tracker as Record<string, unknown>) : null
  if (!dues || dues.enabled !== true || !teams.length) return null
  const entries = new Map(
    (Array.isArray(dues.entries) ? dues.entries : []).map((e) => {
      const r = e && typeof e === 'object' ? (e as Record<string, unknown>) : {}
      return [String(r.teamId), r] as const
    }),
  )
  const unpaid = teams.filter((t) => {
    const e = entries.get(t.id)
    return !(e && (e.paid === true || (Array.isArray(e.paidSeasons) && e.paidSeasons.map(Number).includes(season))))
  })
  return { unpaid: unpaid.map((t) => t.teamName ?? 'Unnamed team'), total: teams.length }
}
