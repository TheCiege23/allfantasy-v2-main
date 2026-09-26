import 'server-only'
import { prisma } from '@/lib/prisma'
import { computeNextWaiverRunAtUtc } from '@/lib/waiver-wire/next-waiver-run'
import { formatWaiverOutcomeLabel, outcomeCodeFromMetadata } from '@/lib/waiver-wire/waiver-outcome-labels'

/**
 * Waiver Oversight — the section added to the Commissioner Hub in the 2026-09-13
 * handoff: FAAB left per manager, and what the last waiver run did.
 *
 * 🛑 THE HANDOFF'S "RE-RUN N FAILED CLAIMS" HAS NO HONEST TARGET, SO IT IS NOT BUILT.
 * `processWaiverClaimsForLeague` records no system failure: every `failed` claim
 * failed on a RULE — short on FAAB, roster full, player already taken, a Survivor
 * idol freeze, an eliminated roster, a minimum bid. Re-queueing those would
 * re-litigate settled claims after the fact, and for "player taken" it would hand a
 * player to a team that lost him fairly. The design's premise ("a sync issue, safe to
 * re-run") describes a failure mode this engine does not produce.
 *
 * The failure it DOES produce is a run that never finished: an exception aborts the
 * loop, the WaiverRun is left at `running`, and the claims it had not reached stay
 * `pending`. That is surfaced below as `stuck`, and the existing manual run action on
 * `/api/commissioner/leagues/[leagueId]/waivers` already processes exactly those
 * pending claims — so no new route and no engine change.
 *
 * ⚠ IMPORTED LEAGUES HAVE NOTHING HERE. Sleeper, ESPN and Yahoo run their own
 * waivers; bids and outcomes are never ingested. The section says so rather than
 * drawing an empty budget table that reads like "nobody has spent anything".
 */

export type WaiverTone = 'good' | 'warn' | 'bad'

export type WaiverBudgetRow = {
  rosterId: string
  handle: string
  initials: string
  spent: number
  remaining: number
  pct: number
  tone: WaiverTone
}

export type WaiverRunResult = 'won' | 'outbid' | 'short' | 'blocked' | 'not_awarded'

export type WaiverRunRow = {
  id: string
  player: string
  manager: string
  bid: number | null
  result: WaiverRunResult
  label: string
}

export type WaiverOversight =
  | { available: false; reason: string }
  | {
      available: true
      leagueId: string
      waiverTypeLabel: string
      faabBudget: number | null
      budgets: WaiverBudgetRow[]
      /** Why the budget table is absent, when it is. */
      budgetsReason: string | null
      /** "Tue 3 AM ET", or null when no schedule is configured. */
      nextRun: string | null
      lastRun: {
        at: string
        runType: string
        rows: WaiverRunRow[]
        /** Started more than 30 minutes ago and never completed. */
        stuck: boolean
      } | null
      pendingCount: number
      /**
       * The manual-run route gates on the primary commissioner only
       * (`assertCommissioner`), so a co-commissioner is never offered a button that
       * would 403. Widening that gate is its own change.
       */
      canRunNow: boolean
    }

/** Below this share of the season budget a manager is getting low; below the second, nearly out. */
export const FAAB_WARN_SHARE = 0.5
export const FAAB_BAD_SHARE = 0.2
const STUCK_AFTER_MS = 30 * 60 * 1000
const RUN_ROW_CAP = 12

const WAIVER_TYPE_LABEL: Record<string, string> = {
  faab: 'FAAB',
  rolling: 'Rolling priority',
  reverse_standings: 'Reverse standings priority',
  fcfs: 'First come, first served',
  standard: 'Standard priority',
  off: 'No waivers',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].replace(/^@/, '').slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function faabTone(remaining: number, budget: number): WaiverTone {
  if (budget <= 0) return 'bad'
  const share = remaining / budget
  return share >= FAAB_WARN_SHARE ? 'good' : share >= FAAB_BAD_SHARE ? 'warn' : 'bad'
}

/**
 * ⚠ "OUTBID" IS DERIVED, NOT STORED. The engine has no `lost_priority` writer in the
 * run loop; a claim beaten by an earlier claim in the same run fails as
 * `player_no_longer_available` with `competingRosterId` set. That extra key is what
 * separates "someone out-bid or out-prioritised you" from "he was already rostered".
 */
export function classifyResult(resultType: string, metadata: unknown, fallbackMessage: string | null): { result: WaiverRunResult; label: string } {
  if (resultType === 'awarded') return { result: 'won', label: 'Won' }
  const code = outcomeCodeFromMetadata(metadata)
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {}
  if (code === 'lost_priority' || code === 'lost_tiebreaker' || (code === 'player_no_longer_available' && typeof meta.competingRosterId === 'string')) {
    return { result: 'outbid', label: 'Outbid' }
  }
  if (code === 'insufficient_faab') return { result: 'short', label: 'Short on FAAB' }
  if (code === 'invalid_due_to_roster' || (code ?? '').startsWith('blocked_')) {
    return { result: 'blocked', label: formatWaiverOutcomeLabel(code, fallbackMessage) }
  }
  return { result: 'not_awarded', label: formatWaiverOutcomeLabel(code, fallbackMessage) }
}

function formatRunSlot(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(d)
  return `${parts.replace(':00', '')} ET`
}

