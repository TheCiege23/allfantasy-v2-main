import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isSafeInternalPath, safeInternalPathOr } from "@/lib/auth/auth-intent-resolver"
import { relativeRedirect, relativeUrl } from "@/lib/http/relative-redirect"
import { prisma } from "@/lib/prisma"
import { sha256Hex } from "@/lib/tokens"

export const runtime = "nodejs"

function safeReturnTo(input: string | null): string {
  return safeInternalPathOr(input, "/dashboard")
}

/**
 * ⚠ THE LINK AND THE BROWSER CAN BELONG TO TWO DIFFERENT ACCOUNTS, AND NOTHING
 * DOWNSTREAM OF THIS ROUTE COULD TELL.
 *
 * A token names the account it was issued for; the browser that opens it is
 * signed in as whoever that browser last signed in as. A mail client opens links
 * in the default browser profile, not necessarily the window the account was
 * created in, so the two can differ in ordinary use. /verify then answered every
 * question — "is this verified?", "send a new link" — about the SIGNED-IN account
 * while the reader was asking about the link's. Reported 2026-09-15: an account
 * that was never verified got "This address is already verified" three times from
 * a session signed in as a verified account (same IP and user agent, a separate
 * cookie jar), while the import gate kept — correctly — refusing it.
 *
 * `account=other` carries only that fact — never an id or an address, since this
 * lands in a URL. Same predicate as the /verify page's own `signedIn`
 * (`session.user.id`), so the flag and the screen that reads it agree.
 *
 * True only on a POSITIVE reading. No session, or a session read that throws, is
 * "not known to differ": this route must never fail or reword a verification
 * because the session lookup did.
 */
async function signedInAsAnotherAccount(tokenUserId: string): Promise<boolean> {
  try {
    const session = (await getServerSession(authOptions)) as { user?: { id?: unknown } } | null
    const sessionUserId = session?.user?.id
    return typeof sessionUserId === "string" && sessionUserId.trim() !== "" && sessionUserId !== tokenUserId
  } catch {
    return false
  }
}

/**
 * Relative on purpose. A route handler's request origin is the address the server
 * was BOUND to — https://0.0.0.0:8080 on Railway — so an absolute redirect built
 * from it sent every verification click to a host no browser can reach. The full
 * account, with the production measurements, is in lib/http/served-origin.ts.
 *
 * It failed in the worst order: the transaction below marks the address verified
 * and deletes the token BEFORE redirecting, so the visitor got a connection error
 * on a dead host and a second click then reported INVALID_LINK on an account that
 * was in fact already verified.
 */
function redirectTo(path: string, returnTo?: string | null) {
  const target = relativeUrl(path)
  if (isSafeInternalPath(returnTo)) {
    target.searchParams.set("returnTo", returnTo)
  }
  return relativeRedirect(target)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams?.get("token")
  const returnTo = safeReturnTo(url.searchParams?.get("returnTo"))

  if (!token) return redirectTo("/verify?error=INVALID_LINK", returnTo)

  const tokenHash = sha256Hex(token)

  const row = await (prisma as any).emailVerifyToken.findUnique({
    where: { tokenHash },
  }).catch(() => null)

  if (!row) return redirectTo("/verify?error=INVALID_LINK", returnTo)

  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    /*
     * ⚠ THE EXPIRED ROW IS KEPT. Deleting it here meant the SECOND click on an old
     * link reported INVALID_LINK — "It may already have been used" — for a link that
     * was never used, and lost the one thing that can say which account the link was
     * for. An expired row verifies nothing (this check runs before the transaction),
     * and the next send or email change clears it with deleteMany.
     */
    const otherAccount = await signedInAsAnotherAccount(row.userId)
    return redirectTo(`/verify?error=EXPIRED_LINK${otherAccount ? "&account=other" : ""}`, returnTo)
  }

  const now = new Date()

  let verifiedEmail: string | null = null

  try {
    await (prisma as any).$transaction(async (tx: any) => {
      const updated = await tx.appUser.findUnique({
        where: { id: row.userId },
        select: { email: true },
      })
      verifiedEmail = updated?.email ?? null

      await tx.appUser.updateMany({
        where: { id: row.userId },
        data: { emailVerified: now },
      })

      await tx.userProfile.updateMany({
        where: { userId: row.userId },
        data: { emailVerifiedAt: now },
      })

      await tx.emailVerifyToken.delete({
        where: { tokenHash },
      })
    })
  } catch (txErr) {
    console.error("[verify/email] Transaction failed:", txErr)
    return redirectTo("/verify?error=INVALID_LINK", returnTo)
  }

  // Mirror the confirmation onto the EarlyAccessSignup row so the admin "Signups"
  // tab shows the correct confirmed status for account-flow signups. Best-effort.
  if (verifiedEmail) {
    try {
      await (prisma as any).earlyAccessSignup.updateMany({
        where: { email: verifiedEmail, confirmedAt: null },
        data: { confirmedAt: now },
      })
    } catch (mirrorErr) {
      console.warn("[verify/email] EarlyAccessSignup confirm mirror failed (non-blocking):", mirrorErr)
    }
  }

  // Read AFTER the write, so a slow or failing session lookup cannot cost the verification.
  const otherAccount = await signedInAsAnotherAccount(row.userId)
  return redirectTo(`/verify?verified=email${otherAccount ? "&account=other" : ""}`, returnTo)
}

