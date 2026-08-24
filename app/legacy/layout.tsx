import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'

/*
 * ⚠ THESE STRINGS ARE NOT NEW. They were sitting in app/legacy/head.tsx, which
 * this change deletes, and they had never once reached a browser.
 *
 * `head.tsx` is the App Router's superseded convention — replaced by the
 * `metadata` export in Next 13.2 and inert in 14. It fails silently: the file
 * compiles, exports a component full of correct-looking tags, and is simply
 * never rendered. MEASURED on this route before the change, with head.tsx still
 * present and declaring all four:
 *
 *   title       AllFantasy – Fantasy Sports Tools Powered by Chimmy   ← the homepage's
 *   description the homepage's        og:title  the homepage's
 *   canonical   none
 *
 * So /legacy served the root layout's identity while carrying a file that read
 * as if the question had been answered. That decoy is worse than nothing: it is
 * what stops the next person looking.
 *
 * Title and description below are that file's own copy, now actually emitted.
 * The canonical is new — head.tsx never declared one, and could not have.
 */
export const metadata: Metadata = buildSeoMeta({
  title: 'AllFantasy Legacy – Original AllFantasy Experience',
  description:
    'AllFantasy Legacy is the original AllFantasy experience for deep fantasy league history, legacy reports, and classic tools for serious players.',
  canonicalPath: '/legacy',
})

export default function LegacyProductLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
