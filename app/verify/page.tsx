import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthStatusLoadingFallback } from "@/components/auth/AuthStatusShell"
import { VerifyEmailV4 } from "@/components/core-app/screens/VerifyEmailV4"
import { getSessionAndProfile } from "@/lib/auth-guard"

export const metadata: Metadata = {
  title: "Verify your email | AllFantasy.ai",
}

export const dynamic = "force-dynamic"

/*
 * ⚠ CUTOVER: VerifyEmailV4 (handoff 16b) replaced the previous VerifyContent here.
 *
 * The verification WORKFLOW is unchanged and was NOT rewired — the new screen
 * calls the same POST /api/auth/verify-email/send, the same /api/verify/phone/
 * start and /check, and the same POST /api/auth/confirm-age, and it reads the same
 * query vocabulary the emailed link and every server redirect already produce
 * (verified=, error=EXPIRED_LINK|INVALID_LINK|AGE_REQUIRED|VERIFICATION_REQUIRED,
 * status=, method=, returnTo=). No API route was added or changed. One-line
 * rollback: restore the VerifyContent import and element.
 *
 * ⚠ THIS BECAME A SERVER COMPONENT SO THE PENDING CARD CAN NAME THE ADDRESS.
 * The handoff prints "We sent a link to guap@brownpig.co", which the old
 * client-only page had no way to know — and the alternative, a new
 * /api/auth/whoami-style endpoint, is exactly the new route the repo's standing
 * rule forbids. getSessionAndProfile is the same helper the send route already
 * uses, so the email shown here is by construction the address a resend would go
 * to; there is no second source that could disagree with it.
 *
 * ⚠ THE PAGE MUST NOT REDIRECT UNAUTHENTICATED VISITORS. Verification links are
 * opened from an inbox, often in a browser with no session, and the /verify/email
 * route redirects back here with the outcome. Bouncing a signed-out visitor to
 * /login would swallow the "expired link" and "invalid link" messages entirely.
 */
export default async function VerifyPage() {
  const { userId, email, emailVerified } = await getSessionAndProfile().catch(() => ({
    userId: null,
    email: null,
    emailVerified: null,
  }))

  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <VerifyEmailV4
        email={email}
        alreadyVerified={Boolean(emailVerified)}
        signedIn={Boolean(userId)}
      />
    </Suspense>
  )
}
