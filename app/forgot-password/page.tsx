import { Suspense } from 'react'
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'
import { AuthStatusLoadingFallback } from '@/components/auth/AuthStatusShell'
import { PasswordResetV4 } from '@/components/core-app/screens/PasswordResetV4'

/*
 * ⚠ THIS WAS A BARE `{ title }` OBJECT, WHICH IS NOT THE SAME AS NO METADATA.
 * Declaring `metadata` without `robots` leaves the root layout's `index, follow`
 * in force, so the page advertised a title to crawlers while opting out of
 * nothing. Going through buildSeoMeta is what makes the noindex explicit —
 * password recovery is an authentication surface like /login and /signup, and
 * the same closed-beta rule applies.
 */
export const metadata: Metadata = buildSeoMeta({
  title: 'Reset Password | AllFantasy.ai',
  description:
    'Recover access to your AllFantasy.ai account.',
  canonicalPath: '/forgot-password',
  noIndex: true,
})

/*
 * ⚠ CUTOVER: PasswordResetV4 (handoff 16a, states 1–2) replaced ForgotPasswordClient here.
 *
 * The recovery WORKFLOW is unchanged and was NOT rewired — the new screen calls
 * the same requestPasswordResetByEmail / requestPasswordResetBySms helpers
 * against the same POST /api/auth/password/reset/request, and the same
 * verifyResetCode / resetPasswordWithCode for the SMS branch. It is a new
 * presentation of the existing flow. One-line rollback: restore the
 * ForgotPasswordClient import and element.
 *
 * ⚠ THE SMS BRANCH SURVIVED THE CUTOVER ON PURPOSE. Handoff 16a draws only the
 * email-link flow, but an account created by phone has no other way back in.
 * Owner-confirmed before this change.
 */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <PasswordResetV4 />
    </Suspense>
  )
}
