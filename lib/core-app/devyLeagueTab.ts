import 'server-only'

import { prisma } from '@/lib/prisma'
import { ageOf, newsKindOf } from '@/lib/core-app/devy'
import { devyTrendOf } from '@/lib/devy/devyTrend'
import { findMyRoster } from '@/lib/core-app/myRoster'
import { matchTeamIdForRoster } from '@/lib/leagues/rosterTeamIdentity'
import { DEVY_RIGHTS_NOT_HELD_STATES } from '@/lib/decision-os/trade/leagueAssetPolicy'
import { DEVY_BASIS_NOTE, heldDevyOptionValue } from '@/lib/decision-os/trade/leagueAssetRules'
import { getSlotInRoundForOverall } from '@/lib/live-draft-engine/DraftOrderService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import type { DraftType, TradedPickRecord } from '@/lib/live-draft-engine/types'
import type { DevyNewsItem } from '@/components/core-app/screens/DevyCore'
import type {
  DevyBoardProspect,
  DevyDraftPick,
  DevyFreeAgent,
  DevyLeagueSection,
  DevyLeagueTabProps,
  DevySlot,
  DevyTradeValue,
} from '@/components/core-app/screens/DevyLeagueTab'

/**
 * Server data for the per-league Devy tab (`/core/devy-league?league=…`).
 *
 * DB-first — no provider call on this path, CFBD included. Every section names the table it reads and
 * the module that WRITES that table, because a surface pointed at a table nothing refreshes fails
 * silently and looks correct (CLAUDE.md, "The scheduled writer is the part that is easy to skip"):
 *
 *   slots         DevyRights (this roster)  ← lib/devy/rightsWriter.ts, called by
 *                                               live-draft-engine/PickSubmissionService on a devy pick
 *   free agents   DevyPlayer, not held here ← lib/devy-classification.ts via /api/cron/import-players
 *                                               (devyPool → devyStats → devyIntel phases)
 *   draft board   DraftSession + DraftPick  ← the live-draft engine, when a session carries devy rounds
 *                 else DevyPlayer.devyAdp   ← lib/devy/ingestFantraxDevyAdp.ts, same cron's intel tick
 *   news          SportsNews (NCAAF)        ← /api/cron/import-news → sync-helper upsertArticles
 *   trade values  DevyRights + DevyPlayer   ← as slots; priced by `heldDevyOptionValue`, the grade's call
 *
 * ⚠ HELD MEANS WHAT THE ONE TRADE GRADE MEANS BY IT. `DevyRights` in any state but the two in
 * `DEVY_RIGHTS_NOT_HELD_STATES`, joined to a DevyPlayer who has not graduated. A tab that counted
 * "rostered" differently would list a prospect as a free agent that the grade prices as held.
 *
 * ⚠ IMPORTED ROSTERS DO NOT CARRY DEVY RIGHTS. The only DevyRights writer is the AllFantasy live draft;
 * no importer writes it (Sleeper has no devy slots, and the Fantrax path writes league flags, not
 * rights). So a devy league imported from elsewhere shows empty slots with that reason, not with
 * invented names — and every prospect reads as unrostered HERE, which the free-agent line says.
 *
 * ⚠ NO TREND COLUMN IS FILLED. `DevyPlayer.stockTrendDelta` is not a delta: its only writer
 * (`workers/devy-data-worker.ts`) stores `score/100*10 + c2cPoints/10`, a LEVEL that is non-negative for
 * every scored prospect, so reading it as a trend paints the whole pool as rising. `DevyPlayer.trend`
 * has no writer at all. Trend is null ("no trend measured"), never a manufactured arrow — and it
 * comes from `devyTrendOf` in `lib/devy/devyTrend.ts`, the same helper the cross-league hub uses.
 *
 * NCAAF only: devy is college football, and `DevyPlayer` also holds rows for other college sports.
 * Never throws; each section degrades to an empty list plus a one-line reason.
 */

