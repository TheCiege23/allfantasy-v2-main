import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { renewalKindFromSelection, resolveLeagueVariantKey } from '@/lib/leagues/renewalPolicy'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { copyRedraftFaabToGeneric } from '@/lib/league/faabMirror'
import { applyNativeDispersal, buildNativeAssetPool, seasonTeamsByRoster } from '@/lib/dispersal-draft/nativeDispersal'
import type { DispersalAsset } from '@/lib/dispersal-draft/types'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import {
  checkBids,
  CLOSE_AFTER_HOURS,
  DEFAULT_CLOSE_AFTER_HOURS,
  DEFAULT_MIN_BID,
  isAuctionDue,
  isAuctionOpen,
  MAX_MIN_BID,
  openNotice,
  ORPHAN_AUCTION_BIDS_KEY,
  ORPHAN_AUCTION_KEY,
  readOrphanAuction,
  readOrphanAuctionBids,
  resolveOrphanAuction,
  resultNotice,
  type BidIssue,
  type OrphanAuction,
  type OrphanAuctionAsset,
} from './orphanAuction'

/**
 * The orphan team auction (./orphanAuction.ts) against the league's rows: the Commissioner Hub and
 * Waivers views, opening, bidding, closing, the hourly close and the Commish OS task.
 *
 * Storage, without a new table:
 *   League.settings.orphan_auction       the auction: assets, closing time, and the result once closed
 *   Roster.settings.orphan_auction_bids  one team's sealed bids, on that team's own row
 * Both are written with `jsonb_set` on their one key, never as a whole-object write, so a bid cannot
 * overwrite another team's or a settings save. Saving bids reads the league row FOR SHARE and closing
 * takes it FOR UPDATE, so a bid either lands before the close counts it or is refused as late.
 *
 * Closing moves the assets with the dispersal draft's native writer (RedraftRosterPlayer, the native
 * future picks, FAAB) inside the same transaction, and charges each winner only for an asset that
 * actually moved — so running a close twice cannot charge twice.
 *
 * DB-first: nothing here calls a provider. Leagues AllFantasy runs, dynasty family only.
 */

type Db = Prisma.TransactionClient

const loadLeague = (leagueId: string, db: Db = prisma) =>
  db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true, platform: true, isDynasty: true, leagueVariant: true, settings: true },
  })
type LeagueRow = NonNullable<Awaited<ReturnType<typeof loadLeague>>>

function supported(league: LeagueRow): boolean {
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return false
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  return (
    renewalKindFromSelection({
      leagueVariant: league.leagueVariant,
      settings,
      selectedType: resolveLeagueVariantKey(league.leagueVariant, settings),
      isDynasty: league.isDynasty,
    }) === 'dynasty_family'
  )
}

// `jsonb_set` on the one key. A column holding SQL or JSON null, or a scalar, is written as {} first.
async function writeAuction(db: Db, leagueId: string, auction: OrphanAuction): Promise<void> {
  await db.$executeRaw`UPDATE leagues SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, ARRAY[${ORPHAN_AUCTION_KEY}]::text[], ${JSON.stringify(auction)}::jsonb) WHERE id = ${leagueId}`
}

async function writeBids(db: Db, rosterId: string, value: unknown): Promise<void> {
  await db.$executeRaw`UPDATE rosters SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, ARRAY[${ORPHAN_AUCTION_BIDS_KEY}]::text[], ${JSON.stringify(value)}::jsonb) WHERE id = ${rosterId}`
}

type Team = { rosterId: string; ownerUserId: string; teamId: string; teamName: string; faab: number; waiverPriority: number | null; settings: unknown }

/** Every team in the league's current season, orphan or not. */
async function loadTeams(leagueId: string, db: Db = prisma): Promise<{ teams: Team[]; teamByRoster: Map<string, string> }> {
  const [rosters, teamByRoster] = await Promise.all([
    db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, settings: true } }),
    seasonTeamsByRoster(db, leagueId),
  ])
  const seasonTeams = await db.redraftRoster.findMany({
    where: { id: { in: [...teamByRoster.values()] } },
    select: { id: true, teamName: true, ownerName: true, faabBalance: true, waiverPriority: true },
  })
  const byId = new Map(seasonTeams.map((t) => [t.id, t]))
  const teams: Team[] = []
  for (const r of rosters) {
    const t = byId.get(teamByRoster.get(r.id) ?? '')
    if (!t) continue
    teams.push({
      rosterId: r.id,
      ownerUserId: r.platformUserId,
      teamId: t.id,
      teamName: t.teamName?.trim() || t.ownerName || 'A team',
      faab: Math.max(0, Math.floor(t.faabBalance ?? 0)),
      waiverPriority: t.waiverPriority ?? null,
      settings: r.settings,
    })
  }
  return { teams, teamByRoster }
}

