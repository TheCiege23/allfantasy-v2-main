/**
 * Loads managers' records (./managerRecord.ts holds the rule and the contract) — for Chimmy, the
 * manager card and the commissioner's Managers screen.
 *
 * ⚠ NO NEW READ. The trade, waiver and draft histories come from the same readers the Trade Center,
 * Waivers screen and Draft HQ use (`readSleeperTradeHistory`, `readWaiverEdgeInput`,
 * `readDraftEdgeInput`), so a manager's counts here are the counts on those screens. DB-first: none of
 * them calls a provider.
 *
 * 🛑 MEMBERSHIP FIRST, IN HERE — the scoutEdgeLoader rule. A league id can come from a URL or a chat
 * message, and a plan is not a membership: without this a paying viewer could read every manager's
 * record in ANY league by its id. The PLAN gate is the caller's (it decides between this and a lock);
 * this guards the league.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveWaiverRules } from '@/lib/core-app/waivers'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { buildManagerRecord, type ManagerRecord, type ManagerRecordInput } from './managerRecord'
import type { SavedTradeContext } from './tradeSituationFacts'
import type { EdgeWaiverClaim } from './waiverEdge'
import { readSleeperTradeHistory } from './tradeEdgeLoader'
import { readWaiverEdgeInput } from './waiverEdgeLoader'
import { readDraftEdgeInput } from './draftEdgeLoader'
import { readNativeHistory } from './nativeManagerHistory'
import { providerDraftsReason, providerTradesReason, readFantraxUploadedTrades, readProviderWaivers } from './providerManagerHistory'
import { isNativePlatform } from '@/lib/league/isNativeLeague'

export type LeagueManagerRecords = {
  league: { id: string; name: string | null; platform: string }
  /** Your own team, when you have one in this league. Never in `records` unless asked for by id. */
  viewerTeamExternalId: string | null
  records: ManagerRecord[]
}

function displayName(t: { ownerName: string | null; teamName: string | null }): string {
  return t.ownerName?.trim() || t.teamName?.trim() || 'A manager'
}

type LoadLeagueManagerRecordsInput = {
  leagueId: string
  userId: string
  /** Only this team's record. Without it: every manager but the viewer. */
  teamExternalId?: string
  /** Every manager INCLUDING the viewer — the commissioner's directory of the whole league. */
  includeViewer?: boolean
  now?: Date
}

export async function loadLeagueManagerRecords(input: LoadLeagueManagerRecordsInput): Promise<SectionState<LeagueManagerRecords>> {
  const membership = await resolveLeagueMembership(input.leagueId, input.userId).catch(() => null)
  if (!membership) return { available: false, reason: 'Membership in this league could not be checked just now.' }
  if (!membership.ok) return { available: false, reason: 'Manager records are read only for a league you are in.' }

  /*
   * THE LEAGUE'S RECORDS, AS THE VIEWER SEES THEM, THROUGH MANAGER PSYCHOLOGY'S FEED (2026-11-20 re-score, Feed ❌ → ✅).
   * Every manager question — the packet's `managerRecords` slice and the `get_manager_record` tool — rebuilt the whole
   * league's history (trades, waiver claims and FAAB, drafts) on every turn. The default view (every leaguemate but
   * you) is now held for five minutes per viewer (`lib/decision-os/manager-records-os`). ⚠ Membership is proved above
   * on EVERY call, before the cache is read; the plan gate stays in the caller; and the entry is per viewer because
   * your own FAAB is found through your roster (`waiverEdgeLoader.ts`), so one viewer's view is never another's. A
   * single team's record and the commissioner's whole directory still build live. An unavailable result is not cached.
   */
  if (!input.now) {
    const { loadViewerManagerRecords } = await import('@/lib/decision-os/manager-records-os')
    /*
     * THE SCREENS READ THROUGH THE FEED TOO (2026-11-21 re-score, Kernel ⚠ → ✅). The record sheet (one team) and the
     * commissioner's Managers directory (every team) built live while Chimmy read the feed, so the three could show a
     * different count for the same manager inside five minutes.
     *   - One team: served from the viewer's default view, which holds every leaguemate but the viewer — a record there
     *     is built from the same history and the same viewer as a one-team build. The viewer's own team is not in it,
     *     so that one still builds live.
     *   - The directory: its own entry (`includeViewer`), since the default view leaves the viewer out.
     */
    if (input.teamExternalId) {
      const view = await loadViewerManagerRecords({ userId: input.userId, leagueId: input.leagueId }).catch(() => null)
      // The view never holds the viewer's own team (`buildLeagueManagerRecords` leaves it out), so that one falls through.
      const record = view?.records.find((r) => r.manager.teamExternalId === input.teamExternalId)
      if (view && record) return { available: true, data: { ...view, records: [record] } }
    } else {
      const includeViewer = input.includeViewer === true
      const cached = await loadViewerManagerRecords({ userId: input.userId, leagueId: input.leagueId, includeViewer }).catch(() => null)
      if (cached) return { available: true, data: cached }
    }
  }
  return buildLeagueManagerRecords(input)
}

