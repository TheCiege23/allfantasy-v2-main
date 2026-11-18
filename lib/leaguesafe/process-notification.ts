import "server-only"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { inspectLeagueSafeHeaders } from "./email-headers"
import { LS_PARSER_VERSION, parseLeagueSafeNotification } from "./notification-parser"

export type ProcessingResult = "parsed" | "unparseable" | "unchanged" | "conflict" | "rejected" | "not_found"

/**
 * Run by the admin's explicit parse action. The inbound capture also runs it, but only when
 * LS_AUTO_PROCESS=1 (off by default); nothing else calls it.
 */
export async function processLeagueSafeNotification(id: string, allowedDomains: string[]): Promise<ProcessingResult> {
  const row = await prisma.leagueSafeRawEmail.findUnique({ where: { id }, select: {
    id: true, messageId: true, receivedAt: true, rawBody: true, processingStatus: true,
    rejectionReason: true, parserVersion: true, parseAttemptedAt: true,
  } })
  if (!row) return "not_found"
  // Terminal delivery rejection takes precedence over any preserved older PASS header.
  if (row.processingStatus === "rejected" || row.rejectionReason) return "rejected"
  if (row.parserVersion === LS_PARSER_VERSION && row.parseAttemptedAt) return "unchanged"
  const authenticated = allowedDomains.length > 0 && !inspectLeagueSafeHeaders(row.rawBody, allowedDomains).rejectionReason
  const parsed = authenticated ? await parseLeagueSafeNotification(row) : null
  const processingStatus = parsed ? "parsed" : "unparseable"
  const parseError = parsed ? null : authenticated ? "unknown_or_invalid_template" : "authentication_policy_failed"
  // Compare-and-swap: simultaneous requests can parse, but only one can publish the result/alert.
  const updated = await prisma.leagueSafeRawEmail.updateMany({
    where: { id, processingStatus: row.processingStatus, rejectionReason: null,
      parserVersion: row.parserVersion, parseAttemptedAt: row.parseAttemptedAt },
    data: { processingStatus, parserVersion: LS_PARSER_VERSION, parseAttemptedAt: new Date(), parseError,
      parsedPayload: parsed ? parsed as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      parseDedupeKey: parsed?.dedupeKey ?? null },
  })
  if (!updated.count) return "conflict"
  // The durable admin alert is the unparseable row + static reason in the capture viewer.
  // Never log MIME, names, links, amounts, or transaction references.
  if (!parsed) console.warn("[leaguesafe] parse_review_required", { id, reason: parseError })
  return processingStatus
}
