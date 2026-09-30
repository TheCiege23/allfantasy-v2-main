import 'server-only'

import type { LeagueSport, Prisma } from '@prisma/client'

import { getWaiverSportSections, type WaiverSportSection } from '@/lib/core-app/waiversBoard'
import { isCategoryAllowedForLeague } from '@/lib/notifications/leagueOverrides'
import { prisma } from '@/lib/prisma'
import type { ScheduledGame } from './lineupCheck'
import {
  categoryOn,
  CLAIM_TTL_MS,
  PROACTIVE_CATEGORY,
  proactiveDeliveryDeps,
  rotation,
  type ProactiveAudienceLeague,
  type ProactiveDeliveryDeps,
} from './proactiveDelivery'
import {
  combineSportPicks,
  easternClock,
  recentSportWaiverClaimKeys,
  renderSportWaiverCheck,
  selectSportWaiverPicks,
  sportAlertSeason,
  sportPickSignature,
  sportWaiverCheckDedupeKey,
  sportWaiverWindow,
  type SportWaiverPick,
  type SportWaiverWindow,
} from './sportWaiverCheck'
import { SPORT_WAIVER_ALERT_RULES, type SportWaiverAlertRule } from './waiverAlertRules'
import { WAIVER_CHECK_ALERT_TYPE, waiverCheckMutedBy } from './waiverCheck'

/**
 * Runs Chimmy's waiver check for every sport but the NFL (see `sportWaiverCheck.ts`; the rules are
 * `waiverAlertRules.ts`). Called by the alert sweep every 15 minutes; outside every sport's window it
 * reads one small schedule slice per enabled, in-season sport and returns.
 *
 * The NFL's Tuesday check (`runWaiverCheck.ts`) is untouched and separate: its own window, its own
 * weekly claim, its own message. This runner never reads the board's NFL rows.
 *
 * ── WHAT PROTECTS PEOPLE FROM BEING OVER-MESSAGED, ALL OF IT REUSED ─────────────────────────────
 *   - the `lineup_reminders` category switch and its per-league mutes (Notification settings);
 *   - Chimmy's alert controls — the Waivers class, the `waiver_check` type, a muted league — the
 *     SAME mute that silences the NFL message (`waiverCheckMutedBy`);
 *   - Chimmy's channel switches, and never SMS;
 *   - a claim CREATED by primary key before dispatch (`proactiveDelivery.ts`), here one per user per
 *     US Eastern day across every sport, so a user in three daily sports gets ONE message a day;
 *   - the repeat rule: a pick named in the last few days is not named again (the claim row carries
 *     the signatures of what it named).
 *
 * ⚠ `lib/notifications/fatigueBudget.ts` DOES NOT SEE THIS MESSAGE. The budget is enforced in the
 * outbox relay, and only for bulk marketing event types; the dispatcher this runner shares with the
 * NFL checks does not pass through the outbox. The per-day claim is this message's volume cap.
 */

export type SportWaiverCheckUserOutcome =
  | 'sent'
  | 'would_send'
  | 'no_picks'
  | 'repeat_only'
  | 'already_sent'
  | 'category_off'
  | 'muted'
  | 'no_profile'
  | 'no_leagues'
  | 'error'

/** One sport's state this run, reported whatever happens. */
export type SportWaiverSportState = SportWaiverWindow | 'disabled' | 'out_of_season'

export type SportAudienceLeague = ProactiveAudienceLeague & { sport: string }

export interface SportWaiverCheckDeps extends Omit<ProactiveDeliveryDeps, 'loadAudience' | 'claim'> {
  /** Games of one sport starting in [from, to). `regularOnly` reads `seasonType: 'regular'` rows only. */
  loadGames: (sport: string, from: Date, to: Date, regularOnly: boolean) => Promise<ScheduledGame[]>
  /** Users with a claimed team in a league of one of these sports AND that sport's season. */
  loadAudience: (
    scopes: ReadonlyArray<{ sport: string; season: number }>,
    onlyUserId: string | null,
  ) => Promise<Map<string, SportAudienceLeague[]>>
  sections: (userId: string) => Promise<WaiverSportSection[]>
  /** Atomically claim today's message for this user, recording what it names. False when taken. */
  claim: (key: string, expiresAt: Date, named: string[]) => Promise<boolean>
  /** Signatures named by these earlier claims (missing keys name nothing). */
  recentlyNamed: (keys: string[]) => Promise<Set<string>>
  rules: readonly SportWaiverAlertRule[]
}

export type SportWaiverCheckRun =
  | {
      ran: false
      reason: 'closed'
      day: string
      sports: Record<string, SportWaiverSportState>
    }
  | {
      ran: true
      dryRun: boolean
      day: string
      sports: Record<string, SportWaiverSportState>
      /** Sports this run messaged about (open, or forced in season). */
      openSports: string[]
      users: number
      outcomes: Partial<Record<SportWaiverCheckUserOutcome, number>>
      notReached: number
      /** Picks named across every message sent (or previewed). */
      picks: number
      previews: Array<{ userId: string; title: string; body: string }>
      errors: Array<{ userId: string; error: string }>
    }

