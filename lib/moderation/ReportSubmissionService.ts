/**
 * ReportSubmissionService — submit message and user reports (PlatformMessageReport, PlatformUserReport).
 */

import { prisma } from "@/lib/prisma"
import { resolveLeagueAccess } from "@/lib/league-access"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core/ChatRoomResolver"
import { REPORT_REASONS, type ReportReason } from "./shared"

/**
 * League chat lives in a virtual room ("league:<leagueId>"), not a platform
 * thread, so it has no thread-member row to check. The reporter must be able
 * to read that league (the same test league chat itself applies), and the
 * message must be a real row in it: `leagueChatMessage` for a fantasy league,
 * `bracketLeagueMessage` for a bracket league, which shares the room shape.
 * Returns the message's author, or null when the report must be refused.
 */
async function resolveLeagueRoomMessage(
  reporterUserId: string,
  messageId: string,
  threadId: string,
): Promise<{ senderUserId: string | null } | null> {
  const leagueId = getLeagueIdFromVirtualRoom(threadId)
  if (!leagueId) return null
  const leagueMessage = await prisma.leagueChatMessage.findFirst({
    where: { id: messageId, leagueId },
    select: { userId: true },
  })
  if (leagueMessage) {
    const access = await resolveLeagueAccess(leagueId, reporterUserId)
    return access ? { senderUserId: leagueMessage.userId } : null
  }
  const bracketMessage = await (prisma as any).bracketLeagueMessage.findFirst({
    where: { id: messageId, leagueId },
    select: { userId: true },
  })
  if (!bracketMessage) return null
  const member = await (prisma as any).bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId: reporterUserId } },
    select: { id: true },
  })
  return member ? { senderUserId: bracketMessage.userId ?? null } : null
}

export async function createMessageReport(
  reporterUserId: string,
  messageId: string,
  threadId: string,
  reason: string
): Promise<{ id: string } | null> {
  if (!reporterUserId || !messageId || !threadId || !reason.trim()) return null
  const r = reason.trim().slice(0, 500)
  try {
    if (isLeagueVirtualRoom(threadId)) {
      const message = await resolveLeagueRoomMessage(reporterUserId, messageId, threadId)
      if (!message) return null
      if (message.senderUserId && message.senderUserId === reporterUserId) return null
      const existing = await prisma.platformMessageReport.findFirst({
        where: { messageId, threadId, reporterUserId, status: "pending" },
        select: { id: true },
      })
      if (existing) return existing
      return await prisma.platformMessageReport.create({
        data: { messageId, threadId, reporterUserId, reason: r, status: "pending" },
        select: { id: true },
      })
    }

    const canAccessThread = await prisma.platformChatThreadMember.findFirst({
      where: { userId: reporterUserId, threadId, isBlocked: false },
      select: { id: true },
    })
    if (!canAccessThread) return null

    const message = await prisma.platformChatMessage.findFirst({
      where: { id: messageId, threadId },
      select: { id: true, senderUserId: true },
    })
    if (!message) return null
    if (message.senderUserId && message.senderUserId === reporterUserId) return null

    const existingPending = await prisma.platformMessageReport.findFirst({
      where: { messageId, threadId, reporterUserId, status: "pending" },
      select: { id: true },
    })
    if (existingPending) return existingPending

    const created = await prisma.platformMessageReport.create({
      data: {
        messageId,
        threadId,
        reporterUserId,
        reason: r,
        status: "pending",
      },
      select: { id: true },
    })
    return created
  } catch {
    return null
  }
}

export async function createUserReport(
  reporterUserId: string,
  reportedUserId: string,
  reason: string
): Promise<{ id: string } | null> {
  if (!reporterUserId || !reportedUserId || reporterUserId === reportedUserId || !reason.trim()) return null
  const r = reason.trim().slice(0, 500)
  try {
    const reportedExists = await prisma.appUser.findUnique({
      where: { id: reportedUserId },
      select: { id: true },
    })
    if (!reportedExists) return null

    const existingPending = await prisma.platformUserReport.findFirst({
      where: { reporterUserId, reportedUserId, status: "pending" },
      select: { id: true },
    })
    if (existingPending) return existingPending

    const created = await prisma.platformUserReport.create({
      data: {
        reportedUserId,
        reporterUserId,
        reason: r,
        status: "pending",
      },
      select: { id: true },
    })
    return created
  } catch {
    return null
  }
}

export function isValidReason(reason: string): boolean {
  return REPORT_REASONS.includes(reason as ReportReason) || reason === "other"
}
