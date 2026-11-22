import "server-only"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { applyVerifiedPayment, readDuesConfig } from "@/lib/dues/duesTracker"
import { deriveLeagueSafeDues, type DuesEntryType } from "./dues-ledger"
import { LS_BOT_ADDRESS } from "./inbound-security"
import { leagueSafeNamesMatch, payerDuesCents, suggestTeamForPayer, teamsCoveredByPayer } from "./matching"
import type { ParsedNotification } from "./notification-parser"

/**
 * Phase 3: a league's LeagueSafe connection, and what its notifications do.
 *
 * The chain is: the commissioner names their LeagueSafe league here and adds the AllFantasy address to
 * it in LeagueSafe → LeagueSafe's own notification emails reach that inbox and are captured and parsed
 * (phases 0 and 2) → a parsed email whose league name belongs to exactly one connection is filed under
 * it and written to the dues ledger → once the commissioner has confirmed which team a payer is, a
 * payer who has paid in full has their team(s) marked paid in the league's dues tracker.
 *
 * 🛑 TRACKING ONLY. Nothing here moves, holds or requests money. LeagueSafe holds it; this reads
 * LeagueSafe's notices about it.
 *
 * 🛑 A NAME IS NOT AN IDENTITY. A payer is matched to a team only by the commissioner. An exact name
 * match is offered as a suggestion and credits nobody until it is confirmed.
 */

const LEDGER_SOURCE = "leaguesafe"
const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v)

export type LeagueSafeConnectInput = { lsLeagueName: string; duesAmountCents: number; dueAt: Date | null }

export function readLeagueSafeConnectInput(body: Record<string, unknown>):
  | { ok: true; input: LeagueSafeConnectInput }
  | { ok: false; error: string } {
  const name = typeof body.lsLeagueName === "string" ? body.lsLeagueName.replace(/\s+/g, " ").trim() : ""
  if (name.length < 2 || name.length > 256) return { ok: false, error: "Enter your LeagueSafe league's name exactly as it appears in LeagueSafe." }
  const dollars = body.duesAmount
  if (typeof dollars !== "number" || !Number.isFinite(dollars) || dollars < 0 || dollars > 100_000) {
    return { ok: false, error: "Dues per team must be a number from 0 to 100,000." }
  }
  let dueAt: Date | null = null
  if (typeof body.dueDate === "string" && body.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) return { ok: false, error: "Pick a valid due date." }
    // End of the due day, so the day itself is not overdue.
    dueAt = new Date(`${body.dueDate}T23:59:59.000Z`)
    if (!Number.isFinite(dueAt.getTime())) return { ok: false, error: "Pick a valid due date." }
  }
  return { ok: true, input: { lsLeagueName: name, duesAmountCents: Math.round(dollars * 100), dueAt } }
}

/** Create the league's connection, or update the one it has. A disconnected one starts over. */
export async function connectLeagueSafe(leagueId: string, userId: string, input: LeagueSafeConnectInput) {
  const existing = await prisma.leagueSafeConnection.findUnique({ where: { afLeagueId: leagueId }, select: { id: true, status: true } })
  const connection = existing
    ? await prisma.leagueSafeConnection.update({
        where: { id: existing.id },
        data: { ...input, ...(existing.status === "disconnected" ? { status: "pending_invite" as const } : {}) },
        select: { id: true },
      })
    : await prisma.leagueSafeConnection.create({
        data: { afLeagueId: leagueId, createdBy: userId, botAddress: LS_BOT_ADDRESS, ...input },
        select: { id: true },
      })
  // Notices that arrived before the league was connected are filed now.
  const filed = await fileWaitingNotifications(leagueId)
  return { connectionId: connection.id, filed }
}

export async function disconnectLeagueSafe(leagueId: string): Promise<boolean> {
  const updated = await prisma.leagueSafeConnection.updateMany({ where: { afLeagueId: leagueId }, data: { status: "disconnected" } })
  return updated.count > 0
}

function parsedPayload(value: unknown): ParsedNotification | null {
  if (!isRecord(value) || !isRecord(value.details) || typeof value.dedupeKey !== "string") return null
  return value as unknown as ParsedNotification
}