const DEFAULT_BUDGET_MS = 90_000
const DAY_MS = 86_400_000

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

function namedOf(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const named = (data as { named?: unknown }).named
  return Array.isArray(named) ? named.filter((x): x is string => typeof x === 'string') : []
}

const defaultDeps: SportWaiverCheckDeps = {
  now: proactiveDeliveryDeps.now,
  loadSettings: proactiveDeliveryDeps.loadSettings,
  alreadySent: proactiveDeliveryDeps.alreadySent,
  dispatch: proactiveDeliveryDeps.dispatch,
  baseUrl: proactiveDeliveryDeps.baseUrl,
  rules: SPORT_WAIVER_ALERT_RULES,
  loadGames: async (sport, from, to, regularOnly) => {
    const rows = await prisma.sportsGame.findMany({
      where: { sport, startTime: { gte: from, lt: to }, ...(regularOnly ? { seasonType: 'regular' } : {}) },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    return rows.flatMap((r) => (r.startTime ? [{ homeTeam: r.homeTeam, awayTeam: r.awayTeam, startTime: r.startTime }] : []))
  },
  loadAudience: async (scopes, onlyUserId) => {
    const out = new Map<string, SportAudienceLeague[]>()
    if (scopes.length === 0) return out
    const rows = await prisma.leagueTeam.findMany({
      where: {
        claimedByUserId: onlyUserId ? onlyUserId : { not: null },
        league: { OR: scopes.map((s) => ({ sport: s.sport as LeagueSport, season: s.season })) },
      },
      select: {
        claimedByUserId: true,
        league: {
          select: {
            id: true,
            name: true,
            sport: true,
            leagueVariant: true,
            bestBallMode: true,
            platform: true,
            platformLeagueId: true,
            season: true,
          },
        },
      },
    })
    for (const r of rows) {
      if (!r.claimedByUserId) continue
      const list = out.get(r.claimedByUserId) ?? []
      if (!list.some((l) => l.id === r.league.id)) list.push({ ...r.league, sport: String(r.league.sport) })
      out.set(r.claimedByUserId, list)
    }
    return out
  },
  sections: getWaiverSportSections,
  claim: async (key, expiresAt, named) => {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: key, expiresAt, data: { claimedAt: new Date().toISOString(), named } as Prisma.InputJsonValue },
      })
      return true
    } catch (e) {
      if (prismaCode(e) === 'P2002') return false
      throw e
    }
  },
  recentlyNamed: async (keys) => {
    if (keys.length === 0) return new Set()
    const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { data: true } })
    return new Set(rows.flatMap((r) => namedOf(r.data)))
  },
}

/** Games that can decide a sport's window: today's Eastern day (daily) or the lookahead (weekly). */
function gamesSpan(rule: SportWaiverAlertRule, now: Date): { from: Date; to: Date; regularOnly: boolean } {
  if (rule.cadence.kind === 'daily') {
    // The Eastern day is at most 24h long and starts at most ~29h before the next UTC midnight; a
    // day either side covers it. `sportWaiverWindow` keeps only the games of the Eastern day.
    return { from: new Date(now.getTime() - DAY_MS), to: new Date(now.getTime() + DAY_MS), regularOnly: false }
  }
  const days = rule.season.kind === 'regular_season_games' ? rule.season.lookaheadDays : 7
  return { from: now, to: new Date(now.getTime() + days * DAY_MS), regularOnly: rule.season.kind === 'regular_season_games' }
}

