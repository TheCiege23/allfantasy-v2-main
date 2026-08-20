import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import { buildMetadata, getSEOPageConfig } from '@/lib/seo'

export const metadata: Metadata = buildMetadata(
  getSEOPageConfig('draft-helper') ?? {
    title: 'Draft Helper | AllFantasy',
    description:
      'AI draft assistant and mock drafts. Best available, roster need, sleeper picks, and AI explanations grounded in your league.',
    canonical: 'https://allfantasy.ai/draft-helper',
  }
)

export default function DraftHelperLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