function leagueNameOf(payload: ParsedNotification): string | null {
  const league = (payload.details as { league?: { name?: unknown } | null }).league
  return league && typeof league.name === "string" ? league.name : null
}

export type ApplyResult =
  | "not_found" | "not_parsed" | "no_league" | "no_connection" | "ambiguous_connection"
  | "filed" | "recorded" | "duplicate"

/**
 * File one parsed notification under its league's connection and, for a payment or a refund, write it
 * to the ledger. Safe to call again: filing is conditional and a ledger entry's dedupe key is unique.
 */
export async function applyParsedLeagueSafeEmail(rawEmailId: string): Promise<ApplyResult> {
  const row = await prisma.leagueSafeRawEmail.findUnique({
    where: { id: rawEmailId },
    select: { id: true, processingStatus: true, parsedPayload: true, receivedAt: true, leagueConnectionId: true },
  })
  if (!row) return "not_found"
  const payload = row.processingStatus === "parsed" ? parsedPayload(row.parsedPayload) : null
  if (!payload) return "not_parsed"
  const leagueName = leagueNameOf(payload)
  if (!leagueName) return "no_league"

  let connectionId = row.leagueConnectionId
  if (!connectionId) {
    // The name is free text, so a case-insensitive read narrows it and the rule below decides.
    const candidates = await prisma.leagueSafeConnection.findMany({
      where: { status: { not: "disconnected" }, lsLeagueName: { equals: leagueName, mode: "insensitive" } },
      select: { id: true, lsLeagueName: true },
      take: 5,
    })
    const matches = candidates.filter((c) => leagueSafeNamesMatch(c.lsLeagueName, leagueName))
    if (matches.length === 0) return "no_connection"
    // Two leagues with one LeagueSafe name cannot be told apart from an email. Left for a person.
    if (matches.length > 1) return "ambiguous_connection"
    connectionId = matches[0]!.id
    await prisma.leagueSafeRawEmail.updateMany({ where: { id: row.id, leagueConnectionId: null }, data: { leagueConnectionId: connectionId } })
  }
  const connection = await prisma.leagueSafeConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, afLeagueId: true, status: true, lastEmailAt: true },
  })
  if (!connection || connection.status === "disconnected") return "no_connection"
  // The first notice is what proves the AllFantasy address is in the LeagueSafe league.
  if (connection.status !== "active" || !connection.lastEmailAt || connection.lastEmailAt < row.receivedAt) {
    await prisma.leagueSafeConnection.update({
      where: { id: connection.id },
      data: { status: "active", lastEmailAt: !connection.lastEmailAt || connection.lastEmailAt < row.receivedAt ? row.receivedAt : connection.lastEmailAt },
    })
  }

  const details = payload.details
  const entry: { type: DuesEntryType; name: string; amountCents: number } | null =
    details.type === "payment_received" ? { type: "payment", name: details.payerDisplayName, amountCents: details.amountCents }
    : details.type === "league_refund_processed" ? { type: "refund", name: details.ownerDisplayText, amountCents: details.amountCents }
    : null
  if (!entry || !(entry.amountCents > 0)) return "filed"

  const member =
    (await prisma.leagueSafeMember.findFirst({
      where: { connectionId: connection.id, lsDisplayName: { equals: entry.name, mode: "insensitive" } },
      select: { id: true },
    })) ??
    (await prisma.leagueSafeMember.create({
      data: { connectionId: connection.id, afLeagueId: connection.afLeagueId, lsDisplayName: entry.name.slice(0, 256) },
      select: { id: true },
    }))
  try {
    await prisma.duesLedgerEntry.create({
      data: {
        connectionId: connection.id,
        memberId: member.id,
        type: entry.type,
        amountCents: entry.amountCents,
        // LeagueSafe's notice carries no transaction time; when it reached the inbox is the record.
        occurredAt: row.receivedAt,
        sourceRawEmailId: row.id,
        sourceType: "email",
        dedupeKey: payload.dedupeKey.slice(0, 256),
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate"
    throw error
  }
  await syncDuesTrackerFromLeagueSafe(connection.afLeagueId).catch(() => {})
  return "recorded"
}

/** Parsed notices that no connection had claimed yet, for this league's LeagueSafe name. */
async function fileWaitingNotifications(leagueId: string): Promise<number> {
  const connection = await prisma.leagueSafeConnection.findUnique({ where: { afLeagueId: leagueId }, select: { lsLeagueName: true, status: true } })
  if (!connection || connection.status === "disconnected") return 0
  const waiting = await prisma.leagueSafeRawEmail.findMany({
    where: { processingStatus: "parsed", leagueConnectionId: null },
    orderBy: { receivedAt: "asc" },
    select: { id: true, parsedPayload: true },
    take: 500,
  })
  let filed = 0
  for (const row of waiting) {
    const payload = parsedPayload(row.parsedPayload)
    const name = payload ? leagueNameOf(payload) : null
    if (!name || !leagueSafeNamesMatch(name, connection.lsLeagueName)) continue
    const result = await applyParsedLeagueSafeEmail(row.id)
    if (result === "filed" || result === "recorded" || result === "duplicate") filed += 1
  }
  return filed
}

function isMultiSeason(league: { isDynasty: boolean | null; leagueVariant: string | null; settings: unknown }): boolean {
  const settings = isRecord(league.settings) ? league.settings : {}
  const type = String(settings.league_type ?? settings.leagueType ?? "").toLowerCase()
  const variant = String(league.leagueVariant ?? "").toLowerCase()
  return Boolean(league.isDynasty) || ["dynasty", "c2c", "devy", "keeper"].some((k) => type.includes(k) || variant.includes(k))
}

async function loadConnection(leagueId: string) {
  return prisma.leagueSafeConnection.findUnique({
    where: { afLeagueId: leagueId },
    select: {
      id: true, lsLeagueName: true, botAddress: true, status: true, lastEmailAt: true, duesAmountCents: true, currency: true, dueAt: true,
      members: {
        orderBy: { lsDisplayName: "asc" },
        select: {
          id: true, lsDisplayName: true, afTeamId: true, matchMethod: true, confirmedByCommish: true, duesAmountCents: true,
          ledgerEntries: { select: { type: true, amountCents: true } },
        },
      },
    },
  })
}

/** What the commissioner sees: the connection, each LeagueSafe payer, what they owe and have paid. */
export async function loadLeagueSafeView(leagueId: string, now = new Date()) {
  const [connection, teams] = await Promise.all([
    loadConnection(leagueId),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, teamName: true, ownerName: true, claimedByUserId: true }, orderBy: { teamName: "asc" } }),
  ])
  const publicTeams = teams.map((t) => ({ id: t.id, teamName: t.teamName, ownerName: t.ownerName }))
  if (!connection) return { botAddress: LS_BOT_ADDRESS, connection: null, members: [], teams: publicTeams }
  const members = connection.members.map((member) => {
    const covered = member.afTeamId ? teamsCoveredByPayer(member.afTeamId, teams) : []
    const dues = deriveLeagueSafeDues({
      duesAmountCents: payerDuesCents({ baseDuesCents: connection.duesAmountCents, memberOverrideCents: member.duesAmountCents, teamsCovered: covered.length }),
      entries: member.ledgerEntries,
      dueAt: connection.dueAt,
      asOf: now,
    })
    return {
      id: member.id,
      name: member.lsDisplayName,
      teamId: member.afTeamId,
      confirmed: member.confirmedByCommish,
      teamsCovered: covered,
      // Offered, never applied: the commissioner confirms.
      suggestedTeamId: member.afTeamId ? null : suggestTeamForPayer(member.lsDisplayName, publicTeams)?.teamId ?? null,
      dueCents: dues.dueCents,
      paidCents: dues.paidCents,
      owedCents: dues.owedCents,
      status: dues.status,
    }
  })
  return {
    botAddress: connection.botAddress,
    connection: {
      lsLeagueName: connection.lsLeagueName,
      status: connection.status,
      lastEmailAt: connection.lastEmailAt?.toISOString() ?? null,
      duesAmount: connection.duesAmountCents / 100,
      currency: connection.currency,
      dueDate: connection.dueAt ? connection.dueAt.toISOString().slice(0, 10) : null,
    },
    members,
    teams: publicTeams,
  }
}

