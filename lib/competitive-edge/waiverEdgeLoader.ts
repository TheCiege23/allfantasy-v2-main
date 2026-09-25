/**
 * Loads Competitive Edge for a waiver decision (./waiverEdge.ts holds the rule and the contract).
 *
 * DB-FIRST: reads the waiver history the Sleeper import already wrote (`dw_transaction_facts`,
 * type 'waiver') and the budgets on `rosters.faabRemaining`. It never calls Sleeper.
 *
 * ⚠ READ EVERY LEAGUE ROW FOR THE SLEEPER LEAGUE. When several people import the same Sleeper league
 * each gets its own `League` row, and the waiver facts sit under whichever row synced them
 * (lib/core-app/decisionReceipts.ts does the same). The transaction id is `<sleeperTx>:<roster>`, so
 * a claim cannot appear twice.
 *
 * ⚠ SLEEPER ONLY, AND IT SAYS SO — the same boundary as the trade edge. Other importers write
 * waivers under different type words and some leave the manager empty (Yahoo), so an empty section
 * there would read as a league nobody claims in.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { platformLabel } from '@/lib/core-app/platformLinks'
import type { SectionState } from '@/lib/core-app/leagueHome'
import { myRosterCandidates } from '@/lib/core-app/myRoster'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { WaiversData } from '@/lib/core-app/waivers'
import { buildWaiverEdge, type EdgeWaiverClaim, type WaiverEdge } from './waiverEdge'

/** Past this, the section says the history may be out of date. The import refreshes it daily. */
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

type WaiverPayload = { adds?: unknown; waiverBid?: unknown; status?: unknown; createdAt?: unknown }

function firstAdd(adds: unknown): string | null {
  if (Array.isArray(adds)) return adds.length > 0 ? String(adds[0]) : null
  if (adds && typeof adds === 'object') {
    const keys = Object.keys(adds as Record<string, unknown>)
    return keys.length > 0 ? keys[0]! : null
  }
  return null
}