export async function getCommissionerWaiverOversight(input: {
  leagueId: string
  platform: string
  role: 'commissioner' | 'co_commissioner'
  now?: Date
}): Promise<WaiverOversight> {
  const { leagueId, role } = input
  const now = input.now ?? new Date()
  const platform = String(input.platform ?? '').toLowerCase()

  const [settings, lastRun, pendingCount] = await Promise.all([
    prisma.leagueWaiverSettings.findUnique({
      where: { leagueId },
      select: {
        waiverType: true,
        faabBudget: true,
        processingDayOfWeek: true,
        processingTimeUtc: true,
        processingDays: true,
      },
    }),
    prisma.waiverRun.findFirst({
      where: { leagueId },
      orderBy: { runAt: 'desc' },
      select: {
        id: true,
        runAt: true,
        runType: true,
        status: true,
        results: {
          orderBy: { createdAt: 'asc' },
          take: RUN_ROW_CAP,
          select: {
            id: true,
            rosterId: true,
            addPlayerId: true,
            resultType: true,
            metadata: true,
            claim: { select: { faabBid: true, resultMessage: true } },
          },
        },
      },
    }),
    prisma.waiverClaim.count({ where: { leagueId, status: 'pending' } }),
  ])

  if (!settings && !lastRun && pendingCount === 0) {
    const imported = platform && platform !== 'manual' && platform !== 'allfantasy'
    return {
      available: false,
      reason: imported
        ? `This league's waivers run on ${platform.charAt(0).toUpperCase()}${platform.slice(1)}. Bids and claim results aren't shared with AllFantasy, so there is nothing to oversee here — manage them on the platform.`
        : 'No waiver settings or runs yet. Once the first run processes, budgets and results appear here.',
    }
  }

  const waiverType = String(settings?.waiverType ?? '').toLowerCase()
  const faabBudget = settings?.faabBudget ?? null

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, faabRemaining: true },
  })

  // ⚠ Names come from the league's own team rows, then an app display name or handle — never an email.
  const [teams, users] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, ownerName: true, teamName: true },
    }),
    prisma.appUser.findMany({
      where: { id: { in: rosters.map((r) => r.platformUserId).filter(Boolean) } },
      select: { id: true, displayName: true, username: true },
    }),
  ])
  const teamName = new Map(teams.map((t) => [t.externalId, t.ownerName?.trim() || t.teamName?.trim() || '']))
  const userName = new Map(users.map((u) => [u.id, u.displayName?.trim() || (u.username ? `@${u.username}` : '')]))
  const handleByRoster = new Map(
    rosters.map((r) => [r.id, teamName.get(r.platformUserId) || userName.get(r.platformUserId) || 'A manager']),
  )

  let budgets: WaiverBudgetRow[] = []
  let budgetsReason: string | null = null
  if (waiverType !== 'faab') {
    budgetsReason = 'This league does not use FAAB, so there are no budgets to track.'
  } else if (faabBudget == null || faabBudget <= 0) {
    budgetsReason = 'No season FAAB budget is set for this league.'
  } else {
    budgets = rosters
      .filter((r) => typeof r.faabRemaining === 'number')
      .map((r) => {
        const remaining = Math.max(0, r.faabRemaining as number)
        const handle = handleByRoster.get(r.id) ?? 'A manager'
        return {
          rosterId: r.id,
          handle,
          initials: initialsOf(handle),
          spent: Math.max(0, faabBudget - remaining),
          remaining,
          pct: Math.max(0, Math.min(100, Math.round((remaining / faabBudget) * 100))),
          tone: faabTone(remaining, faabBudget),
        }
      })
      .sort((a, b) => b.remaining - a.remaining)
    if (budgets.length === 0) budgetsReason = 'No roster has a FAAB balance recorded yet.'
  }

  let runOut: Extract<WaiverOversight, { available: true }>['lastRun'] = null
  if (lastRun) {
    const playerIds = [...new Set(lastRun.results.map((r) => r.addPlayerId))]
    const players = playerIds.length
      ? await prisma.sportsPlayer.findMany({
          where: { OR: [{ id: { in: playerIds } }, { externalId: { in: playerIds } }] },
          select: { id: true, externalId: true, name: true, position: true },
        })
      : []
    const playerName = new Map<string, string>()
    for (const p of players) {
      const label = p.position ? `${p.name} (${p.position})` : p.name
      playerName.set(p.id, label)
      if (!playerName.has(p.externalId)) playerName.set(p.externalId, label)
    }

    runOut = {
      at: lastRun.runAt.toISOString(),
      runType: lastRun.runType,
      stuck: lastRun.status === 'running' && now.getTime() - lastRun.runAt.getTime() > STUCK_AFTER_MS,
      rows: lastRun.results.map((r) => {
        const { result, label } = classifyResult(r.resultType, r.metadata, r.claim?.resultMessage ?? null)
        return {
          id: r.id,
          player: playerName.get(r.addPlayerId) ?? 'Unrecognised player',
          manager: handleByRoster.get(r.rosterId) ?? 'A manager',
          bid: r.claim?.faabBid ?? null,
          result,
          label,
        }
      }),
    }
  }

  const next = settings
    ? computeNextWaiverRunAtUtc(now, {
        processingDayOfWeek: settings.processingDayOfWeek,
        processingTimeUtc: settings.processingTimeUtc,
        processingDays: settings.processingDays,
      })
    : null

  return {
    available: true,
    leagueId,
    waiverTypeLabel: WAIVER_TYPE_LABEL[waiverType] ?? (waiverType || 'Waivers'),
    faabBudget,
    budgets,
    budgetsReason,
    nextRun: next ? formatRunSlot(next) : null,
    lastRun: runOut,
    pendingCount,
    canRunNow: role === 'commissioner',
  }
}