/** The commissioner says which team a LeagueSafe payer is (or that the match was wrong). */
export async function setLeagueSafeMemberTeam(leagueId: string, memberId: string, teamId: string | null) {
  const connection = await prisma.leagueSafeConnection.findUnique({ where: { afLeagueId: leagueId }, select: { id: true } })
  if (!connection) return { ok: false as const, error: "Connect LeagueSafe first." }
  const member = await prisma.leagueSafeMember.findFirst({ where: { id: memberId, connectionId: connection.id }, select: { id: true, lsDisplayName: true } })
  if (!member) return { ok: false as const, error: "That LeagueSafe member is not in this league." }
  if (teamId) {
    const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, teamName: true, ownerName: true } })
    if (!teams.some((t) => t.id === teamId)) return { ok: false as const, error: "That team is not in this league." }
    const taken = await prisma.leagueSafeMember.findFirst({ where: { connectionId: connection.id, afTeamId: teamId, NOT: { id: memberId } }, select: { id: true } })
    if (taken) return { ok: false as const, error: "Another LeagueSafe member is already matched to that team." }
    const suggested = suggestTeamForPayer(member.lsDisplayName, teams)?.teamId === teamId
    await prisma.leagueSafeMember.update({
      where: { id: memberId },
      data: { afTeamId: teamId, matchMethod: suggested ? "name_exact" : "manual", confirmedByCommish: true },
    })
  } else {
    await prisma.leagueSafeMember.update({ where: { id: memberId }, data: { afTeamId: null, matchMethod: null, confirmedByCommish: false } })
  }
  const marked = await syncDuesTrackerFromLeagueSafe(leagueId)
  return { ok: true as const, marked }
}

