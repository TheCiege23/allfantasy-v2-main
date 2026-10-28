/**
 * The trade deadline, measured against the SERVER'S week — one rule for every trade entry point,
 * in both trade engines (the AF league engine and the redraft proposal path), for every sport.
 *
 * 🛑 THE DEADLINE WAS EFFECTIVELY NOT ENFORCED. `isPastTradeDeadline(league, currentWeek)` returns
 * false whenever `currentWeek` is null, and the callers supplied it like this (audit, 2026-10):
 *   - the Trade Center POST (`app/api/leagues/[leagueId]/trades/handler.ts`) never passed one, so
 *     every proposal through it skipped the deadline;
 *   - the counter route passed `body.currentWeek` — a number the CLIENT chose, so a counter past
 *     the deadline only had to send `1`;
 *   - Chimmy passed `settings.currentWeek`, a field nothing maintains;
 *   - accept, commissioner approval and the scheduled-trade sweep never looked at the deadline;
 *   - the redraft proposal path checked it only for NFL redraft, against the stored season week.
 * Every caller now asks this module instead, and nothing a request carries can move the week.
 *
 * WHICH WEEK. The league's latest `RedraftSeason`, read through `resolveEffectiveRedraftWeek` — the
 * same resolver the season, roster and live-scoring reads use. A native season keeps its stored
 * week (the roller advances it once every matchup is final); an imported season, whose stored week
 * nothing maintains, takes its week from the committed schedule. That resolver covers the weekly
 * sports by their feed week and NBA / NHL / MLB by their date-windowed weeks anchored on the
 * season opener (`lib/season-week/seasonWeekService.ts`).
 *
 * ⚠ THE DEADLINE BINDS THE IN-SEASON WINDOW ONLY. A deadline is "no trades after week N of THIS
 * season". Once the season is complete — or the next one has not started — last season's week 17
 * is not evidence that week 11's deadline has passed, and reading it that way would freeze a
 * dynasty league's whole offseason. So no deadline applies when the league's lifecycle is outside
 * the season (`offseason`, `completed`, `renewal_pending`, `setup`, `pre_draft`, `drafting`,
 * `archived`), or when its latest season is still `setup` or already `complete`. Whether a league
 * may trade in the offseason at all is the lifecycle gate's decision (`trade_act`), not this one's.
 *
 * ⚠ NO SEASON ROW MEANS NO MEASURABLE WEEK, AND THEN NO DEADLINE — the same answer as before this
 * module, and reported as `reason: 'no_season'` rather than hidden. Guessing a week here would be
 * worse: a wrong week refuses legal trades or admits illegal ones, and both look correct.
 *
 * ACCEPTED BEFORE THE DEADLINE STILL PROCESSES. Sleeper and ESPN both let a trade that was ACCEPTED
 * before the deadline finish its review period (commissioner review, league vote, processing delay)
 * after it. So the deadline is checked when a trade is proposed and when it is accepted; execution
 * after a review period does not re-check it, because the acceptance already passed the gate. A
 * trade forced through with no acceptance at all (a commissioner processing a still-pending offer)
 * is checked at execution like a proposal.
 *
 * A CLOSE TIME AS WELL AS A WEEK. A commissioner may also set the moment trades close
 * (`League.settings.trade_deadline_at`, ./tradeDeadlineTime.ts). Trades close at whichever comes
 * first, and the close time binds the in-season window only, exactly like the week.
 *
 * PICK TRADES MAY HAVE THEIR OWN DEADLINE. A dynasty league can keep trades made only of draft picks
 * open after the trade deadline, or close them at another week (./pickTradeDeadline.ts). A caller that
 * knows the trade passes its items (or `picksOnly`), and the verdict then says which rule it read
 * (`scope`). A caller that passes nothing reads the trade deadline, as before.
 */