const SPORT = 'NCAAF'
const FREE_AGENT_COUNT = 12
const ADP_BOARD_COUNT = 12
const TRADE_VALUE_COUNT = 20
const NEWS_COUNT = 6
/** Newest college article older than this and the feed is stale — the import-news job is the suspect. */
export const DEVY_NEWS_FRESH_MS = 72 * 60 * 60 * 1000
/** How far back an article may be and still count as recent news about a prospect. */
const NEWS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
/** How many recent articles are scanned for a prospect's name. */
const NEWS_SCAN = 300
const OPEN_DRAFT_STATUSES = ['pre_draft', 'in_progress', 'paused']

export type DevyLeagueTabData = Pick<
  DevyLeagueTabProps,
  | 'slots'
  | 'freeAgents'
  | 'draftRoundLabel'
  | 'draftCountdown'
  | 'draftBoard'
  | 'draftProspects'
  | 'draftBoardNote'
  | 'news'
  | 'tradeValues'
  | 'tradeValueNote'
  | 'emptyReasons'
>

export const DEVY_TAB_COPY = {
  noTeamClaimed: 'Claim your team in this league to see your devy slots.',
  noRoster: 'Your team’s roster hasn’t been imported here yet, so your devy slots can’t be filled in.',
  noRights:
    'No devy rights are recorded for your team here. Rights are recorded when a prospect is drafted in an AllFantasy devy draft — rosters imported from another platform don’t carry them.',
  slotsFailed: 'Your devy slots couldn’t be read just now.',
  noFreeAgents: 'No scored college prospects are unrostered in this league right now.',
  freeAgentsFailed: 'The college prospect pool couldn’t be read just now.',
  noBoard: 'No devy draft is scheduled in this league, and no devy ADP is on file for its unrostered prospects.',
  boardFailed: 'The devy draft board couldn’t be read just now.',
  adpNote: 'No devy draft order is set in this league, so this is the best available by devy ADP (Fantrax, PPR).',
  adpNoteOrderUnset:
    'A devy draft is set up here but its order isn’t set yet, so this is the best available by devy ADP (Fantrax, PPR).',
  noNewsOnFile: 'No college news is on file yet.',
  newsFailed: 'College news couldn’t be read just now.',
  noProspectNews: 'No recent college news mentions a prospect on this page.',
  noHeld:
    'No prospect is held in this league yet. The trade grade prices a college player only when a team here holds his rights.',
  notNfl: 'Devy trade values are priced for NFL devy leagues only.',
  noSeason: 'Devy trade values need this league’s season on file to measure the wait to the draft.',
  valuesFailed: 'Devy trade values couldn’t be read just now.',
} as const

export function staleNewsReason(age: string): string {
  return `College news was last updated ${age}, which is too old to show as current.`
}

type HeldRow = {
  rosterId: string
  devyPlayerId: string
}

type HeldPlayer = {
  id: string
  name: string
  position: string
  school: string
  headshotUrl: string | null
  ppaSeasonTotal: number | null
  recruitingComposite: number | null
  recruitingStars: number | null
  draftEligibleYear: number | null
}

