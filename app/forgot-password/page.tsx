import { Suspense } from 'react'
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'
import { AuthStatusLoadingFallback } from '@/components/auth/AuthStatusShell'
import ForgotPasswordClient from './ForgotPasswordClient'

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

function Fallback() {
  return <AuthStatusLoadingFallback />
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ForgotPasswordClient />
    </Suspense>
  )
}