import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { resolveEffectiveRedraftWeek } from '@/lib/season-week/effectiveRedraftWeek'
import { REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import { deadlinePassed, deadlinePassedMessage, readDeadlineAt } from './tradeDeadlineTime'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { tradeDeadlineCountdown, type TradeDeadlineCountdown } from './tradeDeadlineCountdown'
import { isPicksOnlyTrade, pickTradeDeadlineFor, pickTradeDeadlinePassed, pickTradeDeadlinePassedMessage, type PickTradeDeadline, type PickTradeDeadlineView } from './pickTradeDeadline'

export type { PickTradeDeadlineView }

export type TradeDeadlineLeague = {
  id: string
  lifecycleState?: string | null
  /** `League.platform` — decides whether the stored week or the schedule's week is read. */
  platform?: string | null
  /** `League.settings` — carries the close time. Absent: the week alone decides. */
  settings?: unknown
  /** `League.timezone` — only for naming the close time in a refusal. */
  timezone?: string | null
  /** With `isDynasty`, decides whether the league can give pick trades their own deadline. */
  leagueType?: string | null
  isDynasty?: boolean | null
}

/** What is being traded, when the caller knows. Absent: the trade deadline applies. */
export type TradeDeadlineScope = {
  items?: ReadonlyArray<{ itemType?: string | null }> | null
  /** The caller trades nothing but picks (the draft room). */
  picksOnly?: boolean
}

export type ServerTradeWeek =
  | { inSeason: true; week: number; seasonId: string }
  | {
      inSeason: false
      week: null
      reason: 'lifecycle_not_in_season' | 'season_not_started' | 'season_complete' | 'no_season'
    }

export type TradeDeadlineDeps = {
  prisma?: Pick<PrismaClient, 'redraftSeason'>
  /** Injectable for tests. Production reads `resolveEffectiveRedraftWeek`. */
  resolveWeek?: (season: { id: string; currentWeek: number | null }, platform: string | null | undefined) => Promise<number>
  now?: () => Date
}

/** Lifecycle states that are not a season in progress. `post_draft` IS one: a native league lives
 * there for its whole first season (see `leagueLifecycleService`), so it defers to the season row. */
const NOT_IN_SEASON_LIFECYCLE: ReadonlySet<string> = new Set([
  'setup',
  'pre_draft',
  'drafting',
  'completed',
  'offseason',
  'renewal_pending',
  'archived',
])

export async function resolveServerTradeWeek(
  league: TradeDeadlineLeague,
  deps: TradeDeadlineDeps = {},
): Promise<ServerTradeWeek> {
  const lifecycle = String(league.lifecycleState ?? '').trim().toLowerCase()
  if (NOT_IN_SEASON_LIFECYCLE.has(lifecycle)) return { inSeason: false, week: null, reason: 'lifecycle_not_in_season' }

  const db = deps.prisma ?? defaultPrisma
  const season = await db.redraftSeason.findFirst({
    where: { leagueId: league.id },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, currentWeek: true, status: true },
  })
  if (!season) return { inSeason: false, week: null, reason: 'no_season' }

  const status = String(season.status ?? '').trim().toLowerCase()
  if (status === REDRAFT_SEASON_STATUS.SETUP) return { inSeason: false, week: null, reason: 'season_not_started' }
  if (status === REDRAFT_SEASON_STATUS.COMPLETE) return { inSeason: false, week: null, reason: 'season_complete' }

  const week = await (deps.resolveWeek ?? resolveEffectiveRedraftWeek)(season, league.platform)
  return { inSeason: true, week, seasonId: season.id }
}

/** A configured deadline week, or null when none is set. Zero and negatives mean "no deadline". */
export function normalizeDeadlineWeek(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  const week = Math.floor(n)
  return week > 0 ? week : null
}

export type TradeDeadlineVerdict = {
  passed: boolean
  /** Which limit closed trades: the week, the close time, or neither. */
  by: 'week' | 'time' | null
  deadlineWeek: number | null
  deadlineAt: Date | null
  timezone: string | null
  /** Null when no deadline is configured: nothing was read, because nothing needed to be. */
  window: ServerTradeWeek | null
  /** `picks`: a picks-only trade in a league whose pick trades have their own deadline (./pickTradeDeadline.ts). */
  scope: 'trades' | 'picks'
}