const isOrphan = (t: Team) => isOrphanPlatformUserId(t.ownerUserId)

async function actingUserHasPlan(userId: string): Promise<boolean> {
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } })
  return hasAfCommissionerPlan(user)
}

// ── Views ──────────────────────────────────────────────────────────────────────────────────────────

export type PublicAsset = Pick<OrphanAuctionAsset, 'id' | 'kind' | 'label' | 'position' | 'team'> & { from: string }

export type OrphanAuctionView =
  | { supported: false }
  | {
      supported: true
      role: 'commissioner' | 'member'
      /** Commissioner: the viewer has AF Commissioner, which opening an auction needs. */
      canOpen: boolean
      /** Commissioner, no auction open: the orphan teams that could be auctioned. */
      orphanTeams: { rosterId: string; teamName: string; players: number; picks: number }[]
      auction: null | {
        id: string
        status: OrphanAuction['status']
        closesAt: string
        minBid: number
        teams: string[]
        assets: PublicAsset[]
        /** Teams that have placed at least one bid, and teams that could. Never the amounts while open. */
        biddingTeams: number
        eligibleTeams: number
        /** Closed: every winning bid, by asset. */
        results: { assetId: string; label: string; rosterId: string; teamName: string; amount: number }[] | null
        unsold: number
      }
      /** The viewer's own team, when it can bid. */
      mine: null | { rosterId: string; teamName: string; budget: number; bids: Record<string, number> }
    }

function publicAuction(auction: OrphanAuction, teams: Team[]) {
  const name = new Map(teams.map((t) => [t.rosterId, t.teamName]))
  const bidders = teams.filter((t) => !isOrphan(t) && !auction.sourceRosterIds.includes(t.rosterId))
  const label = new Map(auction.assets.map((a) => [a.id, a.label]))
  return {
    id: auction.id,
    status: auction.status,
    closesAt: auction.closesAt,
    minBid: auction.minBid,
    teams: auction.sourceTeamNames,
    assets: auction.assets.map((a) => ({ id: a.id, kind: a.kind, label: a.label, position: a.position, team: a.team, from: name.get(a.sourceRosterId) ?? '' })),
    biddingTeams: bidders.filter((t) => Object.keys(readOrphanAuctionBids(t.settings, auction.id)?.bids ?? {}).length > 0).length,
    eligibleTeams: bidders.length,
    results:
      auction.status === 'closed' && auction.result
        ? auction.result.awards
            .filter((w) => !auction.result!.missing.includes(w.assetId))
            .map((w) => ({ assetId: w.assetId, label: label.get(w.assetId) ?? w.assetId, rosterId: w.rosterId, teamName: name.get(w.rosterId) ?? 'A team', amount: w.amount }))
        : null,
    unsold: auction.result?.unsold.length ?? 0,
  }
}

/** Commissioners see the whole auction; a member sees it and their own bids. */
export async function readOrphanAuctionView(
  leagueId: string,
  userId: string,
): Promise<{ ok: true; view: OrphanAuctionView } | { ok: false; status: 403 | 404 }> {
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404 }
  // Most leagues are not dynasty leagues AllFantasy runs, and the Waivers page asks for every one.
  if (!supported(league)) return { ok: true, view: { supported: false } }
  const commissioner = await isElevatedCommissioner(leagueId, userId)
  const { teams } = await loadTeams(leagueId)
  const own = teams.find((t) => t.ownerUserId === userId && !isOrphan(t)) ?? null
  if (!commissioner && !own) return { ok: false, status: 403 }

  const auction = readOrphanAuction(league.settings)
  const open = auction?.status === 'open'
  let orphanTeams: { rosterId: string; teamName: string; players: number; picks: number }[] = []
  if (commissioner && !open) {
    const orphans = teams.filter(isOrphan)
    const pool = orphans.length ? await buildNativeAssetPool(prisma, leagueId, orphans.map((t) => t.rosterId)) : []
    orphanTeams = orphans.map((t) => ({
      rosterId: t.rosterId,
      teamName: t.teamName,
      players: pool.filter((a) => a.sourceRosterId === t.rosterId && a.assetType === 'player').length,
      picks: pool.filter((a) => a.sourceRosterId === t.rosterId && a.assetType === 'draft_pick').length,
    }))
  }
  const canBid = Boolean(own && auction && !auction.sourceRosterIds.includes(own.rosterId))
  return {
    ok: true,
    view: {
      supported: true,
      role: commissioner ? 'commissioner' : 'member',
      canOpen: commissioner && !open ? await actingUserHasPlan(userId) : false,
      orphanTeams,
      auction: auction && auction.status !== 'cancelled' ? publicAuction(auction, teams) : null,
      mine:
        canBid && own && auction
          ? { rosterId: own.rosterId, teamName: own.teamName, budget: own.faab, bids: readOrphanAuctionBids(own.settings, auction.id)?.bids ?? {} }
          : null,
    },
  }
}

