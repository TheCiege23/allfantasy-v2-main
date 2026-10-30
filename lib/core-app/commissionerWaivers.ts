import 'server-only'
import { prisma } from '@/lib/prisma'
import { ourIdOrSleeperIdWhere, playerRowKeys } from '@/lib/player-identity/externalIdNamespace'
import { computeNextWaiverRunAtUtc } from '@/lib/waiver-wire/next-waiver-run'
import { formatWaiverOutcomeLabel, outcomeCodeFromMetadata } from '@/lib/waiver-wire/waiver-outcome-labels'
import { commissionerWaiversMessages } from '@/lib/core-app/messages/commissionerWaivers'
import { messagesFor } from '@/lib/i18n/messages'
import { importedWaiverSettings } from './waiverRowMeta'

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

/** The waiver-type labels, in the reader's language (catalog `waiverType*`). */
function waiverTypeLabels(m: (typeof commissionerWaiversMessages)['en']): Record<string, string> {
  return {
    faab: m.waiverTypeFaab,
    rolling: m.waiverTypeRolling,
    reverse_standings: m.waiverTypeReverseStandings,
    fcfs: m.waiverTypeFcfs,
    standard: m.waiverTypeStandard,
    off: m.waiverTypeOff,
  }
}

/*
 * The shared outcome labels (`waiver-outcome-labels`) serve the waivers history, notifications and
 * exports in English. The hub's panel words the same codes in the reader's language here, so that
 * module's other callers are untouched. A code with no entry keeps the shared English label.
 */
