import "server-only"
import { prisma } from "@/lib/prisma"
import { inspectLeagueSafeHeaders } from "./email-headers"

export type LeagueSafeCaptureEnvelope = {
  /** Gmail immutable ID from the single confirmed inbox. */
  messageId: string
  /** Gmail internalDate, not the sender-controlled Date header. */
  receivedAt: string
  rawBody: string
}

export async function captureLeagueSafeEmail(envelope: LeagueSafeCaptureEnvelope, domains: string[]) {
  const { rejectionReason, ...headers } = inspectLeagueSafeHeaders(envelope.rawBody, domains)
  const processingStatus = rejectionReason ? "rejected" : "captured"
  // ON CONFLICT DO NOTHING preserves the first capture, even on concurrent retries.
  // A forged RFC Message-ID cannot reserve a real Gmail notification's dedupe key.
  const inserted = await prisma.leagueSafeRawEmail.createMany({
    data: [{
      ...headers, messageId: envelope.messageId, receivedAt: new Date(envelope.receivedAt),
      rawBody: envelope.rawBody, processingStatus, rejectionReason,
    }],
    skipDuplicates: true,
  })
  const stored = await prisma.leagueSafeRawEmail.findUniqueOrThrow({
    where: { messageId: envelope.messageId },
    select: { id: true, processingStatus: true, rejectionReason: true },
  })
  if (inserted.count > 0 && rejectionReason) {
    console.warn("[leaguesafe] email_rejected", { id: stored.id, reason: rejectionReason })
  }
  return { id: stored.id, processingStatus: stored.processingStatus, duplicate: inserted.count === 0 }
}