// ── Commissioner actions ───────────────────────────────────────────────────────────────────────────

export type ActionResult = { ok: true; auction: OrphanAuction } | { ok: false; status: 400 | 403 | 404 | 409; error: string; code?: BidIssue }

function toAuctionAssets(pool: DispersalAsset[]): OrphanAuctionAsset[] {
  const out: OrphanAuctionAsset[] = []
  for (const a of pool) {
    if (a.assetType === 'player' && a.playerId) {
      out.push({ id: `p:${a.sourceRosterId}:${a.playerId}`, kind: 'player', sourceRosterId: a.sourceRosterId, label: a.playerName || a.playerId, playerId: a.playerId, position: a.playerPosition, team: a.playerTeam })
    } else if (a.assetType === 'draft_pick' && a.pickId) {
      out.push({ id: `k:${a.pickId}`, kind: 'pick', sourceRosterId: a.sourceRosterId, label: a.pickLabel || a.pickId, pickId: a.pickId, pickRound: a.pickRound, pickYear: a.pickYear, originalOwnerRosterId: a.originalOwnerRosterId })
    }
  }
  return out
}

export async function openOrphanAuction(
  leagueId: string,
  userId: string,
  input: { sourceRosterIds?: unknown; closeAfterHours?: unknown; minBid?: unknown },
  now = new Date(),
): Promise<ActionResult> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Only the commissioner can open an orphan auction.' }
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (!supported(league)) return { ok: false, status: 400, error: 'Orphan auctions are for dynasty leagues AllFantasy runs.' }
  if (!(await actingUserHasPlan(userId))) return { ok: false, status: 403, error: 'The orphan auction is part of the AF Commissioner plan.' }
  if (readOrphanAuction(league.settings)?.status === 'open') return { ok: false, status: 409, error: 'An orphan auction is already open.' }

  const hours = input.closeAfterHours === undefined ? DEFAULT_CLOSE_AFTER_HOURS : Number(input.closeAfterHours)
  if (!(CLOSE_AFTER_HOURS as readonly number[]).includes(hours)) return { ok: false, status: 400, error: `Close after one of ${CLOSE_AFTER_HOURS.join(', ')} hours.` }
  const minBid = input.minBid === undefined ? DEFAULT_MIN_BID : Number(input.minBid)
  if (!Number.isInteger(minBid) || minBid < 0 || minBid > MAX_MIN_BID) return { ok: false, status: 400, error: `The minimum bid is a whole number from 0 to ${MAX_MIN_BID}.` }

  const { teams } = await loadTeams(leagueId)
  const orphans = new Map(teams.filter(isOrphan).map((t) => [t.rosterId, t]))
  const wanted = Array.isArray(input.sourceRosterIds) ? [...new Set(input.sourceRosterIds.map(String))] : []
  if (wanted.length === 0 || wanted.some((id) => !orphans.has(id))) return { ok: false, status: 400, error: 'Choose one or more orphan teams.' }
  const bidders = teams.filter((t) => !isOrphan(t))
  if (bidders.length === 0) return { ok: false, status: 400, error: 'No team is left to bid.' }

  const assets = toAuctionAssets(await buildNativeAssetPool(prisma, leagueId, wanted))
  if (assets.length === 0) return { ok: false, status: 400, error: 'Those teams have no players or picks to auction.' }

  const auction: OrphanAuction = {
    id: randomUUID(),
    status: 'open',
    sourceRosterIds: wanted,
    sourceTeamNames: wanted.map((id) => orphans.get(id)!.teamName),
    assets,
    minBid,
    openedAt: now.toISOString(),
    openedBy: userId,
    closesAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    closedAt: null,
    result: null,
  }
  const written = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    if (readOrphanAuction(rows[0]?.settings)?.status === 'open') return false
    await writeAuction(tx, leagueId, auction)
    return true
  })
  if (!written) return { ok: false, status: 409, error: 'An orphan auction is already open.' }

  const notice = openNotice({ teams: auction.sourceTeamNames, assets: assets.length, closesAt: auction.closesAt, leagueName: league.name ?? 'your league' })
  await notify(league, bidders.map((t) => t.ownerUserId), notice, `orphan-auction:open:${auction.id}`, 'orphan_auction_open').catch(() => undefined)
  return { ok: true, auction }
}

