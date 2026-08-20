import type { Metadata } from 'next'
import { buildSeoMeta } from '@/lib/seo'

export const metadata: Metadata = buildSeoMeta({
  title: 'Create Account | AllFantasy.ai',
  description:
    'Create your AllFantasy.ai account — fantasy sports leagues, AI tools, and commissioner controls.',
  canonicalPath: '/signup',
  // Authentication surfaces must not be indexed (closed beta). An invite token in the URL
  // must never enter a search index; noindex keeps the signup page out of results.
  noIndex: true,
})

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
