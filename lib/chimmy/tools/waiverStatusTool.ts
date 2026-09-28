import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveWriteAuthority, sourcePlatformLabel } from '@/lib/league/write-authority'
import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { getLeagueWaiverState } from '@/lib/waiver-wire/waiver-state-service'
import { computeNextWaiverRunAtUtc } from '@/lib/waiver-wire/next-waiver-run'
import { getWaiverTypeLabel } from '@/lib/waiver-wire/WaiverWireViewService'
import { readWaiverBudgetUsed } from '@/lib/decision-os/world/derive'

/**
 * "Who's on waivers / what's my FAAB / when do claims run / what did I put in for?"
 *
 * `get_available_players` answers WHO is unrostered. This answers the waiver wire itself: the
 * rules, the order, the budget, the user's own pending claims, when the next run is, and what the
 * last runs did — read from OUR database only (DB-first; no provider call from a chat turn).
 *
 * ── TWO SOURCES, SAID APART ───────────────────────────────────────────────────────────────────
 * NATIVE (AllFantasy-hosted) leagues: the waiver engine's own tables are the system of record —
 * `league_waiver_settings` (through `getEffectiveLeagueWaiverSettings`, the same read the Waivers
 * tab uses), `league_waiver_state` (next run, processing lock), `Roster.faabRemaining` /
 * `waiverPriority`, the user's `waiver_claims` and the league's `waiver_transactions`.
 *
 * IMPORTED leagues: only what the importer stored. That is the waiver type and budget where the
 * platform's payload carried them, each team's FAAB/priority where the sync wrote them — and NEVER
 * pending claims: every platform keeps those private to the account that made them, so no import can
 * see them. The block says so in words, because "no claims" and "claims we cannot see" must never
 * read the same.
 *
 * ⚠ THE `League.waiver*` COLUMNS ARE NOT USED FOR IMPORTED LEAGUES. They carry schema DEFAULTS
 * (`rolling`, budget 100), so an import that never wrote them still reads as "rolling, $100" — a
 * default dressed as a fact. Imported values come from the synced settings payload or not at all.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MAX_ORDER_SHOWN = 16
const MAX_RESULTS_SHOWN = 8

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function formatEt(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d) + ' ET'
  )
}

type TeamLabel = (platformUserId: string | null | undefined) => string

async function teamLabeller(leagueId: string): Promise<TeamLabel> {
  const teams = await prisma.leagueTeam
    .findMany({ where: { leagueId }, select: { platformUserId: true, teamName: true } })
    .catch(() => [] as Array<{ platformUserId: string | null; teamName: string }>)
  const byPlatform = new Map(
    teams.filter((t) => t.platformUserId).map((t) => [String(t.platformUserId), t.teamName]),
  )
  return (id) => (id && byPlatform.get(String(id))) || 'a team'
}

/** The asker's roster in ANY league: own platform id first, then the team they claimed. */
async function findUserRoster(leagueId: string, userId: string) {
  const select = { id: true, platformUserId: true, faabRemaining: true, waiverPriority: true, settings: true, playerData: true } as const
  const direct = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select }).catch(() => null)
  if (direct) return direct
  const claimed = await prisma.leagueTeam
    .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { platformUserId: true } })
    .catch(() => null)
  if (!claimed?.platformUserId) return null
  return prisma.roster.findFirst({ where: { leagueId, platformUserId: claimed.platformUserId }, select }).catch(() => null)
}

export async function buildWaiverStatusContext(args: { leagueId: string; userId: string; now?: Date }): Promise<string> {
  const now = args.now ?? new Date()
  const membership = await resolveLeagueMembership(args.leagueId, args.userId).catch(() => null)
  if (!membership?.ok) {
    return 'Waivers were NOT read: the signed-in user could not be confirmed as a member of this league. Say so; do not describe any waiver activity.'
  }
  const league = await prisma.league
    .findUnique({ where: { id: args.leagueId }, select: { id: true, name: true, sport: true, platform: true, settings: true } })
    .catch(() => null)
  if (!league) return 'The league could not be loaded, so waivers were not read. Say so; do not describe any.'

  try {
    return resolveWriteAuthority(league.platform) === 'NATIVE'
      ? await nativeWaivers(league, args.userId, now)
      : await importedWaivers(league, args.userId)
  } catch {
    return 'The waiver wire could not be read just now. Say that you could not read it; do not describe claims, budgets or order.'
  }
}

type LeagueRow = { id: string; name: string | null; sport: string; platform: string | null; settings: unknown }