/** A read that failed is not an empty read; the reason copy has to tell them apart. */
async function attempt<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() }
  } catch {
    return { ok: false }
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** `DraftSession.devyConfig` → the devy rounds, or null when the session has none. */
export function readDevyRounds(devyConfig: unknown): number[] | null {
  const cfg = asRecord(devyConfig)
  if (!cfg || cfg.enabled !== true || !Array.isArray(cfg.devyRounds)) return null
  const rounds = [...new Set(cfg.devyRounds.filter((r): r is number => typeof r === 'number' && Number.isInteger(r) && r > 0))]
  rounds.sort((a, b) => a - b)
  return rounds.length > 0 ? rounds : null
}

function readSlotOrder(v: unknown): Array<{ slot: number; rosterId: string; displayName: string }> {
  if (!Array.isArray(v)) return []
  const out: Array<{ slot: number; rosterId: string; displayName: string }> = []
  for (const raw of v) {
    const r = asRecord(raw)
    if (!r || typeof r.slot !== 'number' || typeof r.rosterId !== 'string') continue
    out.push({ slot: r.slot, rosterId: r.rosterId, displayName: typeof r.displayName === 'string' ? r.displayName : '' })
  }
  return out
}

function readTradedPicks(v: unknown): TradedPickRecord[] {
  if (!Array.isArray(v)) return []
  return v.filter((raw): raw is TradedPickRecord => {
    const r = asRecord(raw)
    return Boolean(r && typeof r.round === 'number' && typeof r.originalRosterId === 'string' && typeof r.newRosterId === 'string')
  })
}

function asDraftType(v: unknown): DraftType {
  return v === 'linear' || v === 'auction' ? v : 'snake'
}

type DevyDraftOrder = { roundLabel: string; countdown: string; picks: DevyDraftPick[] }

/**
 * The next (or current) devy round of this league's open live draft, pick by pick — or null when no
 * open session carries devy rounds, or its order is not set. Order and traded picks go through the
 * draft engine's own resolvers, so this board and the draft room cannot disagree about who picks.
 */
async function loadDevyDraftOrder(leagueId: string): Promise<{ order: DevyDraftOrder | null; orderUnset: boolean }> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, sessionKind: 'live', status: { in: OPEN_DRAFT_STATUSES } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      draftType: true,
      teamCount: true,
      thirdRoundReversal: true,
      slotOrder: true,
      tradedPicks: true,
      devyConfig: true,
      currentRoundNum: true,
      nextOverallPick: true,
    },
  })
  const rounds = session ? readDevyRounds(session.devyConfig) : null
  if (!session || !rounds) return { order: null, orderUnset: false }

  const slotOrder = readSlotOrder(session.slotOrder)
  const teamCount = session.teamCount
  if (slotOrder.length === 0 || !Number.isInteger(teamCount) || teamCount <= 0) return { order: null, orderUnset: true }

  const started = session.status !== 'pre_draft'
  const round = started ? (rounds.find((r) => r >= session.currentRoundNum) ?? rounds[rounds.length - 1]!) : rounds[0]!
  const made = await prisma.draftPick.findMany({
    where: { sessionId: session.id, round },
    select: { overall: true, playerName: true, position: true },
  })
  const madeByOverall = new Map(made.map((p) => [p.overall, p]))
  const draftType = asDraftType(session.draftType)
  const tradedPicks = readTradedPicks(session.tradedPicks)

  const picks: DevyDraftPick[] = []
  for (let pickInRound = 1; pickInRound <= teamCount; pickInRound += 1) {
    const overall = (round - 1) * teamCount + pickInRound
    const slot = getSlotInRoundForOverall({ overall, teamCount, draftType, thirdRoundReversal: session.thirdRoundReversal })
    const owner = resolvePickOwner(round, slot, slotOrder, tradedPicks)
    const pick = madeByOverall.get(overall)
    picks.push({
      id: `pick-${overall}`,
      label: `R${round} · P${pickInRound}`,
      team: owner?.displayName || 'Unassigned',
      status: pick ? 'drafted' : session.status === 'in_progress' && overall === session.nextOverallPick ? 'on-the-clock' : 'upcoming',
      selection: pick ? [pick.playerName, pick.position].filter(Boolean).join(' · ') : null,
    })
  }
  const countdown = session.status === 'in_progress' ? 'Live' : session.status === 'paused' ? 'Paused' : 'Not started'
  return { order: { roundLabel: `Round ${round}`, countdown, picks }, orderUnset: false }
}