/**
 * The records, built. ⚠ Assumes membership was already proved — `loadLeagueManagerRecords` does that, and the feed's
 * derive is only ever reached from there. Never export a path to this that skips the check.
 */
export async function buildLeagueManagerRecords(input: LoadLeagueManagerRecordsInput): Promise<SectionState<LeagueManagerRecords>> {
  const now = input.now ?? new Date()

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true, sport: true, season: true },
  })
  if (!league) return { available: false, reason: 'This league could not be read.' }
  const platform = String(league.platform ?? '').toLowerCase()

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId: input.leagueId },
    select: { externalId: true, ownerName: true, teamName: true, platformUserId: true, claimedByUserId: true },
  })
  const viewer = teams.find((t) => t.claimedByUserId === input.userId) ?? null

  const targets = input.teamExternalId
    ? teams.filter((t) => t.externalId === input.teamExternalId)
    : teams.filter((t) => input.includeViewer || t.externalId !== viewer?.externalId)
  if (input.teamExternalId && targets.length === 0) {
    return { available: false, reason: 'That team is not in this league.' }
  }

  const history = await readHistory({
    league: { id: league.id, platform, platformLeagueId: league.platformLeagueId, sport: String(league.sport), season: league.season },
    userId: input.userId,
    now,
    teamOwnerIds: new Set(teams.flatMap((t) => (t.platformUserId?.trim() ? [t.platformUserId.trim()] : []))),
  })

  const records = targets.map((t) =>
    buildManagerRecord({
      manager: { name: displayName(t), teamExternalId: t.externalId, ownerId: t.platformUserId?.trim() || null },
      viewerOwnerId: viewer?.platformUserId?.trim() || null,
      trades: history.trades,
      waivers: history.waivers.available
        ? {
            available: true,
            data: {
              season: history.waivers.data.season,
              usesFaab: history.waivers.data.usesFaab,
              claims: history.waivers.data.claims,
              faabRemaining: history.waivers.data.faabByTeam.get(t.externalId) ?? null,
              asOf: history.waivers.data.asOf,
              stale: history.waivers.data.stale,
            },
          }
        : history.waivers,
      drafts: history.drafts,
    }),
  )

  return {
    available: true,
    data: {
      league: { id: league.id, name: league.name ?? null, platform },
      viewerTeamExternalId: viewer?.externalId ?? null,
      records,
    },
  }
}

type LeagueHistory = {
  trades: ManagerRecordInput['trades']
  waivers: SectionState<{
    season: number
    usesFaab: boolean
    claims: EdgeWaiverClaim[]
    faabByTeam: Map<string, number | null>
    asOf: string | null
    stale: boolean
  }>
  drafts: ManagerRecordInput['drafts']
}

/** `MANAGER_TRADE_SITUATION=off` drops the situation lines from every manager record. */
export const MANAGER_TRADE_SITUATION_ENV = 'MANAGER_TRADE_SITUATION'
export function managerTradeSituationOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[MANAGER_TRADE_SITUATION_ENV] ?? '').trim().toLowerCase() !== 'off'
}

/**
 * Each cached trade's saved context (`LeagueTrade.contextSnapshot`, keyed `<seasonLeagueId>:<transactionId>` like the
 * trade itself) and the age of every player taken on. Two bounded reads: the trades' rows, and those players.
 */
export async function readTradeSituation(
  trades: ReadonlyArray<{ id: string; sides: ReadonlyArray<{ playersIn: ReadonlyArray<{ playerId?: string }> }> }>,
  now: Date,
): Promise<NonNullable<Extract<ManagerRecordInput['trades'], { available: true }>['data']['situation']>> {
  const keys = trades.flatMap((t) => {
    const i = t.id.lastIndexOf(':')
    return i > 0 ? [{ id: t.id, league: t.id.slice(0, i), tx: t.id.slice(i + 1) }] : []
  })
  const contexts = new Map<string, SavedTradeContext>()
  for (let i = 0; i < keys.length; i += 500) {
    const part = keys.slice(i, i + 500)
    const rows = await prisma.leagueTrade.findMany({
      where: { transactionId: { in: [...new Set(part.map((k) => k.tx))] }, history: { sleeperLeagueId: { in: [...new Set(part.map((k) => k.league))] } }, NOT: { contextSnapshot: { equals: Prisma.DbNull } } },
      select: { transactionId: true, contextSnapshot: true, history: { select: { sleeperLeagueId: true } } },
    })
    for (const r of rows) {
      const id = `${r.history.sleeperLeagueId}:${r.transactionId}`
      if (!contexts.has(id) && r.contextSnapshot && typeof r.contextSnapshot === 'object') contexts.set(id, r.contextSnapshot as SavedTradeContext)
    }
  }
  const ids = [...new Set(trades.flatMap((t) => t.sides.flatMap((s) => s.playersIn.flatMap((p) => (p.playerId ? [p.playerId] : [])))))]
  const ages = new Map<string, number | null>()
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids.slice(i, i + 1000) } }, select: { sleeperId: true, age: true } })
    for (const r of rows) if (r.sleeperId && !ages.has(r.sleeperId)) ages.set(r.sleeperId, r.age ?? null)
  }
  return { contexts, ages, now }
}