const OUTCOME_LABEL_ES: Record<string, string> = {
  won: 'Concedida',
  lost_priority: 'Perdida: prioridad',
  lost_tiebreaker: 'Perdida: desempate',
  insufficient_faab: 'No concedida: FAAB',
  invalid_due_to_roster: 'Bloqueada: plantilla',
  player_no_longer_available: 'No concedida: jugador ya fichado',
  blocked_by_lineup_lock: 'Bloqueada: alineación cerrada',
  blocked_by_ir_taxi_devy_violation: 'Bloqueada: IR / taxi / devy',
  failed: 'No concedida',
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
export function classifyResult(
  resultType: string,
  metadata: unknown,
  fallbackMessage: string | null,
  language = 'en',
): { result: WaiverRunResult; label: string } {
  const m = messagesFor(commissionerWaiversMessages, language)
  // In Spanish a known code gets its own label; the claim's free-text message is English server prose.
  const outcome = (c: string | undefined) =>
    language === 'es' && c && OUTCOME_LABEL_ES[c] ? OUTCOME_LABEL_ES[c]! : formatWaiverOutcomeLabel(c, fallbackMessage)
  if (resultType === 'awarded') return { result: 'won', label: m.resultWon }
  const code = outcomeCodeFromMetadata(metadata)
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {}
  if (code === 'lost_priority' || code === 'lost_tiebreaker' || (code === 'player_no_longer_available' && typeof meta.competingRosterId === 'string')) {
    return { result: 'outbid', label: m.resultOutbid }
  }
  if (code === 'insufficient_faab') return { result: 'short', label: m.resultShort }
  if (code === 'invalid_due_to_roster' || (code ?? '').startsWith('blocked_')) {
    return { result: 'blocked', label: outcome(code) }
  }
  return { result: 'not_awarded', label: outcome(code) }
}

function formatRunSlot(iso: string, language = 'en'): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', {
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
  /** The reader's language for the panel's reasons, labels and run times; default English. */
  language?: string
}): Promise<WaiverOversight> {
  const { leagueId, role } = input
  const language = input.language ?? 'en'
  const m = messagesFor(commissionerWaiversMessages, language)
  const A_MANAGER = m.aManager
  const now = input.now ?? new Date()
  const platform = String(input.platform ?? '').toLowerCase()

  const [storedSettings, lastRun, pendingCount] = await Promise.all([
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

  /* A Fantrax row is AllFantasy's bootstrap defaults, never the league's rules (waiverRowMeta.ts). */
  const settings = importedWaiverSettings(storedSettings, platform)

  if (!settings && !lastRun && pendingCount === 0) {
    const imported = platform && platform !== 'manual' && platform !== 'allfantasy'
    return {
      available: false,
      reason: imported
        ? m.unavailableImported(`${platform.charAt(0).toUpperCase()}${platform.slice(1)}`)
        : m.unavailableNoRunsYet,
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
    rosters.map((r) => [r.id, teamName.get(r.platformUserId) || userName.get(r.platformUserId) || A_MANAGER]),
  )

  let budgets: WaiverBudgetRow[] = []
  let budgetsReason: string | null = null
  if (waiverType !== 'faab') {
    budgetsReason = m.budgetsNotFaab
  } else if (faabBudget == null || faabBudget <= 0) {
    budgetsReason = m.budgetsNoSeasonBudget
  } else {
    budgets = rosters
      .filter((r) => typeof r.faabRemaining === 'number')
      .map((r) => {
        const remaining = Math.max(0, r.faabRemaining as number)
        const handle = handleByRoster.get(r.id) ?? A_MANAGER
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
    if (budgets.length === 0) budgetsReason = m.budgetsNoBalances
  }

  let runOut: Extract<WaiverOversight, { available: true }>['lastRun'] = null
  if (lastRun) {
    const playerIds = [...new Set(lastRun.results.map((r) => r.addPlayerId))]
    const players = playerIds.length
      ? await prisma.sportsPlayer.findMany({
          /*
           * 🛑 A native league's player ids are Sleeper ids (its pools are seeded from Sleeper) or
           * our own row ids. This read was `id IN ids OR externalId IN ids`: a Sleeper id could only
           * ever match a Rolling Insights row for SOMEBODY ELSE there, because Sleeper's own rows
           * store `sleeper:<id>`. See externalIdNamespace.ts.
           */
          where: ourIdOrSleeperIdWhere(playerIds),
          select: { id: true, sleeperId: true, source: true, name: true, position: true },
        })
      : []
    const playerName = new Map<string, string>()
    for (const p of players) {
      const label = p.position ? `${p.name} (${p.position})` : p.name
      for (const key of playerRowKeys(p)) {
        // Sleeper's own row wins a shared Sleeper id; otherwise the first row found.
        if (!playerName.has(key) || p.source === 'sleeper') playerName.set(key, label)
      }
    }

    runOut = {
      at: lastRun.runAt.toISOString(),
      runType: lastRun.runType,
      stuck: lastRun.status === 'running' && now.getTime() - lastRun.runAt.getTime() > STUCK_AFTER_MS,
      rows: lastRun.results.map((r) => {
        const { result, label } = classifyResult(r.resultType, r.metadata, r.claim?.resultMessage ?? null, language)
        return {
          id: r.id,
          player: playerName.get(r.addPlayerId) ?? m.unrecognisedPlayer,
          manager: handleByRoster.get(r.rosterId) ?? A_MANAGER,
          bid: r.claim?.faabBid ?? null,
          result,
          label,
        }
      }),
    }
  }

  // Sleeper runs its own daily waivers. Its mirror schedule is not imported.
  const next = settings && platform !== 'sleeper'
    ? computeNextWaiverRunAtUtc(now, {
        processingDayOfWeek: settings.processingDayOfWeek,
        processingTimeUtc: settings.processingTimeUtc,
        processingDays: settings.processingDays,
      })
    : null

  return {
    available: true,
    leagueId,
    waiverTypeLabel: waiverTypeLabels(m)[waiverType] ?? (waiverType || m.waiverTypeFallback),
    faabBudget,
    budgets,
    budgetsReason,
    nextRun: next ? formatRunSlot(next, language) : null,
    lastRun: runOut,
    pendingCount,
    canRunNow: role === 'commissioner',
  }
}
