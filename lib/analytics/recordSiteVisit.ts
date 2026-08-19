import "server-only"

import crypto from "crypto"
import { prisma } from "@/lib/prisma"

/**
 * Records a single site hit for time-bucketed unique-vs-total analytics.
 *
 * Privacy: the raw IP is NEVER stored. We persist only a salted SHA-256 hash so
 * two hits from the same IP collapse to the same `ipHash` (enabling unique
 * counts) without the address being recoverable. Set SITE_VISIT_SALT in env.
 *
 * Non-blocking + defensive: any failure (table not migrated yet, cold DB) is
 * swallowed so visitor tracking never breaks a page render.
 *
 * Uses a cast to `any` so this compiles before `prisma generate` picks up the
 * new SiteVisit model. After you migrate, you may switch to `prisma.siteVisit`.
 */
export async function recordSiteVisit(
  ip: string | null | undefined,
  opts: { path?: string | null; country?: string | null } = {},
): Promise<void> {
  try {
    if (!ip) return
    if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return

    const salt = process.env.SITE_VISIT_SALT || process.env.NEXTAUTH_SECRET || "af-visit-salt"
    const ipHash = crypto.createHash("sha256").update(`${ip}::${salt}`).digest("hex")

    const client = prisma as unknown as {
      siteVisit?: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }
    }
    if (!client.siteVisit) return

    await client.siteVisit.create({
      data: {
        ipHash,
        path: opts.path ?? null,
        country: opts.country ?? null,
      },
    })
  } catch {
    /* never throw from analytics */
  }
}
