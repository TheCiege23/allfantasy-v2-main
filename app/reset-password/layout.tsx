import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

/*
 * ⚠ THE SHARPEST CASE OF THE FOUR, AND THE ONLY ONE WITH NO METADATA AT ALL.
 * app/reset-password/page.tsx reads `?token=` straight out of the query string,
 * and with nothing declared here the route inherited the root layout's
 * `index, follow` — a single-use password-reset token in a URL, on a page
 * telling crawlers to index it.
 *
 * The metadata lives in a layout rather than the page because the page is a
 * client component ("use client"), and a client component cannot export
 * `metadata`.
 */
export const metadata: Metadata = buildSeoMeta({
  title: 'Set a New Password | AllFantasy.ai',
  description: 'Choose a new password for your AllFantasy.ai account.',
  canonicalPath: '/reset-password',
  noIndex: true,
})

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
