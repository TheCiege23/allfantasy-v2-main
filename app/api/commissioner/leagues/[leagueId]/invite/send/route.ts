import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { createHash } from "crypto"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { assertCommissioner } from "@/lib/commissioner/permissions"
import { getLeaguePrivacySettings } from "@/lib/league-privacy"
import { buildFantasyInviteLink, generateInviteToken, getDefaultFantasyInviteExpiry } from "@/lib/league-invite"
import { buildEmailIdempotencyKey } from "@/lib/email/idempotency"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** One line, bounded: no control characters and no room for a paragraph of pitch. */
function subjectSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 80)
}

function getBaseUrl(req: NextRequest): string {
  // Config-derived, never the Host / X-Forwarded-Host header: these links are
  // returned to clients and emailed, and a spoofed header would point them at
  // an attacker's host. See lib/http/served-origin.ts.
  return getServedOrigin(req)
}

/**
 * POST: Send league invite by username or email (commissioner only).
 * Body: { type: 'username' | 'email', username?: string, email?: string }
 * Returns inviteUrl; for email optionally sends via Resend.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { leagueId } = await params
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const type = body?.type === "username" || body?.type === "email" ? body.type : null
  const username = typeof body?.username === "string" ? body.username.trim() : ""
  const email = typeof body?.email === "string" ? body.email.trim() : ""

  if (!type || (type === "username" && !username) || (type === "email" && !email)) {
    return NextResponse.json(
      { error: "Provide type and username or email" },
      { status: 400 }
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: (await params).leagueId },
    select: { id: true, name: true, settings: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const privacy = await getLeaguePrivacySettings(league.id)
  if (type === "email" && !privacy.allowEmailInvite) {
    return NextResponse.json({ error: "Email invites are disabled for this league." }, { status: 403 })
  }
  if (type === "username" && !privacy.allowUsernameInvite) {
    return NextResponse.json({ error: "Username invites are disabled for this league." }, { status: 403 })
  }

  const settings = (league.settings as Record<string, unknown>) || {}
  let inviteCode = (settings.inviteCode as string) ?? null
  let inviteExpiresAt = settings.inviteExpiresAt as string | null | undefined
  if (!inviteCode || !inviteExpiresAt) {
    inviteCode = inviteCode || generateInviteToken(8)
    inviteExpiresAt = inviteExpiresAt || getDefaultFantasyInviteExpiry()
    await prisma.league.update({
      where: { id: league.id },
      data: { settings: { ...settings, inviteCode, inviteExpiresAt } },
    })
  }

  const baseUrl = getBaseUrl(req)
  const inviteUrl = buildFantasyInviteLink(inviteCode || generateInviteToken(8), baseUrl)
  const leagueName = (league.name as string) || "League"

  if (type === "email") {
    // Anyone can create a league and so be its commissioner; this sends from our
    // verified sender to any address. Cap the volume per commissioner so it cannot
    // be used as a bulk mailer.
    const rl = rateLimit(`league-invite-email:${userId}`, 20, 60 * 60 * 1000)
    if (!rl.success) {
      return NextResponse.json({ error: "Too many email invites. Try again later.", inviteUrl }, { status: 429 })
    }
    try {
      const { getResendClient } = await import("@/lib/resend-client")
      const { client, fromEmail } = getResendClient()
      // Idempotency key: league + one-way hash of recipient email (no PII stored in key)
      const emailHash = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)
      const sent = await client.emails.send(
        {
          from: fromEmail,
          to: email,
          // The league name is commissioner-controlled: escape it for HTML, and keep the
          // subject to one short line. Unescaped, a name like `<a href=…>` made this a
          // phishing template sent from our own domain.
          subject: `You're invited to join ${subjectSafe(leagueName)} on AllFantasy`,
          html: `You've been invited to join <strong>${escapeHtml(leagueName)}</strong>. Use this link to join: <a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a>`,
        },
        { idempotencyKey: buildEmailIdempotencyKey("league-invite", league.id, emailHash) }
      )
      if (sent.error) {
        return NextResponse.json({ error: sent.error.message || "Failed to send email", inviteUrl }, { status: 500 })
      }
      return NextResponse.json({ ok: true, inviteUrl, sent: true, sentTo: email })
    } catch (e) {
      return NextResponse.json(
        { ok: true, inviteUrl, sent: false, error: (e as Error).message },
        { status: 200 }
      )
    }
  }

  if (type === "username") {
    const appUser = await prisma.appUser.findFirst({
      where: {
        username: { equals: username, mode: "insensitive" },
      },
      select: { id: true, username: true, displayName: true },
    })
    const profile = appUser
      ? null
      : await prisma.userProfile.findFirst({
          where: {
            OR: [
              { displayName: { contains: username, mode: "insensitive" } },
              { sleeperUsername: { contains: username, mode: "insensitive" } },
            ],
          },
          select: { userId: true, displayName: true, sleeperUsername: true },
        })
    const resolvedTarget =
      appUser?.username ??
      appUser?.displayName ??
      profile?.displayName ??
      profile?.sleeperUsername ??
      null
    return NextResponse.json({
      ok: true,
      inviteUrl,
      sentTo: resolvedTarget ?? undefined,
      message: "Share the link below with this user.",
    })
  }

  return NextResponse.json({ ok: true, inviteUrl })
}