export async function loadWaiverEdge(input: {
  leagueId: string
  userId: string
  /** From the Waivers screen's own rule read (`waiverType.kind === 'faab'`). */
  usesFaab: boolean
  now?: Date
}): Promise<SectionState<WaiverEdge>> {
  const now = input.now ?? new Date()
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { platform: true, platformLeagueId: true, season: true, sport: true },
  })
  if (!league) return { available: false, reason: 'This league could not be read.' }

  const platform = String(league.platform ?? '').toLowerCase()
  if (platform !== 'sleeper' || !league.platformLeagueId) {
    return {
      available: false,
      reason: `Competitive Edge reads Sleeper waiver history today. ${platformLabel(platform)} leagues aren't connected yet.`,
    }
  }

  const [sameLeagueRows, teams, rosters] = await Promise.all([
    prisma.league.findMany({
      where: { platformLeagueId: league.platformLeagueId, platform: { equals: 'sleeper', mode: 'insensitive' } },
      select: { id: true },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: input.leagueId },
      select: { externalId: true, ownerName: true, teamName: true, platformUserId: true, claimedByUserId: true },
    }),
    prisma.roster.findMany({
      where: { leagueId: input.leagueId },
      select: { platformUserId: true, faabRemaining: true },
    }),
  ])

  const leagueIds = [...new Set([input.leagueId, ...sameLeagueRows.map((r) => r.id)])]
  const rows = await prisma.transactionFact.findMany({
    where: { leagueId: { in: leagueIds }, type: 'waiver', season: league.season },
    select: { transactionId: true, managerId: true, rosterId: true, payload: true, createdAt: true },
  })

  const seen = new Set<string>()
  const raw: Array<{ teamExternalId: string; playerId: string | null; bid: number | null; atIso: string }> = []
  let lastSyncedAt: Date | null = null
  for (const row of rows) {
    if (seen.has(row.transactionId)) continue
    seen.add(row.transactionId)
    const p = (row.payload ?? {}) as WaiverPayload
    // Completed claims only; the sync keeps nothing else, but a row that says otherwise is not a win.
    if (p.status != null && String(p.status).toLowerCase() !== 'complete') continue
    const team = String(row.managerId ?? row.rosterId ?? '').trim()
    if (!team) continue
    const bidNum = Number(p.waiverBid)
    raw.push({
      teamExternalId: team,
      playerId: firstAdd(p.adds),
      bid: Number.isFinite(bidNum) ? bidNum : null,
      atIso: typeof p.createdAt === 'string' ? p.createdAt : row.createdAt.toISOString(),
    })
    if (!lastSyncedAt || row.createdAt > lastSyncedAt) lastSyncedAt = row.createdAt
  }

  // Positions from the league's own sport: a Sleeper id means nothing across sports.
  const playerIds = [...new Set(raw.map((r) => r.playerId).filter((x): x is string => Boolean(x)))]
  const players =
    playerIds.length > 0
      ? await prisma.sportsPlayer
          .findMany({
            where: { sleeperId: { in: playerIds }, sport: String(league.sport) },
            select: { sleeperId: true, position: true },
          })
          .catch(() => [])
      : []
  const positionBySleeperId = new Map<string, string>()
  for (const pl of players) {
    if (pl.sleeperId && pl.position && !positionBySleeperId.has(pl.sleeperId)) positionBySleeperId.set(pl.sleeperId, pl.position)
  }

  const claims: EdgeWaiverClaim[] = raw.map((r) => ({
    teamExternalId: r.teamExternalId,
    position: r.playerId ? (positionBySleeperId.get(r.playerId) ?? null) : null,
    bid: input.usesFaab ? r.bid : null,
    atIso: r.atIso,
  }))

  /*
   * ⚠ YOUR ROSTER IS FOUND THE WAY THE WAIVERS SCREEN FINDS IT, NOT BY ONE KEY.
   * `Roster.platformUserId` sometimes holds our own user id rather than Sleeper's
   * (lib/core-app/myRoster.ts) — most often on the importer's own roster — so the one-key join
   * would lose exactly the budget every line here is compared against. Rivals join on their
   * Sleeper user id alone: widening that could match someone else's roster.
   */
  const viewer = teams.find((t) => t.claimedByUserId === input.userId) ?? null
  const viewerKeys = myRosterCandidates(viewer ?? {}, input.userId)
  const viewerRoster = rosters.find((r) => viewerKeys.includes(r.platformUserId)) ?? null

  const faabByUser = new Map<string, number | null>()
  for (const r of rosters) faabByUser.set(r.platformUserId, r.faabRemaining)

  const managers = teams.map((t) => ({
    teamExternalId: t.externalId,
    name: t.ownerName?.trim() || t.teamName?.trim() || 'A manager',
    faabRemaining:
      viewer && t.externalId === viewer.externalId
        ? (viewerRoster?.faabRemaining ?? null)
        : t.platformUserId
          ? (faabByUser.get(t.platformUserId) ?? null)
          : null,
  }))

  return {
    available: true,
    data: buildWaiverEdge({
      season: league.season,
      usesFaab: input.usesFaab,
      claims,
      managers,
      viewerTeamExternalId: viewer?.externalId ?? null,
      asOf: lastSyncedAt ? lastSyncedAt.toISOString() : null,
      stale: lastSyncedAt ? now.getTime() - lastSyncedAt.getTime() > STALE_AFTER_MS : false,
    }),
  }
}

/**
 * The Waivers screen's read: the edge for a viewer whose plan includes it, and NOTHING otherwise.
 *
 * ⚠ THE SERVER WITHHOLDS, THE LOCK ONLY DRAWS. A locked viewer gets `null` here, so the page never
 * sends their rivals' budgets and claims to the browser; the screen's lock card is a picture of a
 * gate, not the gate (the same rule as every /core depth — see app/core/(shell)/[[...screen]]/page.tsx).
 */
export async function loadWaiverEdgeForScreen(input: {
  waivers: Pick<WaiversData, 'league' | 'waiverType'> | null
  access: CoreDepthAccess | null
  userId: string
  now?: Date
}): Promise<SectionState<WaiverEdge> | null> {
  if (!input.waivers || !input.access?.unlocked) return null
  const w = input.waivers
  return loadWaiverEdge({
    leagueId: w.league.id,
    userId: input.userId,
    usesFaab: w.waiverType.available && w.waiverType.data.kind === 'faab',
    now: input.now,
  }).catch(() => ({ available: false as const, reason: 'Competitive Edge could not be read right now.' }))
}