export async function cancelOrphanAuction(leagueId: string, userId: string): Promise<ActionResult> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Only the commissioner can cancel an orphan auction.' }
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    if (!rows.length) return { ok: false, status: 404, error: 'League not found.' }
    const auction = readOrphanAuction(rows[0]!.settings)
    if (auction?.status !== 'open') return { ok: false, status: 409, error: 'No orphan auction is open.' }
    const cancelled: OrphanAuction = { ...auction, status: 'cancelled', closedAt: new Date().toISOString() }
    await writeAuction(tx, leagueId, cancelled)
    return { ok: true, auction: cancelled }
  })
}

// ── Bids ───────────────────────────────────────────────────────────────────────────────────────────

const BID_ERRORS: Record<BidIssue, string> = {
  AUCTION_CLOSED: 'The auction is closed.',
  UNKNOWN_ASSET: 'One of those players or picks is not in this auction.',
  NOT_WHOLE_DOLLARS: 'Bids are whole dollars.',
  BELOW_MIN_BID: 'A bid is below the minimum.',
  OVER_BUDGET: 'Your bids add up to more than your FAAB.',
}

/** Replace the viewer's team's bids. An empty set withdraws them. */
export async function saveOrphanAuctionBids(leagueId: string, userId: string, raw: unknown, now = new Date()): Promise<ActionResult> {
  const { teams } = await loadTeams(leagueId)
  const own = teams.find((t) => t.ownerUserId === userId && !isOrphan(t))
  if (!own) return { ok: false, status: 403, error: 'Only a team in this league can bid.' }
  return prisma.$transaction(async (tx): Promise<ActionResult> => {
    // FOR SHARE: a close (FOR UPDATE) waits for this bid or runs first and makes it late.
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${leagueId} FOR SHARE`
    const auction = readOrphanAuction(rows[0]?.settings)
    if (!auction || auction.status !== 'open') return { ok: false, status: 409, error: BID_ERRORS.AUCTION_CLOSED, code: 'AUCTION_CLOSED' }
    if (auction.sourceRosterIds.includes(own.rosterId)) return { ok: false, status: 403, error: 'An orphan team cannot bid.' }
    const checked = checkBids({ auction, raw, budget: own.faab, now })
    if (!checked.ok) return { ok: false, status: checked.issue === 'AUCTION_CLOSED' ? 409 : 400, error: BID_ERRORS[checked.issue], code: checked.issue }
    await writeBids(tx, own.rosterId, { auctionId: auction.id, bids: checked.bids, updatedAt: now.toISOString() })
    return { ok: true, auction }
  })
}

// ── Closing ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Award the auction. `actorUserId` null is the hourly run; a commissioner may close it only once its
 * closing time has passed (sealed bids were promised until then).
 */
export async function closeOrphanAuction(leagueId: string, opts: { actorUserId: string | null; now?: Date }): Promise<ActionResult> {
  const now = opts.now ?? new Date()
  if (opts.actorUserId && !(await isElevatedCommissioner(leagueId, opts.actorUserId))) {
    return { ok: false, status: 403, error: 'Only the commissioner can close the orphan auction.' }
  }
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404, error: 'League not found.' }

  const closed = await prisma.$transaction(
    async (tx): Promise<ActionResult> => {
      const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const auction = readOrphanAuction(rows[0]?.settings)
      if (!auction || auction.status !== 'open') return { ok: false, status: 409, error: 'No orphan auction is open.' }
      if (!isAuctionDue(auction, now)) return { ok: false, status: 409, error: 'The auction is still taking bids.' }

      const { teams, teamByRoster } = await loadTeams(leagueId, tx)
      const { awards, unsold } = resolveOrphanAuction({
        auction,
        bidders: teams
          .filter((t) => !isOrphan(t))
          .map((t) => {
            const b = readOrphanAuctionBids(t.settings, auction.id)
            return { rosterId: t.rosterId, bids: b?.bids ?? {}, updatedAt: b?.updatedAt ?? now.toISOString(), budget: t.faab, waiverPriority: t.waiverPriority }
          }),
      })
      const winner = new Map(awards.map((w) => [w.assetId, w]))
      const moves: DispersalAsset[] = auction.assets.map((a) => ({
        id: a.id,
        assetType: a.kind === 'player' ? 'player' : 'draft_pick',
        sourceRosterId: a.sourceRosterId,
        playerId: a.playerId,
        playerName: a.kind === 'player' ? a.label : undefined,
        playerPosition: a.position,
        playerTeam: a.team,
        pickId: a.pickId,
        claimedByRosterId: winner.get(a.id)?.rosterId ?? null,
        isAvailable: false,
      }))
      // The orphan teams' FAAB goes to 0, as in a dispersal draft.
      for (const rosterId of auction.sourceRosterIds) moves.push({ id: `f:${rosterId}`, assetType: 'faab', sourceRosterId: rosterId, isAvailable: false })
      const applied = await applyNativeDispersal(tx, { leagueId, assets: moves, now })

      // `missing` names player ids and pick ids: map them back to this auction's assets.
      const gone = new Set(applied.missing)
      const missing = auction.assets.filter((a) => winner.has(a.id) && gone.has(a.kind === 'player' ? a.playerId! : a.pickId!)).map((a) => a.id)
      const charged = new Map<string, number>()
      for (const w of awards) if (!missing.includes(w.assetId)) charged.set(w.rosterId, (charged.get(w.rosterId) ?? 0) + w.amount)
      for (const [rosterId, amount] of charged) {
        const teamId = teamByRoster.get(rosterId)
        if (teamId && amount > 0) await tx.redraftRoster.update({ where: { id: teamId }, data: { faabBalance: { decrement: amount } } })
      }
      await copyRedraftFaabToGeneric(tx, [...charged.keys()].map((id) => teamByRoster.get(id)).filter((x): x is string => Boolean(x)))

      const done: OrphanAuction = { ...auction, status: 'closed', closedAt: now.toISOString(), result: { awards, unsold, missing } }
      await writeAuction(tx, leagueId, done)
      return { ok: true, auction: done }
    },
    { timeout: 30_000 },
  )
  if (closed.ok) await notifyResults(league, closed.auction).catch(() => undefined)
  return closed
}

async function notifyResults(league: LeagueRow, auction: OrphanAuction): Promise<void> {
  const { teams } = await loadTeams(league.id)
  const label = new Map(auction.assets.map((a) => [a.id, a.label]))
  const missing = new Set(auction.result?.missing ?? [])
  for (const team of teams) {
    if (isOrphan(team) || auction.sourceRosterIds.includes(team.rosterId)) continue
    if (Object.keys(readOrphanAuctionBids(team.settings, auction.id)?.bids ?? {}).length === 0) continue
    const won = (auction.result?.awards ?? [])
      .filter((w) => w.rosterId === team.rosterId && !missing.has(w.assetId))
      .map((w) => ({ label: label.get(w.assetId) ?? w.assetId, amount: w.amount }))
    const notice = resultNotice({ won, leagueName: league.name ?? 'your league' })
    await notify(league, [team.ownerUserId], notice, `orphan-auction:result:${auction.id}`, 'orphan_auction_result')
  }
}

async function preferredLanguage(userId: string): Promise<'en' | 'es'> {
  const p = await prisma.userProfile.findUnique({ where: { userId }, select: { preferredLanguage: true } }).catch(() => null)
  return p?.preferredLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

async function notify(
  league: LeagueRow,
  userIds: string[],
  notice: { title: { en: string; es: string }; body: { en: string; es: string } },
  dedupePrefix: string,
  type: string,
): Promise<void> {
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  for (const userId of [...new Set(userIds)].filter((id) => !isOrphanPlatformUserId(id))) {
    const lang = await preferredLanguage(userId)
    await dispatchNotification({
      userIds: [userId],
      category: 'league_announcements',
      type,
      title: notice.title[lang],
      body: notice.body[lang],
      actionHref: `/core/waivers?league=${encodeURIComponent(league.id)}#orphan-auction`,
      actionLabel: lang === 'es' ? 'Ver subasta' : 'Open auction',
      leagueId: league.id,
      severity: 'medium',
      dedupePrefix,
    })
  }
}