/**
 * Mark paid, in the league's dues tracker, every team whose confirmed LeagueSafe payer has paid in
 * full. It only ever marks paid: an unmatched payer, a part payment or a refund changes nothing here,
 * and a team the commissioner marked by hand is left as it is.
 */
export async function syncDuesTrackerFromLeagueSafe(leagueId: string, now = new Date()): Promise<number> {
  const [connection, league] = await Promise.all([
    loadConnection(leagueId),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { season: true, isDynasty: true, leagueVariant: true, settings: true, teams: { select: { id: true, claimedByUserId: true } } },
    }),
  ])
  if (!connection || connection.status === "disconnected" || !league) return 0
  const paidTeamIds: string[] = []
  for (const member of connection.members) {
    if (!member.confirmedByCommish || !member.afTeamId) continue
    const covered = teamsCoveredByPayer(member.afTeamId, league.teams)
    if (covered.length === 0) continue
    const dues = deriveLeagueSafeDues({
      duesAmountCents: payerDuesCents({ baseDuesCents: connection.duesAmountCents, memberOverrideCents: member.duesAmountCents, teamsCovered: covered.length }),
      entries: member.ledgerEntries,
      dueAt: connection.dueAt,
      asOf: now,
    })
    // "Paid" with nothing owed and nothing received is a league with no dues set, not a payment.
    if (dues.status === "paid" && dues.paidCents > 0) paidTeamIds.push(...covered)
  }
  if (paidTeamIds.length === 0) return 0
  const season = league.season ?? now.getUTCFullYear()
  const multiSeason = isMultiSeason(league)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const fresh = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const settings = isRecord(fresh?.settings) ? fresh.settings : {}
    const before = readDuesConfig(settings.dues_tracker)
    // The tracker shows a league once it has an amount; LeagueSafe's dues are that amount.
    const seeded = before.amount == null && connection.duesAmountCents > 0 ? { ...before, amount: connection.duesAmountCents / 100 } : before
    const after = applyVerifiedPayment(seeded, paidTeamIds, { season, multiSeason, now, source: LEDGER_SOURCE })
    if (after === before) return 0
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, dues_tracker: after } as unknown as Prisma.InputJsonValue } })
    const was = new Set(before.entries.filter((e) => e.paid).map((e) => e.teamId))
    return after.entries.filter((e) => e.paid && !was.has(e.teamId)).length
  })
}