async function nativeWaivers(league: LeagueRow, userId: string, now: Date): Promise<string> {
  const sport = normalizeToSupportedSport(league.sport)
  const [settings, state, mine, rosters, label] = await Promise.all([
    getEffectiveLeagueWaiverSettings(league.id),
    getLeagueWaiverState(league.id).catch(() => null),
    findUserRoster(league.id, userId),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, waiverPriority: true, faabRemaining: true } }),
    teamLabeller(league.id),
  ])

  const lines: string[] = [
    `WAIVER WIRE — "${league.name ?? 'this league'}" (AllFantasy-hosted, ${sport}). Read from the league's own waiver engine; quote it, do not add to it.`,
  ]
  const typeLabel = getWaiverTypeLabel(settings.normalizedWaiverType ?? settings.waiverType)
  lines.push(`- Waiver type: ${typeLabel}.`)
  if (settings.faabBudget != null) lines.push(`- FAAB budget: $${settings.faabBudget} per team${settings.faabMinBid != null ? `, minimum bid $${settings.faabMinBid}` : ''}.`)

  const nextRunIso =
    state?.nextRunAt instanceof Date
      ? state.nextRunAt.toISOString()
      : computeNextWaiverRunAtUtc(now, {
          processingDayOfWeek: settings.processingDayOfWeek,
          processingTimeUtc: settings.processingTimeUtc,
          processingDays: settings.processingDays,
        })
  if (nextRunIso) {
    lines.push(`- Next waiver run: ${formatEt(new Date(nextRunIso))}.`)
  } else if (settings.processingDayOfWeek != null) {
    lines.push(`- Waivers process on ${DAYS[settings.processingDayOfWeek] ?? `day ${settings.processingDayOfWeek}`}; the exact time is not on file.`)
  } else {
    lines.push('- The processing schedule is not on file — do not state when waivers run.')
  }
  if (state?.lastRunAt instanceof Date) lines.push(`- Last run: ${formatEt(state.lastRunAt)}.`)
  if (state?.processingLocked) lines.push('- 🔒 The commissioner has LOCKED waiver processing: claims cannot be added or edited until it is unlocked.')
  const limit = settings.claimLimitPerWeek ?? settings.claimLimitPerPeriod
  if (limit != null) lines.push(`- Claim limit: ${limit} per period${settings.claimLimitPerRun != null ? `, ${settings.claimLimitPerRun} per run` : ''}.`)
  lines.push(
    `- After waivers clear, unclaimed players ${settings.instantFaAfterClear ? 'become instant free-agent pickups' : 'are NOT instant pickups — they go back through waivers'}.`,
  )

  if (!mine) {
    lines.push('- The user has no team in this league, so they have no budget, priority or claims to report.')
  } else {
    const bits: string[] = []
    if (mine.faabRemaining != null) bits.push(`$${mine.faabRemaining} FAAB left`)
    if (mine.waiverPriority != null) bits.push(`waiver priority #${mine.waiverPriority}`)
    lines.push(bits.length ? `- THIS USER: ${bits.join(', ')}.` : '- THIS USER: no FAAB balance or waiver priority is on file for their team.')
  }

  const ordered = rosters
    .filter((r) => r.waiverPriority != null)
    .sort((a, b) => (a.waiverPriority as number) - (b.waiverPriority as number))
  if (ordered.length > 0) {
    const shown = ordered.slice(0, MAX_ORDER_SHOWN).map((r) => {
      const you = mine && r.id === mine.id ? ' (you)' : ''
      const faab = r.faabRemaining != null ? `, $${r.faabRemaining}` : ''
      return `#${r.waiverPriority} ${label(r.platformUserId)}${you}${faab}`
    })
    lines.push(`- Waiver order: ${shown.join('; ')}${ordered.length > shown.length ? ` (+${ordered.length - shown.length} more)` : ''}.`)
  }

  const [claims, results] = await Promise.all([
    mine
      ? prisma.waiverClaim.findMany({
          where: { leagueId: league.id, rosterId: mine.id, status: 'pending' },
          orderBy: [{ priorityOrder: 'asc' }, { createdAt: 'asc' }],
          take: 25,
          select: { addPlayerId: true, dropPlayerId: true, faabBid: true, priorityOrder: true },
        })
      : Promise.resolve([] as Array<{ addPlayerId: string; dropPlayerId: string | null; faabBid: number | null; priorityOrder: number }>),
    prisma.waiverTransaction.findMany({
      where: { leagueId: league.id },
      orderBy: { processedAt: 'desc' },
      take: MAX_RESULTS_SHOWN,
      select: { rosterId: true, addPlayerId: true, dropPlayerId: true, faabSpent: true, processedAt: true },
    }),
  ])
  const ids = [
    ...claims.flatMap((c) => [c.addPlayerId, c.dropPlayerId]),
    ...results.flatMap((r) => [r.addPlayerId, r.dropPlayerId]),
  ].filter((x): x is string => Boolean(x))
  const names = ids.length ? await resolveNames(sport, ids, 80).catch(() => new Map()) : new Map()
  const nm = (id: string | null) => (id ? names.get(id)?.name ?? `(player ${id})` : null)

  if (mine) {
    if (claims.length === 0) {
      lines.push('- THIS USER has NO pending waiver claims.')
    } else {
      lines.push(`- THIS USER's pending claims (${claims.length}), in their priority order:`)
      for (const c of claims) {
        const drop = nm(c.dropPlayerId)
        lines.push(`  • add ${nm(c.addPlayerId)}${drop ? `, drop ${drop}` : ''}${c.faabBid != null ? ` — bid $${c.faabBid}` : ''}`)
      }
    }
    lines.push('- Other managers\' pending claims are private to them — never guess at them.')
  }

  if (results.length > 0) {
    const rosterOwner = new Map(rosters.map((r) => [r.id, r.platformUserId]))
    lines.push('- Most recent processed waiver moves in the league:')
    for (const r of results) {
      const drop = nm(r.dropPlayerId)
      lines.push(
        `  • ${formatEt(r.processedAt)}: ${label(rosterOwner.get(r.rosterId))} added ${nm(r.addPlayerId)}${r.faabSpent != null ? ` for $${r.faabSpent}` : ''}${drop ? `, dropped ${drop}` : ''}`,
      )
    }
  } else {
    lines.push('- No processed waiver moves are recorded for this league yet.')
  }
  lines.push(
    'For WHO is available to claim, call get_available_players (unrostered players ranked by value). Any unrostered player can be claimed through this league\'s waivers.',
  )
  return lines.join('\n')
}

