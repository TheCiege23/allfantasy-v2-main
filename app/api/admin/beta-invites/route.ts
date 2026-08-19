import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import { resolveAdminAuditIdentity } from "@/lib/admin-audit-identity"
import { issueInvite, listInvites, revokeInvite } from "@/lib/beta-invite/betaAdmissionService"
import { normalizeEmail } from "@/lib/beta-invite/betaAdmissionService"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Admin-only closed-beta invite management. One route, three verbs:
 *   GET    → list invites (safe metadata; never token digests as usable secrets)
 *   POST   → issue an invite for an email; returns the raw token + one-time claim URL ONCE
 *   DELETE → revoke a still-pending invite
 *
 * `requireAdmin()` runs before every branch — the same gate as the rest of /api/admin.
 * The raw token is returned exactly once, in the POST response, and is never logged or
 * persisted (only its digest is stored).
 */

/**
 * True when the failure is "the beta_invites table isn't in this deployment's database"
 * (Prisma P2021). On Preview deployments that run against a database where the additive
 * beta-invite migration has not been applied, the storage is simply absent — that is an
 * environment/provisioning state, NOT a 500-worthy bug. We surface it as such so the panel
 * renders with an honest notice instead of breaking.
 */
function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ((error as { code?: unknown }).code === "P2021") return true
  const msg = error instanceof Error ? error.message : String(error)
  return /does not exist in the current database|relation ".*" does not exist/i.test(msg)
}

/** Non-sensitive deployment classification for the build marker + safe diagnostics. */
function deploymentInfo() {
  const env = process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown"
  let dbHost = "unset"
  try {
    const raw = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.DIRECT_URL || ""
    if (raw) dbHost = new URL(raw).hostname.split(".")[0] || "unknown" // e.g. "ep-xxxx" — a host label, never credentials
  } catch {
    dbHost = "unparseable"
  }
  return { env, commit, dbHost }
}

/** One sanitized structured line — NEVER tokens, cookies, emails, secrets, or full URLs. */
function logProvisioningGap(where: string) {
  const info = deploymentInfo()
  // eslint-disable-next-line no-console
  console.warn(
    `[beta-invites] storage_absent where=${where} env=${info.env} commit=${info.commit} dbHost=${info.dbHost}`,
  )
}

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const info = deploymentInfo()
  try {
    const invites = await listInvites({ limit: 200 })
    return NextResponse.json({ invites, provisioned: true, build: { env: info.env, commit: info.commit } })
  } catch (error) {
    if (isMissingTableError(error)) {
      logProvisioningGap("GET")
      // Graceful: the panel renders its UI + an honest "not provisioned here" notice.
      return NextResponse.json({
        invites: [],
        provisioned: false,
        reason: "storage_absent",
        build: { env: info.env, commit: info.commit },
      })
    }
    const message = error instanceof Error ? error.message : "Failed to list invites"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  // Defense-in-depth rate limit on issuance (admin is already authenticated). Keyed by the
  // admin identity so one admin's burst can't starve another.
  const rl = rateLimit(`beta-issue:${resolveAdminAuditIdentity(gate.user)}:${getClientIp(request)}`, 60, 600_000)
  if (!rl.success) {
    return NextResponse.json({ error: "Too many invites issued — slow down a moment." }, { status: 429 })
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; expiresAt?: unknown; note?: unknown }
    | null

  const email = normalizeEmail(typeof body?.email === "string" ? body.email : "")
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 })
  }

  let expiresAt: Date | null = null
  if (typeof body?.expiresAt === "string" && body.expiresAt.trim()) {
    const parsed = new Date(body.expiresAt)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "expiresAt is not a valid date." }, { status: 400 })
    }
    expiresAt = parsed
  }

  const note = typeof body?.note === "string" ? body.note : null

  try {
    const issued = await issueInvite({
      email,
      adminId: resolveAdminAuditIdentity(gate.user),
      expiresAt,
      note,
    })

    const origin = new URL(request.url).origin
    // The one-time claim URL — the only place the raw token is ever surfaced.
    const claimUrl = `${origin}/api/auth/beta/claim?token=${encodeURIComponent(issued.rawToken)}`

    return NextResponse.json({
      id: issued.id,
      invitedEmail: issued.invitedEmail,
      expiresAt: issued.expiresAt,
      rawToken: issued.rawToken,
      claimUrl,
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      logProvisioningGap("POST")
      return NextResponse.json(
        {
          error:
            "Beta-invite storage isn't provisioned in this environment. Apply the beta_invites migration to this deployment's database to enable issuing.",
          provisioned: false,
          reason: "storage_absent",
        },
        { status: 503 },
      )
    }
    const message = error instanceof Error ? error.message : "Failed to issue invite"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const id = (url.searchParams.get("id") ?? "").trim()
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 })

  try {
    const result = await revokeInvite({ id, adminId: resolveAdminAuditIdentity(gate.user) })
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409
      return NextResponse.json({ error: result.reason }, { status })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isMissingTableError(error)) {
      logProvisioningGap("DELETE")
      return NextResponse.json(
        { error: "Beta-invite storage isn't provisioned in this environment.", provisioned: false, reason: "storage_absent" },
        { status: 503 },
      )
    }
    const message = error instanceof Error ? error.message : "Failed to revoke invite"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
