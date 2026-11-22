import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  ADMIN_MFA_PENDING_COOKIE,
  signAdminSessionCookie,
  verifyAdminMfaPending,
} from "@/lib/adminSession"
import { getAppSessionAdminCandidate, isAdminEmailAllowed } from "@/lib/adminAuth"
import { adminTotpRequired, adminTotpSecretFor } from "@/lib/security/adminTotp"
import { verifyTotp, TOTP_STEP_SECONDS } from "@/lib/security/totp"
import { clearSharedRateLimit, consumeSharedRateLimit } from "@/lib/security/sharedRateLimit"
import { clientIpFromHeaders } from "@/lib/http/clientIp"

export const dynamic = "force-dynamic"

/**
 * The admin second factor: an authenticator-app code, checked for the person who has
 * already proved who they are (an allowlisted signed-in account, or a used magic link).
 * Only this route mints an admin_session with `mfa: true`, and while ADMIN_TOTP_SECRETS is
 * set lib/adminAuth.ts accepts no other kind. See lib/security/adminTotp.ts.
 */

/** Shorter than the 7-day sessions it replaces: a code-backed session should be re-proved daily. */
const MFA_SESSION_TTL_SECONDS = 12 * 60 * 60
const PER_ADMIN_ATTEMPTS = 5
const PER_IP_ATTEMPTS = 20
const ATTEMPT_WINDOW_SECONDS = 15 * 60

function sanitizeNext(next?: string) {
  if (!next) return "/admin"
  if (!next.startsWith("/")) return "/admin"
  if (next.startsWith("//")) return "/admin"
  if (!next.startsWith("/admin")) return "/admin"
  return next
}

type Claimant = { id?: string; email?: string; name?: string; identities: string[] }

/** Who is asking to complete admin sign-in, or null when nobody has proved anything yet. */
async function resolveClaimant(): Promise<Claimant | null> {
  const candidate = await getAppSessionAdminCandidate()
  if (candidate.status === "admin") {
    const u = candidate.user
    return { id: u.id, email: u.email, name: u.name, identities: [u.email ?? "", u.username ?? ""].filter(Boolean) }
  }
  const pending = verifyAdminMfaPending((await cookies()).get(ADMIN_MFA_PENDING_COOKIE)?.value)
  // Re-checked here, not trusted from when the link was sent: removing someone from the
  // allowlist must stop a sign-in that is already half done.
  if (pending && isAdminEmailAllowed(pending.email)) {
    return { email: pending.email, name: "Admin", identities: [pending.email] }
  }
  return null
}

export const GET = withApiUsage({ endpoint: "/api/auth/admin-totp", tool: "AuthAdminTotp" })(async () => {
  const required = adminTotpRequired()
  const awaitingCode = required ? Boolean(await resolveClaimant()) : false
  return NextResponse.json({ required, awaitingCode }, { headers: { "cache-control": "no-store" } })
})

export const POST = withApiUsage({ endpoint: "/api/auth/admin-totp", tool: "AuthAdminTotp" })(async (req: Request) => {
  if (!adminTotpRequired()) {
    return NextResponse.json({ error: "Admin codes are not turned on." }, { status: 404 })
  }

  const claimant = await resolveClaimant()
  if (!claimant) {
    return NextResponse.json({ error: "Sign in first, then enter your code." }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const code = String(body?.code ?? "")
  const next = sanitizeNext(String(body?.next ?? "/admin"))

  // Both budgets are spent BEFORE the compare and are shared across replicas. Six digits
  // is a million codes; five tries per admin per 15 minutes keeps a guesser far from them.
  const adminKey = `admin-totp:${claimant.identities[0]}`
  const ip = clientIpFromHeaders(req.headers) ?? "unknown"
  const perAdmin = await consumeSharedRateLimit(adminKey, PER_ADMIN_ATTEMPTS, ATTEMPT_WINDOW_SECONDS)
  const perIp = perAdmin.success
    ? await consumeSharedRateLimit(`admin-totp-ip:${ip}`, PER_IP_ATTEMPTS, ATTEMPT_WINDOW_SECONDS)
    : perAdmin
  if (!perIp.success) {
    return NextResponse.json({ error: "Too many tries. Wait 15 minutes and try again." }, { status: 429 })
  }

  const enrolled = adminTotpSecretFor(claimant.identities)
  if (!enrolled) {
    return NextResponse.json(
      { error: "No authenticator is set up for this admin account yet." },
      { status: 403 }
    )
  }

  const step = verifyTotp(enrolled.secret, code)
  // A code is good for its whole 30-second step (and the next, for clock drift). Claim the
  // step once so a code seen over a shoulder or in a log cannot be replayed inside it.
  const firstUse =
    step !== null &&
    (await consumeSharedRateLimit(`admin-totp-used:${enrolled.identity}:${step}`, 1, TOTP_STEP_SECONDS * 4)).success
  if (!firstUse) {
    return NextResponse.json({ error: "That code didn't match. Check your authenticator app and try again." }, { status: 401 })
  }

  await clearSharedRateLimit(adminKey)

  const res = NextResponse.json({ ok: true, next })
  res.cookies.set(
    "admin_session",
    signAdminSessionCookie({
      authenticated: true,
      role: "admin",
      id: claimant.id,
      email: claimant.email,
      name: claimant.name,
      authMethod: "totp",
      mfa: true,
      expiresAt: Date.now() + MFA_SESSION_TTL_SECONDS * 1000,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MFA_SESSION_TTL_SECONDS,
    }
  )
  res.cookies.set(ADMIN_MFA_PENDING_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
})