/** Sleeper encodes waiver type as 0/1/2. Anything else is shown as the platform wrote it. */
function importedWaiverType(raw: unknown): string | null {
  const n = num(raw)
  if (n === 0) return 'Rolling waivers'
  if (n === 1) return 'Reverse standings'
  if (n === 2) return 'FAAB'
  if (typeof raw === 'string' && raw.trim()) return getWaiverTypeLabel(raw.trim())
  return null
}

async function importedWaivers(league: LeagueRow, userId: string): Promise<string> {
  const platform = sourcePlatformLabel(league.platform) ?? 'the source platform'
  const s = obj(league.settings)
  const nested = obj(s.settings)
  const ws = obj(s.waiverSettings)
  const type = importedWaiverType(ws.waiverType ?? s.waiver_type ?? nested.waiver_type)
  const budget = num(ws.faabBudget ?? s.waiver_budget ?? nested.waiver_budget ?? s.faab_budget)
  const dayRaw = num(s.waiver_day_of_week ?? nested.waiver_day_of_week)

  const [mine, rosters, label] = await Promise.all([
    findUserRoster(league.id, userId),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { id: true, platformUserId: true, waiverPriority: true, faabRemaining: true } }),
    teamLabeller(league.id),
  ])

  const lines: string[] = [
    `WAIVER WIRE — "${league.name ?? 'this league'}" is imported from ${platform}. Only what the import stored is below; ${platform} is the system of record.`,
    `- Waiver type: ${type ?? `not in the data ${platform} sent us — do not guess it`}.`,
    `- FAAB budget: ${budget != null ? `$${budget} per team` : 'not in the imported data'}.`,
    `- Processing day: ${dayRaw != null && DAYS[dayRaw] ? DAYS[dayRaw] : `not in the imported data — tell them to check ${platform}`}.`,
  ]

  if (!mine) {
    lines.push('- The user\'s team in this league is not claimed or not synced, so no budget or priority can be reported for them.')
  } else {
    const used = readWaiverBudgetUsed({ settings: mine.settings, playerData: mine.playerData } as never)
    const remaining = mine.faabRemaining ?? (budget != null && used != null ? budget - used : null)
    const bits: string[] = []
    if (remaining != null) bits.push(`$${remaining} FAAB left${mine.faabRemaining == null ? ' (budget minus what the sync says was spent)' : ''}`)
    if (mine.waiverPriority != null) bits.push(`waiver priority #${mine.waiverPriority}`)
    lines.push(bits.length ? `- THIS USER (as of the last sync): ${bits.join(', ')}.` : `- THIS USER: ${platform} did not send a FAAB balance or waiver position for their team.`)
  }

  const ordered = rosters.filter((r) => r.waiverPriority != null).sort((a, b) => (a.waiverPriority as number) - (b.waiverPriority as number))
  if (ordered.length > 0) {
    lines.push(
      `- Waiver order as of the last sync: ${ordered
        .slice(0, MAX_ORDER_SHOWN)
        .map((r) => `#${r.waiverPriority} ${label(r.platformUserId)}${mine && r.id === mine.id ? ' (you)' : ''}`)
        .join('; ')}.`,
    )
  }

  lines.push(
    `- PENDING CLAIMS ARE NOT VISIBLE: ${platform} keeps waiver claims private to the account that made them, and no import can read them. Say that plainly — never say the user has no claims, and never guess who claimed whom.`,
    `- Claims, bids and results happen on ${platform}. Chimmy cannot place a claim there.`,
    `For WHO is unrostered here, call get_available_players — but unrostered in our copy is not the same as claimable on ${platform} right now; say so.`,
  )
  return lines.join('\n')
}