function verdictFor(
  league: TradeDeadlineLeague,
  deadlineWeek: number | null,
  window: ServerTradeWeek | null,
  deps: TradeDeadlineDeps,
): TradeDeadlineVerdict {
  const deadlineAt = readDeadlineAt(league.settings)
  const { passed, by } = window
    ? deadlinePassed({ inSeason: window.inSeason, currentWeek: window.week, deadlineWeek, deadlineAt, now: (deps.now ?? (() => new Date()))() })
    : { passed: false, by: null }
  return { passed, by, deadlineWeek, deadlineAt, timezone: league.timezone ?? null, window, scope: 'trades' }
}

/** The pick rule this trade is held to, or null when the trade deadline is. */
function pickRuleFor(league: TradeDeadlineLeague, scope: TradeDeadlineScope): Exclude<PickTradeDeadline, { mode: 'same' }> | null {
  const picksOnly = scope.picksOnly ?? (scope.items ? isPicksOnlyTrade(scope.items) : false)
  if (!picksOnly) return null
  const rule = pickTradeDeadlineFor(league)
  return rule.mode === 'same' ? null : rule
}

async function pickVerdict(
  league: TradeDeadlineLeague,
  rule: Exclude<PickTradeDeadline, { mode: 'same' }>,
  deps: TradeDeadlineDeps,
): Promise<TradeDeadlineVerdict> {
  const base = { deadlineAt: null, timezone: league.timezone ?? null, scope: 'picks' as const }
  if (rule.mode === 'open') return { ...base, passed: false, by: null, deadlineWeek: null, window: null }
  const window = await resolveServerTradeWeek(league, deps)
  const passed = pickTradeDeadlinePassed(rule, { inSeason: window.inSeason, currentWeek: window.week })
  return { ...base, passed, by: passed ? 'week' : null, deadlineWeek: rule.week, window }
}

/**
 * Has the deadline passed for this league right now? The deadline week itself is still open —
 * "deadline week 11" refuses from week 12 — matching `isPastTradeDeadline` and the NFL runtime. A close
 * time in `league.settings` closes trades from that moment, whichever comes first.
 */
export async function resolveTradeDeadlineStatus(
  league: TradeDeadlineLeague,
  deadlineWeek: unknown,
  deps: TradeDeadlineDeps = {},
  scope: TradeDeadlineScope = {},
): Promise<TradeDeadlineVerdict> {
  const pickRule = pickRuleFor(league, scope)
  if (pickRule) return pickVerdict(league, pickRule, deps)
  const deadline = normalizeDeadlineWeek(deadlineWeek)
  if (deadline == null && !readDeadlineAt(league.settings)) return verdictFor(league, null, null, deps)
  return verdictFor(league, deadline, await resolveServerTradeWeek(league, deps), deps)
}

/**
 * The week a caller of `isPastTradeDeadline` / `validateTradeAssets` should pass: the server's
 * in-season week, or null when no deadline applies (none configured, or not in season). A non-null week
 * is what lets `isPastTradeDeadline` apply the close time, so it is returned when only a time is set.
 */
export async function serverWeekForTradeDeadline(
  league: TradeDeadlineLeague,
  deadlineWeek: unknown,
  deps: TradeDeadlineDeps = {},
): Promise<number | null> {
  const verdict = await resolveTradeDeadlineStatus(league, deadlineWeek, deps)
  return verdict.window?.inSeason ? verdict.window.week : null
}

/**
 * The deadline for a redraft-path trade (`/api/redraft/trade-proposals`, `/api/redraft/trade-votes`),
 * against the server's week. The deadline itself is `League.tradeDeadlineWeek` — the value the trade
 * runtimes read through `resolveCanonicalLeagueRules`.
 *
 * `alwaysResolveWeek` reads the window even when no deadline is set, for a caller that needs the
 * server's week for something else (the lineup lock in proposal validation). `window` is then null
 * only when the league does not exist.
 */