export async function runSportWaiverCheck(
  opts: { dryRun?: boolean; force?: boolean; userId?: string | null; limit?: number; budgetMs?: number } = {},
  overrides: Partial<SportWaiverCheckDeps> = {},
): Promise<SportWaiverCheckRun> {
  const deps: SportWaiverCheckDeps = { ...defaultDeps, ...overrides }
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS
  const now = deps.now()
  const dryRun = Boolean(opts.dryRun)
  const day = easternClock(now).day

  /* Which sports are open. Disabled and out-of-season sports read nothing at all. */
  const sports: Record<string, SportWaiverSportState> = {}
  const open: Array<{ rule: SportWaiverAlertRule; season: number }> = []
  for (const rule of deps.rules) {
    if (!rule.enabled) {
      sports[rule.sport] = 'disabled'
      continue
    }
    const season = sportAlertSeason(rule, now)
    if (season == null) {
      sports[rule.sport] = 'out_of_season'
      continue
    }
    const span = gamesSpan(rule, now)
    const games = await deps.loadGames(rule.sport, span.from, span.to, span.regularOnly)
    const window = sportWaiverWindow(rule, { now, games })
    sports[rule.sport] = window
    // Force skips the clock, never the season: out of season there is no season to name leagues by.
    if (window === 'open' || opts.force) open.push({ rule, season })
  }
  if (open.length === 0) return { ran: false, reason: 'closed', day, sports }

  const audience = await deps.loadAudience(
    open.map((o) => ({ sport: o.rule.sport, season: o.season })),
    opts.userId ?? null,
  )
  const userIds = rotation([...audience.keys()].sort(), now).slice(0, opts.limit ?? 500)
  const dedupePrefix = sportWaiverCheckDedupeKey(day)
  // Widened to string: it is probed with a league's upper-cased sport, which is any string.
  const openSports = new Set<string>(open.map((o) => o.rule.sport))

  const outcomes: Partial<Record<SportWaiverCheckUserOutcome, number>> = {}
  const previews: Array<{ userId: string; title: string; body: string }> = []
  const errors: Array<{ userId: string; error: string }> = []
  const tally = (o: SportWaiverCheckUserOutcome) => (outcomes[o] = (outcomes[o] ?? 0) + 1)
  let picksNamed = 0
  const overBudget = () => Date.now() - startedAt >= budgetMs

  for (const userId of userIds) {
    if (overBudget()) break
    const key = `${dedupePrefix}:${userId}`
    try {
      if (await deps.alreadySent(key)) {
        tally('already_sent')
        continue
      }
      const settings = await deps.loadSettings(userId)
      if (!settings) {
        tally('no_profile')
        continue
      }
      if (!categoryOn(settings)) {
        tally('category_off')
        continue
      }
      if (waiverCheckMutedBy(settings.chimmy)) {
        tally('muted')
        continue
      }
      // This season's leagues of an open sport only — the sections read every claimed team.
      const allowedBySport = new Map<string, Set<string>>()
      for (const l of audience.get(userId) ?? []) {
        const sport = l.sport.toUpperCase()
        if (!openSports.has(sport)) continue
        if (!isCategoryAllowedForLeague(settings.notifications, PROACTIVE_CATEGORY, l.id)) continue
        if (waiverCheckMutedBy(settings.chimmy, l.id)) continue
        allowedBySport.set(sport, (allowedBySport.get(sport) ?? new Set()).add(l.id))
      }
      if (allowedBySport.size === 0) {
        tally('no_leagues')
        continue
      }

      const sections = await deps.sections(userId)
      const bySport: SportWaiverPick[][] = []
      for (const { rule } of open) {
        const allowed = allowedBySport.get(rule.sport)
        const section = sections.find((s) => s.sport === rule.sport)
        if (!allowed || !section) continue
        bySport.push(selectSportWaiverPicks(section, rule, allowed))
      }
      if (bySport.every((l) => l.length === 0)) {
        tally('no_picks')
        continue
      }
      const recent = await deps.recentlyNamed(recentSportWaiverClaimKeys(day, userId))
      const picks = combineSportPicks(bySport, recent)
      const message = renderSportWaiverCheck(picks, { baseUrl: deps.baseUrl() })
      if (!message) {
        tally('repeat_only')
        continue
      }
      if (dryRun) {
        tally('would_send')
        picksNamed += picks.length
        previews.push({ userId, title: message.title, body: message.body })
        continue
      }
      if (!(await deps.claim(key, new Date(now.getTime() + CLAIM_TTL_MS), picks.map(sportPickSignature)))) {
        tally('already_sent')
        continue
      }
      const channels = settings.chimmy?.channelPreferences
      await deps.dispatch({
        userIds: [userId],
        category: PROACTIVE_CATEGORY,
        productType: 'app',
        type: 'chimmy_waiver_check',
        title: message.title,
        body: message.body,
        actionHref: message.actionHref,
        actionLabel: 'Ask Chimmy',
        leagueId: picks.length === 1 ? picks[0]!.leagueId : null,
        severity: 'medium',
        meta: {
          chimmyAlert: true,
          class: 'waiver',
          alertType: WAIVER_CHECK_ALERT_TYPE,
          day,
          basis: 'per_game',
          sports: [...new Set(picks.map((p) => p.sport))],
          leagueIds: picks.map((p) => p.leagueId),
          picks: picks.length,
        },
        dedupePrefix,
        skipChannels: { sms: true, email: Boolean(channels?.disableEmail), push: Boolean(channels?.disablePush) },
        emailOverride: message.email,
      })
      picksNamed += picks.length
      tally('sent')
    } catch (e) {
      tally('error')
      errors.push({ userId, error: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160) })
    }
  }

  return {
    ran: true,
    dryRun,
    day,
    sports,
    openSports: open.map((o) => o.rule.sport),
    users: userIds.length,
    outcomes,
    notReached: userIds.length - Object.values(outcomes).reduce((a, b) => a + (b ?? 0), 0),
    picks: picksNamed,
    previews,
    errors: errors.slice(0, 10),
  }
}
