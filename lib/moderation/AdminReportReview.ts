/**
 * Admin review of reported chat messages — the other half of Report
 * (App Store guideline 1.2 expects reports to be ACTED ON, not just stored).
 *
 * A report points at a message by (messageId, threadId). Where the message
 * lives depends on the room:
 *   "league:<id>"  → leagueChatMessage, or bracketLeagueMessage for a bracket league
 *   anything else  → platformChatMessage (DMs and huddles)
 *
 * Removing a message is the SAME soft delete a sender's own Delete performs
 * (text → "[message deleted]", `deletedAt` in metadata) so every chat surface
 * already renders it as deleted. The one difference is recorded, not hidden:
 * `removedByModeration: true`, and no sender check — that is the point.
 * Resolving a message closes EVERY pending report on it, so three members
 * reporting the same post is one decision, not three.
 */

import { prisma } from "@/lib/prisma"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core/ChatRoomResolver"

export type ReportedMessageStore = "league" | "bracket" | "platform"

export interface ReportForReview {
  id: string
  status: string
  reason: string
  createdAt: string
  threadId: string
  messageId: string
  reporter: { id: string; username: string | null }
  /** Null when the message no longer exists (hard-deleted, or a bad id). */
  message: {
    store: ReportedMessageStore
    text: string
    authorId: string | null
    authorUsername: string | null
    createdAt: string
    deleted: boolean
    removedByModeration: boolean
    /** League or bracket-league name for a league room; null for a DM/huddle. */
    roomName: string | null
  } | null
  /** Pending reports on the same message, including this one. */
  reportsOnMessage: number
}

type Meta = Record<string, unknown>

function asMeta(v: unknown): Meta {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Meta) } : {}
}

async function loadMessage(messageId: string, threadId: string): Promise<{
  store: ReportedMessageStore
  text: string
  authorId: string | null
  createdAt: Date
  metadata: Meta
  roomName: string | null
} | null> {
  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return null
    const league = await prisma.leagueChatMessage.findFirst({
      where: { id: messageId, leagueId },
      select: { message: true, userId: true, createdAt: true, metadata: true, league: { select: { name: true } } },
    })
    if (league) {
      return { store: "league", text: league.message, authorId: league.userId, createdAt: league.createdAt, metadata: asMeta(league.metadata), roomName: league.league?.name ?? null }
    }
    const bracket = await (prisma as any).bracketLeagueMessage.findFirst({
      where: { id: messageId, leagueId },
      select: { message: true, userId: true, createdAt: true, metadata: true, league: { select: { name: true } } },
    })
    if (!bracket) return null
    return { store: "bracket", text: bracket.message, authorId: bracket.userId ?? null, createdAt: bracket.createdAt, metadata: asMeta(bracket.metadata), roomName: bracket.league?.name ?? null }
  }
  const platform = await (prisma as any).platformChatMessage.findFirst({
    where: { id: messageId, threadId },
    select: { body: true, senderUserId: true, createdAt: true, metadata: true },
  })
  if (!platform) return null
  return { store: "platform", text: platform.body, authorId: platform.senderUserId ?? null, createdAt: platform.createdAt, metadata: asMeta(platform.metadata), roomName: null }
}

export async function listReportsForReview(opts: { status?: "pending" | "all"; limit?: number } = {}): Promise<ReportForReview[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200)
  const reports = await prisma.platformMessageReport.findMany({
    where: opts.status === "all" ? {} : { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
  if (reports.length === 0) return []

  const messages = await Promise.all(reports.map((r) => loadMessage(r.messageId, r.threadId)))
  const userIds = new Set<string>()
  reports.forEach((r, i) => {
    userIds.add(r.reporterUserId)
    const authorId = messages[i]?.authorId
    if (authorId) userIds.add(authorId)
  })
  const users = await prisma.appUser.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true } })
  const username = new Map(users.map((u) => [u.id, u.username ?? null]))

  const pendingCounts = new Map<string, number>()
  for (const r of reports) {
    if (r.status !== "pending") continue
    const key = `${r.threadId}|${r.messageId}`
    pendingCounts.set(key, (pendingCounts.get(key) ?? 0) + 1)
  }

  return reports.map((r, i) => {
    const m = messages[i]
    return {
      id: r.id,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      threadId: r.threadId,
      messageId: r.messageId,
      reporter: { id: r.reporterUserId, username: username.get(r.reporterUserId) ?? null },
      message: m
        ? {
            store: m.store,
            text: m.text,
            authorId: m.authorId,
            authorUsername: m.authorId ? username.get(m.authorId) ?? null : null,
            createdAt: m.createdAt.toISOString(),
            deleted: Boolean(m.metadata.deletedAt),
            removedByModeration: m.metadata.removedByModeration === true,
            roomName: m.roomName,
          }
        : null,
      reportsOnMessage: pendingCounts.get(`${r.threadId}|${r.messageId}`) ?? 0,
    }
  })
}

export type ReviewAction = "remove" | "dismiss"

export type ReviewResult =
  | { ok: true; action: ReviewAction; reportsClosed: number }
  | { ok: false; status: 404 | 409; error: string }

/**
 * Act on one report. `remove` soft-deletes the message and marks every pending
 * report on it resolved; `dismiss` marks every pending report on it dismissed.
 */
export async function reviewReport(reportId: string, action: ReviewAction, adminLabel: string): Promise<ReviewResult> {
  const report = await prisma.platformMessageReport.findUnique({ where: { id: reportId } })
  if (!report) return { ok: false, status: 404, error: "Report not found" }
  if (report.status !== "pending") return { ok: false, status: 409, error: `Report is already ${report.status}` }

  const sameMessage = { messageId: report.messageId, threadId: report.threadId, status: "pending" }

  if (action === "dismiss") {
    const closed = await prisma.platformMessageReport.updateMany({ where: sameMessage, data: { status: "dismissed" } })
    return { ok: true, action, reportsClosed: closed.count }
  }

  const message = await loadMessage(report.messageId, report.threadId)
  if (message && !message.metadata.deletedAt) {
    const metadata = {
      ...message.metadata,
      deletedAt: new Date().toISOString(),
      deletedByUserId: adminLabel,
      removedByModeration: true,
      moderationReportId: report.id,
    }
    if (message.store === "league") {
      await prisma.leagueChatMessage.update({ where: { id: report.messageId }, data: { message: "[message deleted]", metadata } })
    } else if (message.store === "bracket") {
      await (prisma as any).bracketLeagueMessage.update({ where: { id: report.messageId }, data: { message: "[message deleted]", metadata } })
    } else {
      await (prisma as any).platformChatMessage.update({ where: { id: report.messageId }, data: { body: "[message deleted]", metadata, updatedAt: new Date() } })
    }
  }
  // A message already gone (deleted by its sender, or missing) still closes the reports on it.
  const closed = await prisma.platformMessageReport.updateMany({ where: sameMessage, data: { status: "resolved" } })
  return { ok: true, action, reportsClosed: closed.count }
}