const couldNotRead = (what: string) => ({ available: false as const, reason: `${what} history could not be read right now.` })

/**
 * The league's trade, waiver and draft history in one shape, by platform:
 *   Sleeper — the Trade Center / Waivers / Draft HQ readers;
 *   native  — our own tables (./nativeManagerHistory.ts);
 *   others  — what their imports record per manager, and a named reason for what they do not
 *             (./providerManagerHistory.ts).
 */
async function readHistory(input: {
  league: { id: string; platform: string; platformLeagueId: string | null; sport: string; season: number }
  userId: string
  now: Date
  /** Every team's person id in this league — how a provider's stored trade sides are matched to managers. */
  teamOwnerIds: ReadonlySet<string>
}): Promise<LeagueHistory> {
  const { league, now } = input
  const rules = await resolveWaiverRules(league.id, league.platform).catch(() => null)
  const leagueUsesFaab = Boolean(rules?.waiverType.available && rules.waiverType.data.kind === 'faab')

  if (league.platform === 'sleeper') {
    const [tradesRead, draftsRead, waiverRead] = await Promise.all([
      league.platformLeagueId
        ? readSleeperTradeHistory(league.platformLeagueId, now).catch(() => couldNotRead('Trade'))
        : Promise.resolve({ available: false as const, reason: 'This league has no Sleeper league id on file.' }),
      readDraftEdgeInput(league.id).catch(() => ({ ok: false as const, reason: 'Draft history could not be read right now.' })),
      readWaiverEdgeInput({ leagueId: league.id, userId: input.userId, usesFaab: leagueUsesFaab, now }).catch(() => couldNotRead('Waiver')),
    ])
    // The situation around each trade (record, roster, ages), best-effort: a failed read loses those lines only.
    const trades: ManagerRecordInput['trades'] =
      tradesRead.available && managerTradeSituationOn()
        ? { available: true, data: { ...tradesRead.data, situation: (await readTradeSituation(tradesRead.data.trades, now).catch(() => null)) ?? undefined } }
        : tradesRead
    return {
      trades,
      waivers: waiverRead.available
        ? {
            available: true,
            data: {
              season: waiverRead.data.season,
              usesFaab: waiverRead.data.usesFaab,
              claims: waiverRead.data.claims,
              faabByTeam: new Map(waiverRead.data.managers.map((m) => [m.teamExternalId, m.faabRemaining])),
              asOf: waiverRead.data.asOf,
              stale: waiverRead.data.stale,
            },
          }
        : waiverRead,
      drafts: draftsRead.ok
        ? { available: true, data: { picks: draftsRead.picks, unattributedSeasons: draftsRead.unattributed } }
        : { available: false, reason: draftsRead.reason },
    }
  }

  if (isNativePlatform(league.platform)) {
    const native = await readNativeHistory(league).catch(() => null)
    if (!native) return { trades: couldNotRead('Trade'), waivers: couldNotRead('Waiver'), drafts: couldNotRead('Draft') }
    return {
      trades: native.trades,
      waivers: native.waivers.available ? { available: true, data: { ...native.waivers.data, usesFaab: leagueUsesFaab } } : native.waivers,
      drafts: native.drafts,
    }
  }

  const [waiverRead, trades] = await Promise.all([
    readProviderWaivers(league).catch(() => couldNotRead('Waiver')),
    league.platform === 'fantrax'
      ? readFantraxUploadedTrades(league, input.teamOwnerIds, now).catch(() => couldNotRead('Trade'))
      : Promise.resolve({ available: false as const, reason: providerTradesReason(league.platform) }),
  ])
  return {
    trades,
    waivers: waiverRead.available
      ? {
          available: true,
          data: {
            ...waiverRead.data,
            // Without the winning bids (MFL), FAAB lines would say "spent $0" — so none are drawn.
            usesFaab: leagueUsesFaab && waiverRead.data.bidsKnown,
          },
        }
      : waiverRead,
    drafts: { available: false, reason: providerDraftsReason(league.platform) },
  }
}