export async function evaluateRedraftTradeDeadline(
  leagueId: string,
  deps: TradeDeadlineDeps & { leagueDb?: Pick<PrismaClient, 'league'> } = {},
  opts: { alwaysResolveWeek?: boolean } = {},
): Promise<TradeDeadlineVerdict> {
  const row = await (deps.leagueDb ?? defaultPrisma).league.findUnique({
    where: { id: leagueId },
    select: { id: true, tradeDeadlineWeek: true, lifecycleState: true, platform: true, settings: true, timezone: true },
  })
  if (!row) return verdictFor({ id: leagueId }, null, null, deps)
  const league = { ...row, id: leagueId }
  if (!opts.alwaysResolveWeek) return resolveTradeDeadlineStatus(league, row.tradeDeadlineWeek, deps)
  return verdictFor(league, normalizeDeadlineWeek(row.tradeDeadlineWeek), await resolveServerTradeWeek(league, deps), deps)
}

/** The refusal text, naming whichever limit closed trades. */
export function tradeDeadlinePassedMessage(
  verdict: Pick<TradeDeadlineVerdict, 'by' | 'deadlineWeek' | 'deadlineAt' | 'timezone'> & { scope?: TradeDeadlineVerdict['scope'] },
): string {
  if (verdict.scope === 'picks') return pickTradeDeadlinePassedMessage(verdict.deadlineWeek ?? 0)
  return deadlinePassedMessage(verdict)
}

/**
 * The deadline for a league by id, read exactly as the AF league engine reads it at acceptance —
 * `resolveLeagueTradeSettings(league).tradeDeadlineWeek`, which prefers the commissioner settings'
 * week over the column. For a path that has only a league id and must refuse what the engine would
 * refuse: the draft-room pick trades and the scheduled deadline sweep.
 */
export async function evaluateLeagueTradeDeadline(
  leagueId: string,
  deps: TradeDeadlineDeps & { leagueDb?: Pick<PrismaClient, 'league'> } = {},
  scope: TradeDeadlineScope = {},
): Promise<TradeDeadlineVerdict> {
  const league = await (deps.leagueDb ?? defaultPrisma).league.findUnique({ where: { id: leagueId } })
  if (!league) return verdictFor({ id: leagueId }, null, null, deps)
  return resolveTradeDeadlineStatus(league, resolveLeagueTradeSettings(league).tradeDeadlineWeek, deps, scope)
}

export async function loadPickTradeDeadlineView(
  leagueId: string,
  deps: TradeDeadlineDeps & { leagueDb?: Pick<PrismaClient, 'league'> } = {},
): Promise<PickTradeDeadlineView | null> {
  const league = await (deps.leagueDb ?? defaultPrisma).league.findUnique({ where: { id: leagueId } })
  if (!league) return null
  const rule = pickTradeDeadlineFor(league)
  if (rule.mode === 'same') return null
  const verdict = await pickVerdict(league, rule, deps)
  return { mode: rule.mode, week: rule.mode === 'week' ? rule.week : null, passed: verdict.passed }
}

/**
 * The countdown a trades screen shows. Reads the window even when only a week is set, so a week-only
 * deadline can say how many weeks are left. Null when the league does not exist.
 */
export async function loadTradeDeadlineCountdown(
  leagueId: string,
  deps: TradeDeadlineDeps & { leagueDb?: Pick<PrismaClient, 'league'> } = {},
): Promise<TradeDeadlineCountdown | null> {
  const league = await (deps.leagueDb ?? defaultPrisma).league.findUnique({ where: { id: leagueId } })
  if (!league) return null
  const verdict = await resolveTradeDeadlineStatus(league, resolveLeagueTradeSettings(league).tradeDeadlineWeek, deps)
  return tradeDeadlineCountdown(verdict, (deps.now ?? (() => new Date()))())
}

/** The refusal text when the league's deadline has passed, or null while trades are open. */
export async function tradeDeadlineRefusal(
  leagueId: string,
  deps: TradeDeadlineDeps & { leagueDb?: Pick<PrismaClient, 'league'> } = {},
  scope: TradeDeadlineScope = {},
): Promise<string | null> {
  const verdict = await evaluateLeagueTradeDeadline(leagueId, deps, scope)
  return verdict.passed ? tradeDeadlinePassedMessage(verdict) : null
}
