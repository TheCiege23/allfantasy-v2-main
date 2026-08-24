import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthStatusLoadingFallback } from "@/components/auth/AuthStatusShell"
import { SetPasswordV4 } from "@/components/core-app/screens/SetPasswordV4"

export const metadata: Metadata = {
  title: "Set a new password | AllFantasy.ai",
}

/*
 * ⚠ CUTOVER: SetPasswordV4 (handoff 16a, states 3–6) replaced ResetPasswordContent here.
 *
 * The reset WORKFLOW is unchanged and was NOT rewired — the new screen posts the
 * same { token, newPassword } body to the same POST /api/auth/password/reset/confirm
 * and maps the same server error codes (WEAK_PASSWORD, INVALID_OR_USED_TOKEN,
 * EXPIRED_TOKEN, MISSING_FIELDS, RESET_FAILED). It is a new presentation of the
 * existing flow. One-line rollback: restore the ResetPasswordContent import and
 * element.
 *
 * ⚠ THIS PAGE MUST KEEP READING BOTH `token` AND `returnTo`. The request route
 * builds its emailed link as /reset-password?token=…&returnTo=…, so dropping
 * either parameter here would strand every link already sitting in an inbox.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <SetPasswordV4 />
    </Suspense>
  )
}