/** Whole-word, case-insensitive: "Smith" must not match inside "Smithson". */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z])${escaped}($|[^A-Za-z])`, 'i').test(text)
}

export async function loadDevyLeagueTab(args: {
  leagueId: string
  userId: string
  /** From `leagueDevyNav` — the number of devy slots this league gives each team. */
  devySlotCount: number
  now?: Date
}): Promise<DevyLeagueTabData> {
  const { leagueId, userId } = args
  const now = args.now ?? new Date()
  const emptyReasons: Partial<Record<DevyLeagueSection, string>> = {}

  const [leagueRead, mineRead, rightsRead] = await Promise.all([
    attempt(() => prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true } })),
    attempt(() => findMyRoster(prisma, leagueId, userId)),
    attempt(() =>
      prisma.devyRights.findMany({
        where: { leagueId, state: { notIn: [...DEVY_RIGHTS_NOT_HELD_STATES] } },
        select: { rosterId: true, devyPlayerId: true },
        orderBy: { createdAt: 'asc' },
      }) as Promise<HeldRow[]>,
    ),
  ])

  const rights = rightsRead.ok ? rightsRead.value : []
  const heldRead = await attempt(async () =>
    rights.length === 0
      ? ([] as HeldPlayer[])
      : ((await prisma.devyPlayer.findMany({
          where: { id: { in: [...new Set(rights.map((r) => r.devyPlayerId))] }, graduatedToNFL: false, sport: SPORT },
          select: {
            id: true,
            name: true,
            position: true,
            school: true,
            headshotUrl: true,
            ppaSeasonTotal: true,
            recruitingComposite: true,
            recruitingStars: true,
            draftEligibleYear: true,
          },
        })) as HeldPlayer[]),
  )
  const heldOk = rightsRead.ok && heldRead.ok
  const heldPlayers = new Map((heldRead.ok ? heldRead.value : []).map((p) => [p.id, p]))
  /* A rights row whose prospect graduated, or is not college football, is not held here as a prospect. */
  const held = rights.filter((r) => heldPlayers.has(r.devyPlayerId))
  const heldIds = [...new Set(held.map((r) => r.devyPlayerId))]

  // ── Slots ─────────────────────────────────────────────────────────────────
  const myRosterId = mineRead.ok && mineRead.value.found ? mineRead.value.rosterId : null
  const mine = myRosterId ? held.filter((r) => r.rosterId === myRosterId).map((r) => heldPlayers.get(r.devyPlayerId)!) : []
  const slotCount = Math.max(Math.max(0, args.devySlotCount), mine.length)
  const slots: DevySlot[] = Array.from({ length: slotCount }, (_, i) => {
    const p = mine[i]
    return {
      id: p ? `devy-${p.id}` : `slot-${i}`,
      player: p ? { name: p.name, position: p.position, school: p.school, headshotUrl: p.headshotUrl, teamColor: null } : null,
    }
  })
  if (mine.length === 0) {
    if (!mineRead.ok || !heldOk) emptyReasons.slots = DEVY_TAB_COPY.slotsFailed
    else if (!mineRead.value.found)
      emptyReasons.slots = mineRead.value.reason === 'no_team_claimed' ? DEVY_TAB_COPY.noTeamClaimed : DEVY_TAB_COPY.noRoster
    else emptyReasons.slots = DEVY_TAB_COPY.noRights
  }

  // ── Free agents ───────────────────────────────────────────────────────────
  /*
   * ⚠ ONLY WHEN THE HELD SET WAS READ. Excluding held prospects from an unread list would call every
   * rostered prospect a free agent — the exact false fact this tab exists not to state.
   */
  const faRead = heldOk
    ? await attempt(() =>
        prisma.devyPlayer.findMany({
          where: {
            sport: SPORT,
            devyEligible: true,
            graduatedToNFL: false,
            draftProjectionScore: { not: null },
            ...(heldIds.length > 0 ? { id: { notIn: heldIds } } : {}),
          },
          orderBy: { draftProjectionScore: 'desc' },
          take: FREE_AGENT_COUNT,
          select: { id: true, name: true, position: true, school: true, draftProjectionScore: true, headshotUrl: true },
        }),
      )
    : ({ ok: false } as const)
  const freeAgents: DevyFreeAgent[] = faRead.ok
    ? faRead.value.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        school: p.school,
        grade: p.draftProjectionScore ?? null,
        headshotUrl: p.headshotUrl ?? null,
      }))
    : []
  if (freeAgents.length === 0) emptyReasons.freeAgents = faRead.ok ? DEVY_TAB_COPY.noFreeAgents : DEVY_TAB_COPY.freeAgentsFailed

  // ── Draft board ───────────────────────────────────────────────────────────
  let draftBoard: DevyDraftPick[] = []
  let draftProspects: DevyBoardProspect[] = []
  let draftRoundLabel = 'Best available'
  let draftCountdown: string | null = null
  let draftBoardNote: string | null = null
  const orderRead = await attempt(() => loadDevyDraftOrder(leagueId))
  if (orderRead.ok && orderRead.value.order) {
    draftBoard = orderRead.value.order.picks
    draftRoundLabel = orderRead.value.order.roundLabel
    draftCountdown = orderRead.value.order.countdown
  } else {
    const adpRead = heldOk
      ? await attempt(() =>
          prisma.devyPlayer.findMany({
            where: {
              sport: SPORT,
              devyEligible: true,
              graduatedToNFL: false,
              devyAdp: { not: null },
              ...(heldIds.length > 0 ? { id: { notIn: heldIds } } : {}),
            },
            orderBy: { devyAdp: 'asc' },
            take: ADP_BOARD_COUNT,
            select: { id: true, name: true, position: true, school: true, devyAdp: true },
          }),
        )
      : ({ ok: false } as const)
    draftProspects = adpRead.ok
      ? adpRead.value
          .filter((p): p is typeof p & { devyAdp: number } => typeof p.devyAdp === 'number' && Number.isFinite(p.devyAdp))
          .map((p) => ({ id: p.id, adp: p.devyAdp, name: p.name, position: p.position, school: p.school }))
      : []
    if (draftProspects.length > 0) {
      draftRoundLabel = 'Best available by ADP'
      draftBoardNote = orderRead.ok && orderRead.value.orderUnset ? DEVY_TAB_COPY.adpNoteOrderUnset : DEVY_TAB_COPY.adpNote
    } else {
      emptyReasons.draftBoard = orderRead.ok && adpRead.ok ? DEVY_TAB_COPY.noBoard : DEVY_TAB_COPY.boardFailed
    }
  }

  // ── Trade values ──────────────────────────────────────────────────────────
  const league = leagueRead.ok ? leagueRead.value : null
  const isNfl = String(league?.sport ?? '').toUpperCase() === 'NFL'
  const season = league?.season ?? null
  let tradeValues: DevyTradeValue[] = []
  if (!leagueRead.ok || !heldOk) emptyReasons.tradeValues = DEVY_TAB_COPY.valuesFailed
  else if (held.length === 0) emptyReasons.tradeValues = DEVY_TAB_COPY.noHeld
  else if (!isNfl) emptyReasons.tradeValues = DEVY_TAB_COPY.notNfl
  else if (season == null) emptyReasons.tradeValues = DEVY_TAB_COPY.noSeason
  else {
    const teamNames = await loadHolderNames(leagueId, [...new Set(held.map((r) => r.rosterId))]).catch(
      () => new Map<string, string>(),
    )
    const seen = new Set<string>()
    const rows: DevyTradeValue[] = []
    for (const r of held) {
      if (seen.has(r.devyPlayerId)) continue
      seen.add(r.devyPlayerId)
      const p = heldPlayers.get(r.devyPlayerId)!
      const option = heldDevyOptionValue(
        {
          devyPlayerId: p.id,
          name: p.name,
          position: p.position ?? null,
          ppaSeasonTotal: p.ppaSeasonTotal ?? null,
          recruitingComposite: p.recruitingComposite ?? null,
          recruitingStars: p.recruitingStars ?? null,
          draftEligibleYear: p.draftEligibleYear ?? null,
        },
        season,
      )
      rows.push({
        id: p.id,
        player: p.name,
        value: option.value,
        trend: devyTrendOf(p),
        status: r.rosterId === myRosterId ? 'Rostered · You' : `Rostered · ${teamNames.get(r.rosterId) ?? 'Another team'}`,
      })
    }
    /* Priced first, highest first; an unmeasured prospect is listed, as a dash, never as zero. */
    rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.player.localeCompare(b.player))
    tradeValues = rows.slice(0, TRADE_VALUE_COUNT)
  }

  // ── News ──────────────────────────────────────────────────────────────────
  const names = [
    ...new Map(
      [...held.map((r) => heldPlayers.get(r.devyPlayerId)!), ...freeAgents, ...draftProspects].map((p) => [p.name.toLowerCase(), p.name]),
    ).values(),
  ].filter((n) => n.trim().length >= 5 && n.includes(' '))
  const news = await loadProspectNews(names, now).catch(() => ({ items: [] as DevyNewsItem[], reason: DEVY_TAB_COPY.newsFailed }))
  if (news.items.length === 0 && news.reason) emptyReasons.news = news.reason

  return {
    slots,
    freeAgents,
    draftRoundLabel,
    draftCountdown,
    draftBoard,
    draftProspects,
    draftBoardNote,
    news: news.items,
    tradeValues,
    tradeValueNote: tradeValues.length > 0 ? DEVY_BASIS_NOTE : null,
    emptyReasons,
  }
}

/** Roster.id → the team's display name, through the one roster↔team rule every reader shares. */
async function loadHolderNames(leagueId: string, rosterIds: string[]): Promise<Map<string, string>> {
  if (rosterIds.length === 0) return new Map()
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, platformUserId: true, playerData: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true },
    }),
  ])
  const byId = new Map(teams.map((t) => [t.id, t]))
  const out = new Map<string, string>()
  for (const r of rosters) {
    const teamId = matchTeamIdForRoster(r, teams)
    const team = teamId ? byId.get(teamId) : undefined
    const name = team?.teamName?.trim() || team?.ownerName?.trim()
    if (name) out.set(r.id, name)
  }
  return out
}

/**
 * Recent college news that names a prospect on this tab — or none, with the reason.
 *
 * ⚠ MATCHED ON THE TEXT, NOT ON `playerName`. The news writer tags names from `PlayerIdentityMap`
 * where `sport = 'NFL'`, so a college prospect is never tagged — and the only college articles that DO
 * carry a tag carry it for an NFL player who happens to share a name. Matching the tag would be empty
 * at best and wrong at worst.
 *
 * ⚠ FRESHNESS IS THE NEWEST ARTICLE'S AGE, CHECKED FIRST. `scripts/cron-fast-tier-loop.mjs` records
 * import-news as stale for days at a time; old headlines under a "news" heading read as current.
 */
async function loadProspectNews(names: string[], now: Date): Promise<{ items: DevyNewsItem[]; reason: string | null }> {
  const newest = await prisma.sportsNews.findFirst({
    where: { sport: SPORT, publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    select: { publishedAt: true },
  })
  if (!newest?.publishedAt) return { items: [], reason: DEVY_TAB_COPY.noNewsOnFile }
  if (now.getTime() - newest.publishedAt.getTime() > DEVY_NEWS_FRESH_MS) {
    return { items: [], reason: staleNewsReason(ageOf(newest.publishedAt, now)) }
  }
  if (names.length === 0) return { items: [], reason: DEVY_TAB_COPY.noProspectNews }

  const recent = await prisma.sportsNews.findMany({
    where: { sport: SPORT, publishedAt: { gte: new Date(now.getTime() - NEWS_WINDOW_MS) } },
    orderBy: { publishedAt: 'desc' },
    take: NEWS_SCAN,
    select: { id: true, title: true, description: true, category: true, publishedAt: true },
  })
  const items: DevyNewsItem[] = []
  for (const a of recent) {
    const text = `${a.title} ${a.description ?? ''}`
    const who = names.find((n) => mentions(text, n))
    if (!who) continue
    items.push({ id: a.id, kind: newsKindOf(a.category), player: who, blurb: a.title, age: ageOf(a.publishedAt, now) })
    if (items.length >= NEWS_COUNT) break
  }
  return { items, reason: items.length === 0 ? DEVY_TAB_COPY.noProspectNews : null }
}