export type OrphanAuctionRunResult = { leagues: number; closed: number; failures: { leagueId: string; error: string }[] }

/** Hourly: close every auction whose closing time has passed. */
export async function runOrphanAuctionClose(opts?: { now?: Date; limit?: number; deadline?: number }): Promise<OrphanAuctionRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: OrphanAuctionRunResult = { leagues: 0, closed: 0, failures: [] }
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings -> ${ORPHAN_AUCTION_KEY} ->> 'status' = 'open'
      AND (settings -> ${ORPHAN_AUCTION_KEY} ->> 'closesAt')::timestamptz <= ${now}
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? 25, 100))}`
  for (const { id } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const r = await closeOrphanAuction(id, { actorUserId: null, now })
      if (r.ok) result.closed += 1
      else if (r.status !== 409) result.failures.push({ leagueId: id, error: r.error })
    } catch (e) {
      result.failures.push({ leagueId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

// ── Commish OS and Chimmy ──────────────────────────────────────────────────────────────────────────

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })

/**
 * Commish OS: one task while an auction is open (who has bid), and one if its closing time has passed
 * without it closing — the hourly run normally does that within the hour.
 */
export async function readOrphanAuctionTasks(leagueId: string, now = new Date()): Promise<WorkspaceTaskCandidate[]> {
  const league = await loadLeague(leagueId)
  if (!league || !supported(league)) return []
  const auction = readOrphanAuction(league.settings)
  if (!auction || auction.status !== 'open') return []
  const { teams } = await loadTeams(leagueId)
  const pub = publicAuction(auction, teams)
  const href = `/core/commissioner?league=${encodeURIComponent(leagueId)}#ch-orphan-auction`
  const links = [{ label: 'Commissioner Hub', moduleId: 'managers', href }]
  if (isAuctionDue(auction, now)) {
    return [
      {
        sourceKey: `orphan-auction-due:${auction.id}:v1`,
        title: 'The orphan auction is ready to close',
        description: `Bidding on ${pub.teams.join(', ')} ended ${when(auction.closesAt)}. AllFantasy closes it within the hour; you can also close it now from the Commissioner Hub.`,
        priority: 'high',
        automationCandidate: false,
        relatedLinks: links,
      },
    ]
  }
  return [
    {
      sourceKey: `orphan-auction-open:${auction.id}:v1`,
      title: 'Orphan auction open',
      description: `${pub.assets.length} players and picks from ${pub.teams.join(', ')}, sealed FAAB bids until ${when(auction.closesAt)}. ${pub.biddingTeams} of ${pub.eligibleTeams} teams have bid so far.`,
      priority: 'standard',
      // It closes itself; nothing for the commissioner to do but remind the league.
      automationCandidate: false,
      relatedLinks: links,
    },
  ]
}

/** For Chimmy: the open auction in one line, or null. Never anyone's bids. */
export async function readOrphanAuctionForChimmy(leagueId: string, now = new Date()): Promise<string | null> {
  const league = await loadLeague(leagueId)
  if (!league || !supported(league)) return null
  const auction = readOrphanAuction(league.settings)
  if (!isAuctionOpen(auction, now) && !isAuctionDue(auction, now)) return null
  const players = auction.assets.filter((a) => a.kind === 'player').length
  const picks = auction.assets.length - players
  return (
    `An orphan auction is open for ${auction.sourceTeamNames.join(', ')}: ${players} players and ${picks} future picks, sealed FAAB bids until ${when(auction.closesAt)}` +
    `${auction.minBid > 0 ? ` with a $${auction.minBid} minimum` : ''}. Highest bid wins each one (ties go to waiver priority), a team's bids together cannot be more than its FAAB, and it pays only for what it wins. ` +
    'Bids are on the Waivers page. Never guess or reveal anyone else’s bids.'
  )
}
