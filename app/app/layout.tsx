import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import { buildSeoMeta } from '@/lib/seo'

/*
 * ⚠ THIS USED TO LIVE IN app/app/head.tsx — the head.js convention Next
 * removed in 13.2, silently ignored on 14.x. /app is the PWA id and a
 * 0.9-priority sitemap URL, and its carefully written copy reached no one:
 * the shell inherited the generic root title. The Metadata API export is the
 * form Next actually reads.
 */
export const metadata: Metadata = buildSeoMeta({
  title: 'AllFantasy Sports App — Fantasy Sports Tools & Trade Analyzer',
  description:
    'Use the AllFantasy Sports App to analyze trades, manage fantasy teams, and get Chimmy-powered insights across multiple sports.',
  canonicalPath: '/app',
})

export default function AppProductLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
