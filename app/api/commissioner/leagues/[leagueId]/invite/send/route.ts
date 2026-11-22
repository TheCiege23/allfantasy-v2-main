import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from "next/server"
import { getServedOrigin } from "@/lib/http/served-origin"
import { createHash } from "crypto"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getLeaguePrivacySettings } from "@/lib/league-privacy"
import { buildFantasyInviteLink, generateInviteToken, getDefaultFantasyInviteExpiry } from "@/lib/league-invite"
import { buildEmailIdempotencyKey } from "@/lib/email/idempotency"
import { rateLimit } from "@/lib/rate-limit"
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { maskSeatInviteRecipient } from '@/lib/league/seatInvites'

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

async function notifyRegisteredInvitee(userId: string, leagueId: string, leagueName: string, inviteUrl: string, inviteCode: string): Promise<void> {
  await dispatchNotification({
    userIds: [userId], category: 'commissioner_alerts', productType: 'app',
    type: 'league_invite', title: `League invite: ${subjectSafe(leagueName)}`,
    body: 'You have been invited to join this league.',
    actionHref: inviteUrl, actionLabel: 'View invite', leagueId,
    severity: 'high', skipChannels: { email: true },
    dedupePrefix: `league-invite:${leagueId}:${inviteCode}:${userId}`,
    smsBody: 'You have a league invitation on AllFantasy. Open the app to view it.',
  })
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
    const refused = await commissionerAccessResponse(leagueId, userId, 'league')
    if (refused) return refused
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const type = body?.type === "username" || body?.type === "email" ? body.type : null
  const username = typeof body?.username === "string" ? body.username.trim() : ""
  const email = typeof body?.email === "string" ? body.email.trim() : ""
  const seatId = typeof body?.leagueTeamId === 'string' ? body.leagueTeamId : null
  if (body?.leagueTeamId !== undefined && (!seatId || type !== 'email')) {
    return NextResponse.json({ error: 'Choose an open team and an email address.' }, { status: 400 })
  }
  if (seatId && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  const note = typeof body?.message === "string" ? body.message.trim() : ""
  if (note.length > 320) return NextResponse.json({ error: "Keep the invite note to 320 characters." }, { status: 400 })

  if (!type || (type === "username" && !username) || (type === "email" && !email)) {
    return NextResponse.json(
      { error: "Provide type and username or email" },
      { status: 400 }
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: (await params).leagueId },
    select: { id: true, name: true, settings: true, platform: true },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const privacy = await getLeaguePrivacySettings(league.id)
  if (type === "email" && !privacy.allowEmailInvite) {
    return NextResponse.json({ error: "Email invites are disabled for this league." }, { status: 403 })
  }
  if (type === "username" && !privacy.allowUsernameInvite) {
    return NextResponse.json({ error: "Username invites are disabled for this league." }, { status: 403 })
  }

  const seat = seatId && isNativePlatform(league.platform) ? await prisma.leagueTeam.findFirst({
    where: { id: seatId, leagueId: league.id, role: { not: 'viewer' }, lifecycleState: { not: 'ARCHIVED' } },
    select: { id: true, claimedByUserId: true },
  }) : null
  if (seatId && !seat) return NextResponse.json({ error: 'Team not found in this native league.' }, { status: 404 })
  if (seat?.claimedByUserId) return NextResponse.json({ error: 'This team already has a manager.' }, { status: 409 })

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
    const attempt = seat ? await prisma.leagueSeatInvite.create({
      data: { leagueTeamId: seat.id, recipientLabel: maskSeatInviteRecipient(email) },
      select: { id: true },
    }) : null
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
          ...(attempt ? { tags: [{ name: 'af_seat_invite', value: attempt.id }] } : {}),
          subject: `You're invited to join ${subjectSafe(leagueName)} on AllFantasy`,
          html: `You've been invited to join <strong>${escapeHtml(leagueName)}</strong>.${note ? `<p>${escapeHtml(note).replace(/\r?\n/g, '<br>')}</p>` : ' '}Use this link to join: <a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a>`,
        },
        { idempotencyKey: buildEmailIdempotencyKey("league-invite", league.id, emailHash, ...(attempt ? [attempt.id] : [])) }
      )
      if (sent.error || (attempt && !sent.data?.id)) {
        if (attempt) await prisma.leagueSeatInvite.updateMany({ where: { id: attempt.id, status: 'SENDING' }, data: { status: 'FAILED' } })
        return NextResponse.json({ error: attempt ? 'The email provider did not accept this invite.' : sent.error?.message || 'Failed to send email', inviteUrl, inviteId: attempt?.id }, { status: attempt ? 502 : 500 })
      }
      if (attempt && sent.data?.id) {
        await prisma.leagueSeatInvite.updateMany({
          where: { id: attempt.id, status: 'SENDING' },
          data: { status: 'ACCEPTED', providerMessageId: sent.data.id },
        })
      }
      const registered = await prisma.appUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }).catch(() => null)
      if (registered) await notifyRegisteredInvitee(registered.id, league.id, leagueName, inviteUrl, String(inviteCode)).catch((e) => console.error('[invite/send] registered invite notification failed', e))
      return NextResponse.json({ ok: true, inviteUrl, sent: true, sentTo: email, inviteId: attempt?.id })
    } catch (e) {
      return NextResponse.json(
        { ok: true, inviteUrl, sent: false, inviteId: attempt?.id, error: attempt ? 'The email provider could not confirm the send.' : (e as Error).message },
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
    const exactProfile = appUser ? null : await prisma.userProfile.findFirst({
      where: { sleeperUsername: { equals: username, mode: 'insensitive' } }, select: { userId: true },
    })
    const registeredUserId = appUser?.id ?? exactProfile?.userId
    if (registeredUserId) await notifyRegisteredInvitee(registeredUserId, league.id, leagueName, inviteUrl, String(inviteCode)).catch((e) => console.error('[invite/send] username invite notification failed', e))
    return NextResponse.json({
      ok: true,
      inviteUrl,
      sentTo: resolvedTarget ?? undefined,
      message: "Share the link below with this user.",
    })
  }

  return NextResponse.json({ ok: true, inviteUrl })
}
